"""Exercise the trusted bootstrap with a synthetic kit and a process double. No child runs."""

import ast
import base64
import hashlib
import io
import json
import os
from contextlib import ExitStack, chdir, redirect_stdout
from pathlib import Path
import sys
import tarfile
import tempfile
import tomllib
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

SOURCE = Path(__file__).resolve().parents[2] / "packages/sandbox/sbx/codex-guest.py"
MEMBERS = (
    "bin/codex",
    "bin/codex-code-mode-host",
    "codex-resources/bwrap",
    "codex-path/rg",
)


def refusal(message, operation):
    try:
        operation()
    except ValueError as failure:
        assert str(failure) == message
    else:
        raise AssertionError("bootstrap accepted " + message)


def framing(guest):
    guest.WIRE_LIMIT = 4
    for raw, accepted in [(b"{} \n", True), (b"{}  \n", False), (b"{}", False)]:
        with patch.object(sys, "stdin", SimpleNamespace(buffer=io.BytesIO(raw))):
            if accepted:
                assert guest.read() == {}
            else:
                refusal("pipe framing", guest.read)


def installation(guest):
    for kind in ("pinned", "wrong digest", "linked member"):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            guest.KIT = root / "kit"
            archive = root / "fixture.tgz"
            with tarfile.open(archive, "w:gz") as tar:
                for member in MEMBERS:
                    info = tarfile.TarInfo(
                        "package/vendor/aarch64-unknown-linux-musl/" + member
                    )
                    info.size = len(member)
                    if kind == "linked member" and member == MEMBERS[-1]:
                        info.type = tarfile.SYMTYPE
                        info.linkname = "not-a-regular-member"
                        info.size = 0
                    tar.addfile(info, io.BytesIO(member.encode()))
            digest = base64.b64encode(
                hashlib.sha512(archive.read_bytes()).digest()
            ).decode()
            with patch.object(
                guest,
                "Path",
                side_effect=lambda name: (
                    archive if name == "/tmp/aos-client.tgz" else Path(name)
                ),
            ):
                if kind == "wrong digest":
                    refusal("archive digest", lambda: guest.install("wrong"))
                elif kind == "linked member":
                    refusal("archive member", lambda: guest.install(digest))
                else:
                    guest.install(digest)
                    for member in MEMBERS:
                        target = guest.KIT / member
                        assert (
                            target.read_text() == member
                            and target.stat().st_mode & 0o777 == 0o555
                        )


def native_options(guest, command, work, home):
    """Read the actual native CLI arguments and TOML configuration."""
    cwd = command.index("--chdir")
    assert command[:2] == [
        str(guest.KIT / "codex-resources/bwrap"),
        "--die-with-parent",
    ]
    assert command[cwd : cwd + 5] == [
        "--chdir",
        str(work),
        "--",
        str(guest.CLIENT),
        "exec",
    ]
    flags = command[cwd + 5 : command.index("--disable")]
    assert flags == [
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--json",
        "-m",
        "fixture-model",
    ]
    pairs = command[command.index("--disable") : -2]
    assert len(pairs) % 2 == 0 and command[-2:] == ["--", "-"]
    disabled, entries = [], []
    for flag, value in zip(pairs[::2], pairs[1::2], strict=True):
        assert flag in {"--disable", "-c"}
        (disabled if flag == "--disable" else entries).append(value)
    assert sorted(disabled) == [
        "apps",
        "hooks",
        "memories",
        "multi_agent",
        "multi_agent_v2",
        "plugins",
    ]
    assert tomllib.loads("\n".join(entries)) == {
        "model_provider": "step",
        "model_providers": {
            "step": {
                "name": "step",
                "base_url": "http://host.fixture:21345/v1",
                "auth": {
                    "command": "/usr/bin/head",
                    "args": ["-n", "1", str(home / "run.fifo")],
                    "refresh_interval_ms": 0,
                },
                "wire_api": "responses",
                "requires_openai_auth": False,
                "supports_websockets": False,
                "request_max_retries": 0,
                "stream_max_retries": 0,
            }
        },
        "approval_policy": "never",
        "mcp_servers": {},
        "sandbox_workspace_write": {
            "exclude_tmpdir_env_var": True,
            "exclude_slash_tmp": True,
            "network_access": True,
        },
        "analytics": {"enabled": False},
        "feedback": {"enabled": False},
        "web_search": "disabled",
        "check_for_update_on_startup": False,
        "model_instructions_file": str(home / "instructions.md"),
        "model_reasoning_effort": "high",
    }


def construction(guest):
    cases = {
        "normal": None,
        "failed turn": None,
        "no terminal": None,
        "missing settings": None,
        "uid": "guest uid",
        "gid": "guest uid",
        "groups": "guest uid",
        "digest": "client digest",
        "version": "client version",
        "scheme": "guest proxy",
        "authority": "guest proxy",
        "username": "guest proxy",
        "password": "guest proxy",
        "reserved link": "reserved symlink",
        "missing evidence": "reserved path missing",
    }
    make_temp = tempfile.TemporaryDirectory
    for kind, expected in cases.items():
        with make_temp() as folder, ExitStack() as mocks:
            root = Path(folder)
            work = root / "work"
            work.mkdir()
            guest.KIT = root / "kit"
            guest.CLIENT = root / "fixture-native"
            guest.CLIENT.write_bytes(b"fixture")
            spec = dict(
                digest=hashlib.sha256(b"fixture").hexdigest(),
                version="fixture 1",
                gateway="gateway.fixture",
                host="host.fixture",
                port=21345,
                token="fixture-run-only",
                brief="write a fixture",
                systemPrompt="trusted",
                model="fixture-model",
                effort="high",
            )
            if kind == "digest":
                spec["digest"] = "different"
            for path in (".git", ".claude", ".codex", "steps"):
                if kind == "missing settings" and path in (".claude", ".codex"):
                    continue
                if kind == "missing evidence" and path == "steps":
                    continue
                if kind == "reserved link" and path == ".git":
                    (work / path).symlink_to(work / "other")
                else:
                    (work / path).mkdir()
            proxy = {
                "scheme": "https://gateway.fixture",
                "authority": "http://other.fixture",
                "username": "http://fixture@gateway.fixture",
                "password": "http://:fixture@gateway.fixture",
            }.get(kind, "http://gateway.fixture")
            mocks.enter_context(
                patch.dict(os.environ, {"HTTP_PROXY": proxy}, clear=True)
            )
            mocks.enter_context(
                patch.object(os, "getuid", return_value=0 if kind == "uid" else 65534)
            )
            mocks.enter_context(
                patch.object(os, "getgid", return_value=0 if kind == "gid" else 65534)
            )
            mocks.enter_context(
                patch.object(
                    os, "getgroups", return_value=[7] if kind == "groups" else []
                )
            )
            mocks.enter_context(patch.object(guest, "read", return_value=spec))
            mocks.enter_context(
                patch.object(
                    guest.tempfile,
                    "TemporaryDirectory",
                    side_effect=lambda dir: make_temp(dir=root),
                )
            )
            version = mocks.enter_context(
                patch.object(
                    guest.subprocess,
                    "check_output",
                    return_value=b"other\n" if kind == "version" else b"fixture 1\n",
                )
            )
            process = mocks.enter_context(patch.object(guest.subprocess, "Popen"))
            client = MagicMock()
            client.wait.return_value = 9 if kind == "failed turn" else 0
            events = [
                {
                    "type": "item.completed",
                    "item": {"type": "agent_message", "text": "reply"},
                },
                {
                    "type": "item.started",
                    "item": {"type": "agent_message", "text": "early"},
                },
                {
                    "type": "item.completed",
                    "item": {"type": "tool", "text": "tool data"},
                },
                {"type": "turn.completed"},
            ]
            if kind == "no terminal":
                events.pop()
            if kind == "failed turn":
                events.append({"type": "turn.failed"})
            client.stdout = [json.dumps(event).encode() for event in events]

            def spawn(command, *, cwd, env, stdin, stdout, stderr):
                assert cwd == work and command[-2:] == ["--", "-"]
                assert "fixture-run-only" not in repr((command, env))
                home = Path(env["HOME"])
                fifo = home / "run.fifo"
                assert fifo.is_fifo() and fifo.stat().st_mode & 0o777 == 0o600
                with fifo.open("rb", buffering=0) as reader:
                    assert reader.readline() == b"fixture-run-only\n"
                assert (
                    env["HTTP_PROXY"]
                    == env["HTTPS_PROXY"]
                    == env["http_proxy"]
                    == env["https_proxy"]
                    == proxy
                )
                assert (home / "instructions.md").read_text() == "trusted"
                assert all(isinstance(arg, str) for arg in command)
                mounts = [
                    tuple(command[i + 1 : i + 3])
                    for i, word in enumerate(command)
                    if word == "--ro-bind"
                ]
                for name in (".git", ".claude", ".codex", "steps"):
                    assert str(work / name) in [dest for _, dest in mounts]
                assert ("/", "/") in mounts and (
                    str(home / "instructions.md"),
                    str(home / "instructions.md"),
                ) in mounts
                native_options(guest, command, work, home)
                assert (stdin, stdout, stderr) == (
                    guest.subprocess.PIPE,
                    guest.subprocess.PIPE,
                    guest.subprocess.DEVNULL,
                )
                handle = MagicMock()
                handle.__enter__.return_value = client
                return handle

            process.side_effect = spawn
            with chdir(work), redirect_stdout(io.StringIO()) as output:
                if expected:
                    refusal(expected, guest.build)
                    process.assert_not_called()
                    continue
                guest.build()
                assert version.call_count == process.call_count == 1
                client.stdin.write.assert_called_once_with(b"write a fixture")
                client.stdin.close.assert_called_once_with()
                assert json.loads(output.getvalue()) == {
                    "kind": "result",
                    "guest": {
                        "exitCode": client.wait.return_value,
                        "completed": kind not in ("failed turn", "no terminal"),
                        "version": "fixture 1",
                        "uid": 65534,
                        "report": "reply",
                    },
                }


SUITES = {"read": framing, "install": installation, "build": construction}


def module(tree):
    guest = ModuleType("fixture_guest")
    # Ignore the command-line dispatch. The native scenarios invoke both real modes.
    definitions = ast.Module(
        body=[node for node in tree.body if not isinstance(node, ast.If)],
        type_ignores=[],
    )
    exec(compile(definitions, str(SOURCE), "exec"), guest.__dict__)
    return guest


def main():
    tree = ast.parse(SOURCE.read_text())
    for suite in SUITES.values():
        suite(module(tree))
    if sys.argv[1:] == ["--mutate-guards"]:
        killed = 0
        for fun in tree.body:
            if not isinstance(fun, ast.FunctionDef) or fun.name not in SUITES:
                continue
            for condition in [
                node for node in ast.walk(fun) if isinstance(node, ast.If)
            ]:
                test = condition.test
                operands = test.values if isinstance(test, ast.BoolOp) else [test]
                for index, operand in enumerate(list(operands)):
                    for forced in (False, True):
                        replacement = ast.copy_location(ast.Constant(forced), operand)
                        operands[index] = replacement
                        if not isinstance(test, ast.BoolOp):
                            condition.test = replacement
                        try:
                            SUITES[fun.name](module(tree))
                        except Exception:
                            killed += 1
                        else:
                            raise AssertionError(
                                f"survived at line {operand.lineno}, condition {index} = {forced}"
                            )
                        finally:
                            operands[index] = operand
                            condition.test = test
        # These loops control plugin execution, account access, and where Codex sends its requests.
        build = next(
            n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "build"
        )
        for loop in ast.walk(build):
            if not (
                isinstance(loop, ast.For)
                and isinstance(loop.target, ast.Name)
                and loop.target.id in ("feature", "setting")
            ):
                continue
            for literal in ast.walk(loop):
                if not isinstance(literal, ast.Constant) or not isinstance(
                    literal.value, str
                ):
                    continue
                original = literal.value
                literal.value += "_mutated"
                try:
                    construction(module(tree))
                except Exception:
                    killed += 1
                else:
                    raise AssertionError(
                        f"survived native option at line {literal.lineno}"
                    )
                finally:
                    literal.value = original
        print(f"{killed} guest guard and option mutations detected")


if __name__ == "__main__":
    main()
