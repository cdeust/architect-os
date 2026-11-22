"""Run the pinned Codex client against an in-VM Responses fixture. No account or API key is used."""

import base64
import hashlib
import json
import os
import shlex
import shutil
import tarfile
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

VENDOR = Path("/tmp/aos-b0-kit")
CLIENT = VENDOR / "bin/codex"
BINARY_SHA256 = "6a95492ca9d85ee76bd9fc5a4d8f72dd98a6130d1bb409bcfc50e61573106616"
ARCHIVE_SHA512 = "mJLm5eia/GcukCrRfVEnYVD5dOXGE7cmpd9dJ/ixkSiKifzDAPaGq83ZEmwVhk3PxbdTPUSLRpnXZQKbNS5HoA=="

MODEL = "gpt-5.4"
MARKER = "architect-os-sbx-b0"
CALL_ID = "fixture_write"


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
    if os.access("/var/run/docker.sock", os.W_OK):
        raise RuntimeError("client can reach the Docker socket")
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


if __name__ == "__main__":
    if sys.argv[1:] == ["install"]:
        install()
    elif sys.argv[1:] == ["probe"]:
        sys.exit(main())
    else:
        sys.exit("expected install or probe")
