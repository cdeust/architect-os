"""Run the pinned Antigravity client in a disposable, unprivileged SBX guest."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


def exchange(agent, request):
    agent.stdin.write(json.dumps(request) + "\n")
    agent.stdin.flush()
    while True:
        message = json.loads(agent.stdout.readline())
        if message.get("jsonrpc") != "2.0":
            raise RuntimeError("unexpected ACP frame")
        if message.get("id") == request["id"] and "method" not in message:
            return message
        if "method" not in message or "id" in message:
            raise RuntimeError("unexpected ACP request")


def main():
    archive_name, archive_sha512, binary_sha256 = sys.argv[1:]
    os.umask(0o077)
    if os.getuid() != 65534 or os.getgroups():
        raise RuntimeError("unexpected guest identity")

    with tempfile.TemporaryDirectory(dir="/tmp") as directory:
        root = Path(directory)
        binary = root / "agy"
        with open(archive_name, "rb") as archive:
            if hashlib.file_digest(archive, "sha512").hexdigest() != archive_sha512:
                raise RuntimeError("archive digest mismatch inside guest")
            archive.seek(0)
            with tarfile.open(fileobj=archive, mode="r:gz") as package:
                member, = package.getmembers()
                if member.name != "antigravity" or not member.isfile():
                    raise RuntimeError("unexpected archive layout")
                with package.extractfile(member) as source, binary.open("xb") as target:
                    shutil.copyfileobj(source, target)
        with binary.open("rb") as executable:
            if hashlib.file_digest(executable, "sha256").hexdigest() != binary_sha256:
                raise RuntimeError("executable digest mismatch inside guest")
        binary.chmod(0o500)

        home = root / "home"
        workspace = root / "work"
        private_tmp = root / "tmp"
        for path in (home, workspace, private_tmp):
            path.mkdir(mode=0o700)
        env = {"HOME": str(home), "TMPDIR": str(private_tmp), "PATH": "/usr/bin:/bin"}
        command = [str(binary), "acp", "--stdio", "--disable-telemetry",
                   "--include-default-customizations=false", "--cloud_code_endpoint=http://127.0.0.1:1"]
        initialize = {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": 1,
                       "clientInfo": {"name": "architect-os-preflight", "version": "1"},
                       "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False},
                                              "terminal": False}},
        }
        new_session = {
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": str(workspace), "mcpServers": []},
        }
        # Keep stdin open until the server responds. No prompt or authentication exchange.
        with subprocess.Popen(command, cwd=workspace, env=env, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True) as agent:
            try:
                result = exchange(agent, initialize)["result"]
                if result["protocolVersion"] != 1 or not isinstance(result["agentCapabilities"], dict):
                    raise RuntimeError("unexpected ACP protocol or capabilities")
                session = exchange(agent, new_session)
            finally:
                agent.kill()
        if "error" in session:
            setup = {"created": False, "errorCode": session["error"]["code"]}
        else:
            if not isinstance(session["result"]["sessionId"], str):
                raise RuntimeError("missing ACP session identity")
            setup = {"created": True}
        print(json.dumps({
            "schema": "architect-os/sbx-agy-initialize/v1",
            "protocolVersion": result["protocolVersion"],
            "agentInfo": result["agentInfo"],
            "agentCapabilities": result["agentCapabilities"],
            "authMethods": [m["id"] for m in result["authMethods"]],
            "guestUid": os.getuid(),
            "environmentKeys": sorted(env),
            "requests": [initialize["method"], new_session["method"]],
            "session": setup,
        }))


if __name__ == "__main__":
    main()
