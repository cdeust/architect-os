"""Real temporary Git checkouts and processes. Run only through the admitted Cucumber scenario."""

import fcntl
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess as sp
import sys
import tempfile

project = Path(sys.argv[1])
guard = str(project / "tools/test-gate/with-tree-lock.py")
python = "/usr/bin/python3"
mode = sys.argv[2]
original = b"original contents\n"
mutated = b"known mutation\n"
payload = {
    "file": "src/item.txt",
    "source": original.decode(),
    "mutated": mutated.decode(),
}


def run(tree, *args, check=True):
    return sp.run(
        args, cwd=tree, check=check, stdout=sp.PIPE, stderr=sp.PIPE, text=True
    )


def init(tree):
    tree.mkdir()
    (tree / "src").mkdir()
    (tree / "src/item.txt").write_bytes(original)
    run(tree, "git", "init", "-q")
    run(tree, "git", "add", ".")
    run(
        tree,
        "git",
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=t@example.invalid",
        "commit",
        "-qm",
        "fixture",
    )


def launch(tree, *args, check=True):
    return run(tree, python, "-I", guard, "exec", *args, check=check)


def killed(tree):
    code = """import json,os,signal,subprocess,sys
fd=int(os.environ['AOS_GATE_LEASE_FD'])
subprocess.run([sys.executable,'-I',sys.argv[1],'begin'],pass_fds=(fd,),input=sys.argv[2],text=True,check=True)
os.kill(os.getpid(), signal.SIGKILL)
"""
    proc = launch(
        tree, python, "-I", "-c", code, guard, json.dumps(payload), check=False
    )
    assert proc.returncode == -signal.SIGKILL, proc.stderr
    assert (tree / "src/item.txt").read_bytes() == mutated


def ledger(tree):
    st = tree.stat()
    return (
        Path(os.environ["ARCHITECT_OS_RUNTIME_ROOT"])
        / "state/gate"
        / f"{st.st_dev}-{st.st_ino}"
    )


with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    tree = home / "checkout [one]"
    init(tree)
    owned = [ledger(tree)]
    try:
        if mode in (
            "concurrent aliases",
            "independent checkouts",
            "candidate capability",
        ):
            other = home / "checkout two"
            init(other)
            owned.append(ledger(other))
            alias = home / "alias"
            alias.symlink_to(tree, target_is_directory=True)
            command = [
                python,
                "-I",
                guard,
                "exec",
                python,
                "-I",
                "-c",
                "import sys;print('held',flush=True);sys.stdin.readline()",
            ]
            owner = sp.Popen(
                command,
                cwd=tree,
                stdin=sp.PIPE,
                stdout=sp.PIPE,
                stderr=sp.PIPE,
                text=True,
            )
            try:
                assert owner.stdout.readline().strip() == "held"
                if mode == "concurrent aliases":
                    for current in (tree, alias, tree / "src"):
                        result = launch(current, "/usr/bin/true", check=False)
                        assert (
                            result.returncode == 1 and "GATE_TREE_BUSY" in result.stderr
                        ), result
                elif mode == "independent checkouts":
                    assert launch(other, "/usr/bin/true").returncode == 0
            finally:
                owner.stdin.close()
                assert owner.wait() == 0
            if mode == "candidate capability":
                code = """import os,sys,subprocess
assert 'AOS_GATE_LEASE_FD' not in os.environ
p=subprocess.run([sys.executable,'-I',sys.argv[1],'exec','/usr/bin/true'],capture_output=True,text=True)
assert p.returncode==1 and 'GATE_TREE_BUSY' in p.stderr,p
"""
                launch(
                    tree,
                    python,
                    "-I",
                    guard,
                    "candidate",
                    python,
                    "-I",
                    "-c",
                    code,
                    guard,
                )
            assert launch(tree, "/usr/bin/true").returncode == 0
        elif mode == "nested repository":
            # What a session can leave in its worktree: a repository whose own configuration
            # names a program as the clean filter of one file, left racy so that a git that
            # enters the repository must run the filter to know whether the file changed.
            witness = home / "witness"
            ran = home / "witness.ran"
            witness.write_text(f"#!/bin/sh\n: > '{ran}'\ncat\n")
            witness.chmod(0o755)
            nested = tree / "sub"
            nested.mkdir()
            run(nested, "git", "init", "-q")
            (nested / ".gitattributes").write_text("f.txt filter=witness\n")
            (nested / "f.txt").write_text("inner\n")
            run(nested, "git", "add", "-A")
            run(
                nested,
                "git",
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-qm",
                "inner",
            )
            run(nested, "git", "config", "filter.witness.clean", str(witness))
            run(nested, "git", "add", "f.txt")
            (nested / "f.txt").write_text("outer\n")
            ran.unlink(missing_ok=True)
            sha = run(tree, "git", "rev-parse", "HEAD").stdout.strip()

            # A tracked file of the tree asks git to look into the nested repository whatever the
            # configuration says.
            (tree / ".gitmodules").write_text(
                '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = none\n'
            )

            def refused():
                # Running or certifying a candidate is refused.
                for args in (
                    ("exec", "/usr/bin/true"),
                    ("candidate", "/usr/bin/true"),
                    ("verify", sha),
                ):
                    proc = run(tree, python, "-I", guard, *args, check=False)
                    assert (
                        proc.returncode == 1
                        and "GATE_NESTED_REPOSITORY" in proc.stderr
                    ), (args, proc)
                # Restoring a recorded source stays open, and reads nothing through git that
                # would enter the nested repository.
                assert run(tree, python, "-I", guard, "recover").returncode == 0
                assert not ran.exists()

            # Not tracked: git lists it as a directory.
            refused()
            # Recorded by a commit, as the host would after a step: an entry of mode 160000.
            run(tree, "git", "add", "-A")
            run(
                tree,
                "git",
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-qm",
                "the work of a session",
            )
            sha = run(tree, "git", "rev-parse", "HEAD").stdout.strip()
            refused()
            # The control: a git without the options of the Gate enters the nested repository
            # and starts the program, so the assertions above can fail.
            run(tree, "git", "status", "--porcelain")
            assert ran.exists()
        elif mode == "linked nested worktree":
            outer = home / "outside"
            init(outer)
            linked = tree / "linked"
            run(outer, "git", "worktree", "add", "--detach", str(linked), "HEAD")
            marker = linked / ".git"
            assert marker.read_text().startswith(f"gitdir: {outer}/.git/worktrees/")
            refused = launch(tree, "/usr/bin/true", check=False)
            assert refused.returncode == 1 and "GATE_NESTED_REPOSITORY" in refused.stderr
            # Even an unresolved marker remains a refusal. Its contents are irrelevant.
            marker.write_text("gitdir: /missing-gitdir\n")
            refused = launch(tree, "/usr/bin/true", check=False)
            assert refused.returncode == 1 and "GATE_NESTED_REPOSITORY" in refused.stderr
        elif mode == "changed ignore file":
            # A directory the repository ignores holds a repository, as a dependency or another
            # worktree does. The recorded ignore file prunes it; changed, it prunes nothing, and
            # the refusal says why the ignored directory was searched.
            ignore = tree / ".gitignore"
            ignore.write_text("deps/\n")
            run(tree, "git", "add", ".gitignore")
            run(
                tree,
                "git",
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-qm",
                "ignore the dependencies",
            )
            (tree / "deps/package").mkdir(parents=True)
            (tree / "deps/package/.git").write_text("gitdir: /missing-gitdir\n")
            assert launch(tree, "/usr/bin/true").returncode == 0
            ignore.write_text("deps/\n*.tmp\n")
            refused = launch(tree, "/usr/bin/true", check=False)
            assert refused.returncode == 1 and refused.stderr == (
                "gate: GATE_NESTED_REPOSITORY: under a directory ignored by a tracked .gitignore "
                "that is no longer the one recorded, so its rules are not applied: commit or "
                "restore that file\n"
            ), refused
            ignore.write_text("deps/\n")
            assert launch(tree, "/usr/bin/true").returncode == 0
            # A repository that no ignore file ignores keeps the bare code.
            (tree / "sub").mkdir()
            (tree / "sub/.git").write_text("gitdir: /missing-gitdir\n")
            refused = launch(tree, "/usr/bin/true", check=False)
            assert refused.returncode == 1 and refused.stderr == "gate: GATE_NESTED_REPOSITORY\n", refused
        elif mode == "staged addition":
            added = tree / "staged.txt"
            added.write_text("staged only\n")
            run(tree, "git", "add", "staged.txt")
            refused = launch(tree, "/usr/bin/true", check=False)
            assert refused.returncode == 1 and "GATE_TREE_DIRTY" in refused.stderr
            run(tree, "git", "rm", "--cached", "staged.txt")
            added.unlink()
            sha = run(tree, "git", "rev-parse", "HEAD").stdout.strip()
            code = """from pathlib import Path
import os,subprocess,sys
from subprocess import run
Path('staged.txt').write_text('new')
run(['/usr/bin/git','add','staged.txt'],check=True)
fd=int(os.environ['AOS_GATE_LEASE_FD'])
p=run([sys.executable,'-I',sys.argv[1],'verify',sys.argv[2]],pass_fds=(fd,),capture_output=True,text=True)
assert p.returncode==1 and 'GATE_RECEIPT_TREE_CHANGED' in p.stderr,p
"""
            launch(tree, python, "-I", "-c", code, guard, sha)
        elif mode in ("index mode differs", "index unresolved"):
            if mode == "index mode differs":
                run(tree, "git", "update-index", "--chmod=+x", "src/item.txt")
            else:
                oid = run(tree, "git", "rev-parse", "HEAD:src/item.txt").stdout.strip()
                sp.run(
                    ["git", "update-index", "--index-info"],
                    cwd=tree,
                    input=(f"0 {'0' * len(oid)}\tsrc/item.txt\n"
                           f"100644 {oid} 1\tsrc/item.txt\n"),
                    check=True,
                    text=True,
                )
            assert (tree / "src/item.txt").read_bytes() == original
            proc = launch(tree, "/usr/bin/true", check=False)
            assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
        elif mode == "untouched converted checkout":
            (tree / ".gitattributes").write_text("src/item.txt text eol=crlf\n")
            run(tree, "git", "add", ".gitattributes")
            run(tree, "git", "-c", "user.name=fixture", "-c", "user.email=t@example.invalid",
                "commit", "-qm", "line endings")
            converted = home / "converted"
            run(tree, "git", "worktree", "add", "--detach", str(converted), "HEAD")
            owned.append(ledger(converted))
            assert run(converted, "git", "status", "--porcelain").stdout == ""
            assert (converted / "src/item.txt").read_bytes() == b"original contents\r\n"
            proc = launch(converted, "/usr/bin/true", check=False)
            assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
        elif mode == "rewritten bytes":
            # Git calls this tree clean, and its bytes are not the commit's: an attribute of the
            # tree collapses the rewritten line when git compares. The Gate reads the bytes.
            (tree / ".gitattributes").write_text("*.txt ident\n")
            (tree / "src/id.txt").write_text("$Id$\n")
            run(tree, "git", "add", "-A")
            run(
                tree,
                "git",
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-qm",
                "an identifier",
            )
            assert launch(tree, "/usr/bin/true").returncode == 0
            (tree / "src/id.txt").write_text("$Id: a line the commit does not hold $\n")
            assert run(tree, "git", "diff", "--quiet", "HEAD", check=False).returncode == 0
            proc = launch(tree, "/usr/bin/true", check=False)
            assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
            # A mode the commit does not hold, and a file replaced by a link to the same bytes.
            (tree / "src/id.txt").write_text("$Id$\n")
            assert launch(tree, "/usr/bin/true").returncode == 0
            (tree / "src/id.txt").chmod(0o755)
            proc = launch(tree, "/usr/bin/true", check=False)
            assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
            (tree / "src/id.txt").chmod(0o644)
            (tree / "src/id.txt").rename(home / "elsewhere.txt")
            (tree / "src/id.txt").symlink_to(home / "elsewhere.txt")
            proc = launch(tree, "/usr/bin/true", check=False)
            assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
        elif mode == "unchecked source":
            sha = run(tree, "git", "rev-parse", "HEAD").stdout.strip()
            (tree / "other.ts").write_text("unchecked")
            proc = launch(tree, python, "-I", guard, "verify", sha, check=False)
            assert (
                proc.returncode == 1 and "GATE_RECEIPT_TREE_CHANGED" in proc.stderr
            ), proc
            assert (tree / "other.ts").read_text() == "unchecked"
            (tree / "other.ts").unlink()
            assert launch(tree, python, "-I", guard, "verify", sha).returncode == 0
        elif mode == "interrupted validator":
            names = (
                ".nvmrc",
                "tools/runtime/node-locations",
                "tools/test-gate/with-tree-lock.py",
                "packages/sandbox/git-closed.json",
                "packages/sandbox/src/runtime-context.ts",
            )
            for name in names:
                (tree / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(project / name, tree / name)
            run(tree, "git", "add", "-A")
            run(
                tree,
                "git",
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-qm",
                "installed validator",
            )
            validator = tree / names[-1]
            local_guard = str(tree / names[2])
            trusted = validator.read_text()
            token = {
                "file": names[-1],
                "source": trusted,
                "mutated": "throw Error('interrupted validator');\n",
            }
            code = """import os,subprocess,sys
fd=int(os.environ['AOS_GATE_LEASE_FD'])
subprocess.run([sys.executable,'-I',sys.argv[1],'begin'],pass_fds=(fd,),input=sys.argv[2],text=True,check=True)
os.kill(os.getpid(), 9)
"""
            proc = run(
                tree,
                python,
                "-I",
                local_guard,
                "exec",
                python,
                "-I",
                "-c",
                code,
                local_guard,
                json.dumps(token),
                check=False,
            )
            assert (
                proc.returncode == -signal.SIGKILL
                and validator.read_text() == token["mutated"]
            ), proc
            run(tree, python, "-I", local_guard, "recover")
            assert validator.read_text() == trusted
        elif mode == "admission lost":
            known = ledger(tree)
            code = """import os,subprocess,sys
fd=int(os.environ['AOS_GATE_LEASE_FD'])
env=dict(os.environ)
del env['ARCHITECT_OS_ADMISSION_BINDING']
for action in ('begin','restore','discard','verify'):
    args=[sys.executable,'-I',sys.argv[1],action]
    if action=='verify': args.append('a'*40)
    proc=subprocess.run(args,env=env,pass_fds=(fd,),input='{}',capture_output=True,text=True)
    assert proc.returncode==1 and 'GATE_ADMISSION_REQUIRED' in proc.stderr,proc
"""
            launch(tree, python, "-I", "-c", code, guard)
            assert not (known / "pending.json").exists()
            assert (tree / "src/item.txt").read_bytes() == original
        elif mode == "unowned descriptor":
            fd = os.open(tree, os.O_RDONLY | os.O_DIRECTORY)
            try:
                env = dict(os.environ, AOS_GATE_LEASE_FD=str(fd))
                for action in ("begin", "restore", "discard"):
                    proc = sp.run(
                        [python, "-I", guard, action],
                        cwd=tree,
                        env=env,
                        pass_fds=(fd,),
                        input=json.dumps(payload),
                        capture_output=True,
                        text=True,
                    )
                    assert (
                        proc.returncode == 1
                        and "GATE_ACTIVE_LEASE_REQUIRED" in proc.stderr
                    ), proc
                assert (tree / "src/item.txt").read_bytes() == original
            finally:
                os.close(fd)
        else:
            killed(tree)
            src = tree / "src/item.txt"
            if mode == "restore before start":
                code = "from pathlib import Path;import sys;assert Path('src/item.txt').read_bytes()==sys.argv[1].encode()"
                launch(tree, python, "-I", "-c", code, original.decode())
                assert not (ledger(tree) / "pending.json").exists()
            elif mode == "interrupted mutation with nested repository":
                state = ledger(tree)
                receipt = state / "latest.json"
                receipt.write_text("{}")
                receipt.chmod(0o600)
                nested = tree / "unrelated"
                nested.mkdir()
                (nested / ".git").write_text("gitdir: /outside-checkout\n")
                proc = run(tree, python, "-I", guard, "full", "/usr/bin/true", check=False)
                assert proc.returncode == 1 and "GATE_NESTED_REPOSITORY" in proc.stderr, proc
                assert src.read_bytes() == original
                assert not (state / "pending.json").exists()
                assert not receipt.exists()
            elif mode == "trusted issuer":
                # The installed issuer starts independently of the candidate whose tracked source was damaged.
                run(tree, str(project / "aos"), "--", python, "-I", guard, "recover")
                assert (
                    src.read_bytes() == original
                    and not (ledger(tree) / "pending.json").exists()
                )
            elif mode == "incomplete journal":
                journal = ledger(tree) / "pending.json"
                data = json.loads(journal.read_text())
                data["source"] = "unconfirmed original"
                journal.write_text(json.dumps(data))
                proc = launch(tree, "/usr/bin/true", check=False)
                assert (
                    proc.returncode == 1
                    and "GATE_RECOVERY_SOURCE_DIFFERS_FROM_COMMIT" in proc.stderr
                )
                assert src.read_bytes() == mutated and journal.is_file()
            elif mode == "operator edit":
                src.write_bytes(b"operator's edits")
                proc = launch(tree, "/usr/bin/true", check=False)
                assert proc.returncode == 1 and "GATE_RECOVERY_CONFLICT" in proc.stderr
                assert (
                    src.read_bytes() == b"operator's edits"
                    and (ledger(tree) / "pending.json").is_file()
                )
            elif mode == "replacement inode":
                saved = tree / "saved"
                src.rename(saved)
                src.write_bytes(mutated)
                proc = launch(tree, "/usr/bin/true", check=False)
                assert proc.returncode == 1 and "GATE_RECOVERY_CONFLICT" in proc.stderr
                assert src.read_bytes() == mutated and saved.read_bytes() == mutated
            elif mode == "different marked root":
                alternate = home / "alternate"
                alternate.mkdir(mode=0o700)
                marker = ".architect-os-runtime-root"
                (alternate / marker).write_bytes(
                    (
                        Path(os.environ["ARCHITECT_OS_RUNTIME_ROOT"]) / marker
                    ).read_bytes()
                )
                env = dict(os.environ, ARCHITECT_OS_RUNTIME_ROOT=str(alternate))
                proc = sp.run(
                    [
                        str(project / "aos"),
                        "--",
                        python,
                        "-I",
                        guard,
                        "exec",
                        "/usr/bin/true",
                    ],
                    cwd=tree,
                    env=env,
                    capture_output=True,
                    text=True,
                )
                assert proc.returncode == 1 and "GATE_TREE_DIRTY" in proc.stderr, proc
                assert src.read_bytes() == mutated
                launch(tree, "/usr/bin/true")
                assert src.read_bytes() == original
            else:
                raise AssertionError(mode)
    finally:
        # Each directory is keyed by one checkout this fixture just created.
        for path in owned:
            if path.exists():
                for child in path.iterdir():
                    assert child.name in ("pending.json", "latest.json")
                    child.unlink()
                path.rmdir()
