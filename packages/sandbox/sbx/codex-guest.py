"""Trusted guest bootstrap; all account traffic crosses the SBX process pipes."""

import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

KIT = Path("/opt/aos-builder")
CLIENT = KIT / "bin/codex"
WIRE_LIMIT = (
    64 * 1024 * 1024
)  # packages/sandbox/code.json, authProxy.policy.maxBodyBytes


def emit(frame):
    print(json.dumps(frame, separators=(",", ":")), flush=True)


def read():
    raw = sys.stdin.buffer.readline(WIRE_LIMIT + 1)
    if not raw.endswith(b"\n") or len(raw) > WIRE_LIMIT:
        raise ValueError("pipe framing")
    return json.loads(raw)


def install(archive_hash):
    KIT.mkdir(mode=0o755)
    archive = Path("/tmp/aos-client.tgz")
    with archive.open("rb") as f:
        if (
            base64.b64encode(hashlib.file_digest(f, "sha512").digest()).decode()
            != archive_hash
        ):
            raise ValueError("archive digest")
    with tarfile.open(archive) as package:
        for member in (
            "bin/codex",
            "bin/codex-code-mode-host",
            "codex-resources/bwrap",
            "codex-path/rg",
        ):
            src = package.getmember(
                "package/vendor/aarch64-unknown-linux-musl/" + member
            )
            if not src.isfile():
                raise ValueError("archive member")
            dst = KIT / member
            dst.parent.mkdir(mode=0o755, exist_ok=True)
            with package.extractfile(src) as inp, dst.open("xb") as out:
                shutil.copyfileobj(inp, out)
            dst.chmod(0o555)


class Relay(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        count = int(self.headers["Content-Length"])
        if count < 0 or count > WIRE_LIMIT:
            self.send_error(413)
            return
        raw = self.rfile.read(count)
        emit(
            {
                "kind": "request",
                "method": "POST",
                "path": self.path,
                "token": self.server.token,
                "headers": {
                    k.lower(): v
                    for k, v in self.headers.items()
                    if k.lower() == "x-codex-turn-state"
                },
                "body": base64.b64encode(raw).decode(),
            }
        )
        frame = read()
        if frame["kind"] != "headers":
            self.send_error(502)
            return
        self.send_response(frame["status"])
        for key, value in frame["headers"].items():
            self.send_header(key, value)
        self.end_headers()
        while True:
            frame = read()
            if frame["kind"] == "end":
                break
            if frame["kind"] != "chunk":
                raise ValueError("pipe response")
            self.wfile.write(base64.b64decode(frame["data"], validate=True))
            self.wfile.flush()


def build():
    if os.getuid() != 65534 or os.getgid() != 65534 or os.getgroups():
        raise ValueError("guest uid")
    spec = read()
    with CLIENT.open("rb") as f:
        if hashlib.file_digest(f, "sha256").hexdigest() != spec["digest"]:
            raise ValueError("client digest")
    with (
        tempfile.TemporaryDirectory(dir="/tmp") as home,
        HTTPServer(("127.0.0.1", 0), Relay) as server,
    ):
        server.token = spec["token"]
        env = {
            "HOME": home,
            "TMPDIR": home,
            "CODEX_HOME": home,
            "LANG": "C.UTF-8",
            "PATH": "/usr/local/bin:/usr/bin:/bin",
        }
        version = (
            subprocess.check_output(
                [str(CLIENT), "--version"], env=env, stdin=subprocess.DEVNULL
            )
            .decode()
            .strip()
        )
        if version != spec["version"]:
            raise ValueError("client version")
        prompt = Path(home) / "instructions.md"
        prompt.write_text(spec["systemPrompt"])
        work = Path.cwd()
        # The outer mount namespace protects Step evidence independently of the client's own tool sandbox.
        command = [
            str(KIT / "codex-resources/bwrap"),
            "--die-with-parent",
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--tmpfs",
            "/tmp",
            "--bind",
            str(work),
            str(work),
            "--bind",
            home,
            home,
            "--ro-bind",
            str(prompt),
            str(prompt),
        ]
        for name in (".git", ".claude", ".codex", "steps"):
            path = work / name
            if path.is_symlink():
                raise ValueError("reserved symlink")
            if path.exists():
                command += ["--ro-bind", str(path), str(path)]
            elif name in (".claude", ".codex"):
                # A missing configuration directory must not become writable during the session.
                command += [
                    "--ro-bind",
                    "/var/empty" if Path("/var/empty").is_dir() else str(KIT / "empty"),
                    str(path),
                ]
            else:
                raise ValueError("reserved path missing")
        command += [
            "--chdir",
            str(work),
            "--",
            str(CLIENT),
            "exec",
            "--sandbox",
            "workspace-write",
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--json",
            "-m",
            spec["model"],
        ]
        for feature in (
            "plugins",
            "apps",
            "hooks",
            "multi_agent",
            "multi_agent_v2",
            "memories",
        ):
            command += ["--disable", feature]
        for setting in (
            'model_provider="step"',
            'model_providers.step.name="step"',
            'model_providers.step.base_url="http://127.0.0.1:%s/v1"'
            % server.server_port,
            'model_providers.step.wire_api="responses"',
            "model_providers.step.requires_openai_auth=false",
            "model_providers.step.supports_websockets=false",
            "model_providers.step.request_max_retries=0",
            "model_providers.step.stream_max_retries=0",
            "mcp_servers={}",
            'approval_policy="never"',
            "sandbox_workspace_write.exclude_tmpdir_env_var=true",
            "sandbox_workspace_write.exclude_slash_tmp=true",
            "analytics.enabled=false",
            "feedback.enabled=false",
            'web_search="disabled"',
            "check_for_update_on_startup=false",
            "model_instructions_file=" + json.dumps(str(prompt)),
            "model_reasoning_effort=" + json.dumps(spec["effort"]),
        ):
            command += ["-c", setting]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        completed = False
        try:
            with subprocess.Popen(
                [*command, "--", "-"],
                cwd=work,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            ) as client:
                client.stdin.write(spec["brief"].encode())
                client.stdin.close()
                for line in client.stdout:
                    event = json.loads(line)
                    if event.get("type") == "turn.completed":
                        completed = True
                    if event.get("type") == "turn.failed":
                        completed = False
                code = client.wait()
        finally:
            server.shutdown()
            thread.join()
        emit(
            {
                "kind": "result",
                "guest": {
                    "exitCode": code,
                    "completed": completed,
                    "version": version,
                    "uid": os.getuid(),
                },
            }
        )


if __name__ == "__main__":
    if sys.argv[1] == "install":
        install(sys.argv[2])
        (KIT / "empty").mkdir(mode=0o555)
    else:
        build()
