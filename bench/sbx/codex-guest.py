"""Run the pinned Codex client over guest loopback. The guest never holds an account credential."""

import base64
import hashlib
import json
import os
import re
import selectors
import shlex
import shutil
import signal
import tarfile
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer

VENDOR = Path("/tmp/aos-b0-kit")
CLIENT = VENDOR / "bin/codex"
BINARY_SHA256 = "6a95492ca9d85ee76bd9fc5a4d8f72dd98a6130d1bb409bcfc50e61573106616"
ARCHIVE_SHA512 = "mJLm5eia/GcukCrRfVEnYVD5dOXGE7cmpd9dJ/ixkSiKifzDAPaGq83ZEmwVhk3PxbdTPUSLRpnXZQKbNS5HoA=="

MODEL = "gpt-5.4"
MARKER = "architect-os-sbx-b0"
CALL_ID = "fixture_write"

# The host and guest bound each protocol message at the existing B.0 relay limit.
FRAME_BYTES = 1024 * 1024
PROBE_SECONDS = 90  # Same native turn deadline as the offline write probe.
EXPECTED_VERSION = "codex-cli 0.170.0"
WITHHELD = object()


def install():
    """Stage only the native client and its own tools, before dropping the setup identity."""
    archive = Path("/tmp/aos-b0-codex.tgz")
    with archive.open("rb") as source:
        checksum = base64.b64encode(hashlib.file_digest(source, "sha512").digest()).decode()
    if checksum != ARCHIVE_SHA512:
        raise RuntimeError("unexpected Codex archive digest")
    VENDOR.mkdir(mode=0o755)
    with tarfile.open(archive) as package:
        for member in ("bin/codex", "bin/codex-code-mode-host", "codex-resources/bwrap", "codex-path/rg"):
            entry = package.getmember("package/vendor/aarch64-unknown-linux-musl/" + member)
            if not entry.isfile():
                raise RuntimeError("expected a regular client executable")
            target = VENDOR / member
            target.parent.mkdir(mode=0o755, exist_ok=True)
            with package.extractfile(entry) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o555)


class Responses(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        state = self.server.state
        if self.path != "/v1/responses" or self.headers.get("Authorization"):
            state["rejected_request"] = True
            self.send_error(400)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        state["requests"] += 1
        sequence = state["requests"]
        if sequence > 2:
            self.send_error(400)
            return
        response = {"id": f"resp_fixture_{sequence}", "model": MODEL, "object": "response"}
        if sequence == 1:
            item = {"type": "function_call", "name": "exec_command", "call_id": CALL_ID,
                    "id": "fc_fixture", "arguments": json.dumps({"cmd": f"printf '%s\\n' '{MARKER}' > {shlex.quote(str(self.server.witness))}"})}
        else:
            outputs = [part for part in body["input"] if part.get("type") == "function_call_output"
                       and part.get("call_id") == CALL_ID]
            state["tool_reply"] = len(outputs) == 1
            if outputs:
                result = str(outputs[0].get("output", ""))
                if "Operation not permitted" in result or "bwrap:" in result or "error" in result.lower():
                    state["tool_diagnostic"] = result[:1200]
            item = {"type": "message", "role": "assistant", "id": "msg_fixture",
                    "content": [{"type": "output_text", "text": "Fixture complete.", "annotations": []}]}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        events = [
            {"type": "response.created", "response": {**response, "status": "in_progress"}},
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": {**response, "status": "completed", "output": [item],
             "usage": {"input_tokens": 4, "output_tokens": 2, "total_tokens": 6}}},
        ]
        for event in events:
            self.wfile.write(("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode())


def main():
    work = Path.cwd()
    if os.getuid() != 65534 or os.getgid() != 65534 or os.getgroups():
        raise RuntimeError("fixture requires an unprivileged identity without supplementary groups")
    witness = work / "witness.txt"
    if sorted(p.name for p in work.iterdir()) != ["witness.txt"] or witness.is_symlink() or witness.read_bytes():
        raise RuntimeError("expected only the empty, regular host witness")
    if not os.access(work, os.W_OK) or not os.access(witness, os.W_OK):
        raise RuntimeError("expected a private writable fixture")
    with CLIENT.open("rb") as binary:
        client_hash = hashlib.file_digest(binary, "sha256").hexdigest()
    if client_hash != BINARY_SHA256:
        raise RuntimeError("unexpected Codex executable")
    state = {"requests": 0, "tool_reply": False, "rejected_request": False}
    with tempfile.TemporaryDirectory(prefix="aos-codex-", dir="/tmp") as home, HTTPServer(("127.0.0.1", 0), Responses) as server:
        server.state = state
        server.witness = witness
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        codex_home = Path(home) / "codex"
        codex_home.mkdir(mode=0o700)
        env = {"HOME": home, "CODEX_HOME": str(codex_home), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
        version = subprocess.run([str(CLIENT), "--version"], env=env, check=True,
                                 text=True, capture_output=True).stdout.strip()
        state["client_version"] = version
        args = [str(CLIENT), "exec", "--sandbox", "workspace-write", "--skip-git-repo-check",
                "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "-m", MODEL,
                "-c", 'model_provider="fixture"', "-c", 'model_providers.fixture.name="fixture"',
                "-c", f'model_providers.fixture.base_url="http://127.0.0.1:{server.server_port}/v1"',
                "-c", 'model_providers.fixture.wire_api="responses"',
                "-c", "model_providers.fixture.requires_openai_auth=false",
                "-c", "model_providers.fixture.supports_websockets=false",
                "-c", "check_for_update_on_startup=false", "Write the fixture marker to witness.txt."]
        try:
            result = subprocess.run(args, cwd=work, env=env, capture_output=True, text=True, timeout=90)
        finally:
            server.shutdown()
            thread.join()
        events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        terminal = [event for event in events if event.get("type") == "turn.completed"]
        state.update(client_exit=result.returncode, terminal=len(terminal) == 1)
        if len(terminal) == 1:
            usage = terminal[0]["usage"]
            state["usage"] = {key: usage[key] for key in ("input_tokens", "output_tokens")}
        if not state["terminal"] or result.returncode:
            state["client_error"] = next((e.get("message") or e.get("error") for e in events
                                          if e.get("type") in ("error","turn.failed")), result.stderr[-1000:])
    state["uid"] = os.getuid()
    state["client_sha256"] = client_hash
    state["witness_written"] = witness.read_bytes() == (MARKER+"\n").encode()
    print(json.dumps(state), flush=True)
    return 0 if (state["client_exit"] == 0 and state["terminal"] and state["requests"] == 2 and state["tool_reply"]
                 and state["witness_written"] and not state["rejected_request"]) else 1


def unique_object(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("duplicate JSON field")
    return obj


def json_frame(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)


def read_frame(stream):
    raw = stream.readline(FRAME_BYTES + 1)
    if len(raw) > FRAME_BYTES or not raw.endswith(b"\n"):
        raise ValueError("invalid frame")
    return json_frame(raw)


def challenge_from(prompt):
    if not isinstance(prompt, str):
        raise ValueError("invalid challenge")
    match = re.fullmatch(r"Reply with exactly this value: (AOS-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}"
                         r"-[89ab][0-9a-f]{3}-[0-9a-f]{12})", prompt)
    if match is None:
        raise ValueError("invalid challenge")
    return match.group(1)


def usage_counts(value):
    counts = {key: value[key] for key in ("input_tokens", "output_tokens")}
    if any(type(n) is not int or not 0 <= n <= 2**53 - 1 for n in counts.values()):
        raise ValueError("invalid interoperable usage count")
    total = sum(counts.values())
    if total > 2**53 - 1 or ("total_tokens" in value and
                               (type(value["total_tokens"]) is not int or value["total_tokens"] != total)):
        raise ValueError("inconsistent terminal token total")
    return counts


def native_declarations(item):
    # Codex 0.170.0 ResponseItem::AdditionalTools contains schemas, not invocations. The relay discards them.
    if (item.get("role") != "developer" or set(item) - {"type", "role", "id", "tools"}
            or ("id" in item and not isinstance(item["id"], str)) or not isinstance(item.get("tools"), list)):
        return False
    for namespace in item["tools"]:
        if (namespace.get("type") != "namespace" or not isinstance(namespace.get("name"), str)
                or set(namespace) - {"type", "name", "description", "tools"}
                or not isinstance(namespace.get("tools"), list)):
            return False
        for tool in namespace["tools"]:
            if (not isinstance(tool.get("name"), str) or tool.get("type") not in ("function", "custom")
                    or set(tool) - {"type", "name", "description", "parameters", "strict", "format", "defer_loading"}):
                return False
    return True


def eligible_request(body, model, prompt):
    if body.get("model") != model or body.get("stream") is not True or not isinstance(body.get("input"), list):
        return False
    prompts = 0
    for index, item in enumerate(body["input"]):
        if index == 0 and item.get("type") == "additional_tools" and native_declarations(item):
            continue
        parts = item.get("content")
        if (item.get("type", "message") != "message" or not isinstance(parts, list) or not parts
                or any(p.get("type") != "input_text" or not isinstance(p.get("text"), str) for p in parts)):
            return False
        if item.get("role") in ("developer", "system"):
            continue
        if item.get("role") != "user" or len(parts) != 1:
            return False
        text = parts[0]["text"]
        if text == prompt:
            prompts += 1
        elif not re.fullmatch(r"<environment_context>[\s\S]*</environment_context>\s*", text):
            return False
    return prompts == 1


def text_response(body, model, challenge):
    """Validate the closed transcript, including the optional presentation-only notice."""
    blocks = body.split("\n\n")
    if len(blocks) not in (4, 5) or blocks[-1] != "":
        raise ValueError("invalid SSE framing")
    presentation = "inline" if len(blocks) == 5 else None
    types = ["response.created"]
    if presentation is not None:
        types.append("response.metadata")
    types.extend(("response.output_item.done", "response.completed"))
    events = []
    for block, kind in zip(blocks, types):
        label, data = block.split("\n")
        if label != "event: " + kind or not data.startswith("data: "):
            raise ValueError("unexpected SSE event")
        value = json_frame(data[6:].encode())
        if value.get("type") != kind:
            raise ValueError("SSE type mismatch")
        events.append(value)
    opening, item, terminal = events[0]["response"], events[-2]["item"], events[-1]["response"]
    usage = terminal["usage"]
    counts = usage_counts(usage)
    text = item["content"][0]["text"]
    if (not all(isinstance(i, str) and i for i in (opening["id"], item["id"])) or text != challenge
            or type(events[-2]["output_index"]) is not int or type(usage["total_tokens"]) is not int):
        raise ValueError("unexpected probe metadata")
    # Rebuild the complete permitted SSE envelope to reject fields the pinned client could interpret.
    header = {"id": opening["id"], "object": "response", "model": model}
    message = {"id": item["id"], "type": "message", "status": "completed", "role": "assistant",
               "content": [{"type": "output_text", "text": text, "annotations": []}]}
    expected = [{"type": "response.created", "response": {**header, "status": "in_progress"}}]
    if presentation is not None:
        expected.append({"type": "response.metadata", "response_id": opening["id"], "metadata": {
            "openai_chatgpt_moderation_metadata": {"presentation": "inline"}}})
    expected.extend((
        {"type": "response.output_item.done", "output_index": 0, "item": message},
        {"type": "response.completed", "response": {**header, "status": "completed", "output": [message],
         "usage": {**counts, "total_tokens": sum(counts.values())}}},
    ))
    if events != expected:
        raise ValueError("unexpected response")
    return text, counts, presentation


class TextServer(HTTPServer):
    def handle_error(self, request, client_address):
        # The host receives only the bounded refusal, including on disconnects.
        self.refused = True


class TextResponses(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_error(self, code, *args):
        self.server.refused = True
        self.send_empty_response(code)

    def send_empty_response(self, code):
        self.send_response_only(code)
        self.send_header("Content-Length", "0")
        self.end_headers()
        self.close_connection = True

    def do_POST(self):
        server = self.server
        if (server.refused or server.requested or self.path != "/v1/responses"
                or self.headers.get_all("Host") != [f"127.0.0.1:{server.server_port}"]
                or self.headers.get_all("Content-Type") != ["application/json"]
                or any(key in self.headers for key in ("Authorization", "Proxy-Authorization", "Cookie",
                                                       "Content-Encoding", "Transfer-Encoding", "Expect"))):
            self.send_error(403)
            return
        try:
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not re.fullmatch(r"[1-9][0-9]*", lengths[0]):
                raise ValueError("invalid length")
            size = int(lengths[0])
            if size > FRAME_BYTES:
                raise ValueError("oversized request")
            raw = self.rfile.read(size)
            if len(raw) != size or not eligible_request(json_frame(raw), server.model, server.prompt):
                raise ValueError("unexpected native request")
            server.requested = True
            print(json.dumps({"kind": "request", "model": server.model}), flush=True)
            reply = read_frame(sys.stdin.buffer)
            if sys.stdin.buffer.read(1):
                raise ValueError("unexpected second host reply")
            if reply == {"kind": "withheld"}:
                self.send_empty_response(403)
                server.expected = WITHHELD
                return
            reasoning_included = "reasoning_included" in reply
            if (set(reply) - {"kind", "body", "reasoning_included"} or reply["kind"] != "response"
                    or not isinstance(reply["body"], str) or (reasoning_included and reply["reasoning_included"] is not True)):
                raise ValueError("unexpected host response")
            text, counts, presentation = text_response(reply["body"], server.model, server.challenge)
            payload = reply["body"].encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            if reasoning_included:
                self.send_header("X-Reasoning-Included", "true")
            self.end_headers()
            self.wfile.write(payload)
            server.expected = (text, counts)
            server.served_presentation = presentation
            server.served_reasoning_included = reasoning_included
        except (AttributeError, IndexError, KeyError, OSError, TypeError, ValueError, RecursionError):
            self.send_error(400)


def observed_turn(raw):
    events = [json_frame(line) for line in raw.splitlines()]
    if [e["type"] for e in events] != ["thread.started", "turn.started", "item.completed", "turn.completed"]:
        raise ValueError("unexpected native event sequence")
    message = events[2]["item"]
    if message["type"] != "agent_message" or not isinstance(message["text"], str) or not message["text"]:
        raise ValueError("unexpected native output")
    return message["text"], usage_counts(events[3]["usage"])


def native_text_receipt(server, exit_code, output):
    if server.refused or not server.requested or server.expected is None:
        raise ValueError("client or relay refused")
    receipt = {"kind": "receipt", "model": server.model, "client_sha256": BINARY_SHA256,
               "client_version": EXPECTED_VERSION, "exit_code": exit_code}
    if server.expected is WITHHELD:
        # Measured with the pinned Linux client against this relay's empty 403. Its
        # exec JSONL schema is codex-rs/exec/src/exec_events.rs at rust-v0.170.0.
        events = [json_frame(line) for line in output.splitlines()]
        if exit_code != 1 or len(events) != 4:
            raise ValueError("unexpected native refusal")
        thread = events[0]
        thread_id = thread.get("thread_id")
        if (thread != {"type": "thread.started", "thread_id": thread_id}
                or not isinstance(thread_id, str)
                or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", thread_id)):
            raise ValueError("unexpected native thread")
        message = f"unexpected status 403 Forbidden: Unknown error, url: http://127.0.0.1:{server.server_port}/v1/responses"
        if events[1:] != [{"type": "turn.started"}, {"type": "error", "message": message},
                          {"type": "turn.failed", "error": {"message": message}}]:
            raise ValueError("unexpected native refusal")
        return {**receipt, "terminal": "withheld",
                "challenge_sha256": hashlib.sha256(server.challenge.encode("utf-8")).hexdigest()}
    if exit_code != 0:
        raise ValueError("native text client failed")
    text, counts = observed_turn(output)
    if (text, counts) != server.expected:
        raise ValueError("unmatched native receipt")
    receipt.update(text=text, usage=counts)
    if server.served_presentation is not None:
        receipt["served_moderation_presentation"] = server.served_presentation
    if server.served_reasoning_included:
        receipt["served_reasoning_included"] = True
    return receipt


def run_text_client(server, command, cwd, env):
    # Serve the sole HTTP peer and drain native events under one deadline with bounded storage.
    with subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as client, selectors.DefaultSelector() as ready:
        try:
            ready.register(server, selectors.EVENT_READ)
            ready.register(client.stdout, selectors.EVENT_READ)
            output = bytearray()
            while True:
                for key, _ in ready.select():
                    if key.fileobj is server:
                        server.handle_request()
                    else:
                        chunk = os.read(client.stdout.fileno(), FRAME_BYTES + 1 - len(output))
                        if not chunk:
                            return native_text_receipt(server, client.wait(), output)
                        output.extend(chunk)
                        if len(output) > FRAME_BYTES:
                            raise ValueError("oversized native event stream")
        finally:
            client.kill()


def require_probe_user():
    if os.getuid() != 65534 or os.getgid() != 65534 or os.getgroups():
        raise ValueError("unprivileged identity required")


@contextmanager
def private_verified_client(prefix):
    with CLIENT.open("rb") as binary:
        if hashlib.file_digest(binary, "sha256").hexdigest() != BINARY_SHA256:
            raise ValueError("unexpected client")
    with tempfile.TemporaryDirectory(prefix=prefix, dir="/tmp") as home:
        config, work = Path(home) / "codex", Path(home) / "workspace"
        config.mkdir(mode=0o700)
        work.mkdir(mode=0o500)
        env = {"HOME": home, "CODEX_HOME": str(config), "TMPDIR": home, "LANG": "C.UTF-8",
               "PATH": "/usr/local/bin:/usr/bin:/bin"}
        version = subprocess.run([str(CLIENT), "--version"], env=env, cwd=work, check=True,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if version.stdout.decode().strip() != EXPECTED_VERSION:
            raise ValueError("unexpected client version")
        yield work, env


def text_probe():
    require_probe_user()
    spec = read_frame(sys.stdin.buffer)
    if (set(spec) != {"model", "prompt"} or not isinstance(spec["model"], str)
            or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", spec["model"])):
        raise ValueError("invalid host challenge")
    challenge = challenge_from(spec["prompt"])
    with private_verified_client("aos-codex-text-") as (work, env):
        with TextServer(("127.0.0.1", 0), TextResponses) as server:
            server.refused, server.requested, server.expected = False, False, None
            server.model, server.prompt, server.challenge = spec["model"], spec["prompt"], challenge
            command = [str(CLIENT), "exec", "--sandbox", "read-only", "--skip-git-repo-check",
                       "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "-m", server.model]
            for feature in ("plugins", "apps", "hooks", "shell_tool", "unified_exec", "multi_agent",
                            "multi_agent_v2", "memories"):
                command += ["--disable", feature]
            for setting in ('model_provider="probe"', 'model_providers.probe.name="probe"',
                            f'model_providers.probe.base_url="http://127.0.0.1:{server.server_port}/v1"',
                            'model_providers.probe.wire_api="responses"', 'model_providers.probe.requires_openai_auth=false',
                            'model_providers.probe.supports_websockets=false', 'model_providers.probe.request_max_retries=0',
                            'model_providers.probe.stream_max_retries=0', 'approval_policy="never"', 'mcp_servers={}',
                            'web_search="disabled"', 'project_doc_max_bytes=0', 'check_for_update_on_startup=false'):
                command += ["-c", setting]
            receipt = run_text_client(server, [*command, "--", server.prompt], work, env)
    print(json.dumps(receipt), flush=True)


def rpc_send(client, message):
    client.stdin.write(json.dumps(message).encode("utf-8") + b"\n")
    client.stdin.flush()


def rpc_result(client, request_id):
    frame = read_frame(client.stdout)
    if (not isinstance(frame, dict) or set(frame) != {"id", "result"}
            or type(frame["id"]) is not int or frame["id"] != request_id
            or not isinstance(frame["result"], dict)):
        raise ValueError("unexpected native RPC")
    return frame["result"]


def require_disabled_remote(frame):
    # v0.170.0 emits this status after initialization. Refuse an active connection or environment.
    # codex-rs/app-server-protocol/schema/typescript/v2/RemoteControlStatusChangedNotification.ts
    # The app-server adds a signed Unix millisecond timestamp in its notification envelope.
    # codex-rs/app-server/src/outgoing_message.rs#L1022-L1026
    if (not isinstance(frame, dict) or set(frame) != {"method", "params", "emittedAtMs"}
            or frame["method"] != "remoteControl/status/changed" or type(frame["emittedAtMs"]) is not int
            or not 0 < frame["emittedAtMs"] <= 2**63 - 1):
        raise ValueError("unexpected native startup notification")
    params = frame["params"]
    if (not isinstance(params, dict) or set(params) != {"status", "serverName", "installationId", "environmentId"}
            or params["status"] != "disabled" or params["environmentId"] is not None
            or not isinstance(params["serverName"], str) or not isinstance(params["installationId"], str)):
        raise ValueError("remote control must be disabled")


def account_exec():
    require_probe_user()
    spec = read_frame(sys.stdin.buffer)
    if (not isinstance(spec, dict) or set(spec) != {"challenge"} or not isinstance(spec["challenge"], str)
            or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", spec["challenge"])
            or sys.stdin.buffer.read(1)):
        raise ValueError("invalid host challenge")
    with private_verified_client("aos-codex-account-") as (work, env):
        work.chmod(0o700)
        challenge = work / "challenge"
        challenge.write_bytes(("architect-os account execution\n" + spec["challenge"] + "\n").encode("ascii"))
        challenge.chmod(0o400)
        work.chmod(0o500)
        args = [str(CLIENT), "-c", 'approval_policy="never"', "-c", 'sandbox_mode="read-only"',
                "-c", "mcp_servers={}", "-c", "check_for_update_on_startup=false",
                "app-server", "--listen", "stdio://"]
        with subprocess.Popen(args, env=env, cwd=work, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as client:
            try:
                rpc_send(client, {"method": "initialize", "id": 1, "params": {
                    "clientInfo": {"name": "architect_os", "title": "Architect OS", "version": "1"}}})
                rpc_result(client, 1)
                rpc_send(client, {"method": "initialized", "params": {}})
                require_disabled_remote(read_frame(client.stdout))
                # Both argv elements are constant; the opaque challenge is only read as file data.
                rpc_send(client, {"method": "command/exec", "id": 2, "params": {
                    "command": ["/usr/bin/sha256sum", "challenge"], "cwd": str(work),
                    "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                    "timeoutMs": PROBE_SECONDS * 1000}})
                result = rpc_result(client, 2)
                if (set(result) != {"exitCode", "stdout", "stderr"} or type(result["exitCode"]) is not int
                        or result["exitCode"] != 0 or result["stderr"] != "" or not isinstance(result["stdout"], str)
                        or not re.fullmatch(r"[0-9a-f]{64}  challenge\n", result["stdout"])):
                    raise ValueError("unexpected native result")
                client.stdin.close()
                if client.stdout.read(1):
                    raise ValueError("unexpected trailing native event")
                client_exit = client.wait()
            finally:
                client.kill()
                # Permit removal of the private challenge when leaving the temporary directory.
                work.chmod(0o700)
    print(json.dumps({"client_version": EXPECTED_VERSION, "client_sha256": BINARY_SHA256,
                      "client_exit": client_exit, "command_exit": result["exitCode"],
                      "stdout": result["stdout"], "stderr": result["stderr"]}), flush=True)


class ProbeDeadline(BaseException):
    """Leave blocking HTTP, host-input and native-process operations through their cleanup scopes."""


def expire_probe(*_):
    raise ProbeDeadline()


if __name__ == "__main__":
    if sys.argv[1:] == ["install"]:
        install()
    elif sys.argv[1:] == ["probe"]:
        sys.exit(main())
    elif sys.argv[1:] in (["text-probe"], ["account-exec"]):
        signal.signal(signal.SIGALRM, expire_probe)
        signal.alarm(PROBE_SECONDS)
        try:
            if sys.argv[1] == "text-probe":
                text_probe()
            else:
                account_exec()
        except (Exception, ProbeDeadline):
            sys.exit("SBX_CODEX_TEXT_PROBE_REFUSED" if sys.argv[1] == "text-probe" else "SBX_CODEX_ACCOUNT_EXEC_REFUSED")
        finally:
            signal.alarm(0)
    else:
        sys.exit("expected install, probe, text-probe, or account-exec")
