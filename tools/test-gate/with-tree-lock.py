"""The native Gate lease on Linux and macOS (flock(2), openat(2), fsync(2)).

The kernel owns the lease on the checkout directory itself. Its lifetime follows the
open file description, including normal shell children. A second runtime root or
a different spelling of the checkout cannot create an independent lock.
"""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

DIRECTORY = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY
FILE = os.O_NOFOLLOW | os.O_NONBLOCK
# What a session wrote in the checkout or its repository decides nothing of what git does here:
# the closed options and variables every git of the host is given, read from the descriptive
# file of the launcher beside this script (packages/sandbox/git-closed.json).
with open(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "packages", "sandbox", "git-closed.json"),
    "rb",
) as closed_file:
    CLOSED = json.load(closed_file)
GIT_ENV = {
    "PATH": "/usr/bin:/bin",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "LC_ALL": "C",
    **CLOSED["environment"],
}
GIT = ["/usr/bin/git", *CLOSED["options"]]
PENDING = "pending.json"


class Refusal(Exception):
    pass


def identity(st):
    return (st.st_dev, st.st_ino)


def private(st, directory=False):
    kind = (
        stat.S_ISDIR(st.st_mode)
        if directory
        else stat.S_ISREG(st.st_mode) and st.st_nlink == 1
    )
    if (
        not kind
        or st.st_uid != os.getuid()
        or stat.S_IMODE(st.st_mode) != (0o700 if directory else 0o600)
    ):
        raise Refusal("GATE_RECOVERY_UNSAFE")


def git(*args, input=None):
    return subprocess.run(
        [*GIT, *args], input=input, env=GIT_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )


def checkout():
    result = git("rev-parse", "--show-toplevel")
    if result.returncode:
        raise Refusal("GATE_CHECKOUT_REQUIRED")
    path = os.path.realpath(os.fsdecode(result.stdout.removesuffix(b"\n")))
    os.chdir(path)
    return path


def nested_marker(tree_fd, tracked_ignores):
    """Walk directories without opening Git markers. check-ignore matches names, it does
    not enumerate untracked files (Git's builtin/check-ignore.c and dir.c)."""
    def walk(fd, prefix):
        if prefix:
            try:
                os.stat(".git", dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                return prefix
        children = [
            os.fsencode(name)
            for name in os.listdir(fd)
            if name != ".git" and stat.S_ISDIR(
                os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode
            )
        ]
        if not children:
            return None
        paths = [prefix + name for name in children]
        pruned = set()
        if tracked_ignores:
            # A leading ./ also keeps names beginning with ':' from becoming pathspec magic.
            matched = git(
                "check-ignore", "--no-index", "-z", "--stdin", "-v",
                input=b"".join(b"./" + path + b"\0" for path in paths),
            )
            if matched.returncode not in (0, 1):
                raise Refusal("GATE_CHECKOUT_UNREADABLE")
            records = iter(matched.stdout.split(b"\0")[:-1])
            pruned = {
                path[2:] for origin, _, pattern, path in zip(records, records, records, records)
                if origin in tracked_ignores and not pattern.startswith(b"!")
            }
        for name, path in zip(children, paths):
            if path in pruned:
                continue
            child = os.open(name, DIRECTORY, dir_fd=fd)
            try:
                found = walk(child, path + b"/")
                if found is not None:
                    return found
            finally:
                os.close(child)
        return None

    return walk(tree_fd, b"")


def refuse_nested_repository(fd):
    index = git("ls-files", "-s", "-z")
    head = git("ls-tree", "-r", "-z", "HEAD")
    if index.returncode or head.returncode:
        raise Refusal("GATE_CHECKOUT_UNREADABLE")
    recorded = index.stdout.split(b"\0") + head.stdout.split(b"\0")
    if any(entry.startswith(b"160000 ") for entry in recorded):
        raise Refusal("GATE_NESTED_REPOSITORY")
    if visible_marker(fd, head.stdout) is not None:
        raise Refusal("GATE_NESTED_REPOSITORY")


def visible_marker(fd, tree):
    ignores = {
        name for entry in tree.split(b"\0")
        if (name := entry.partition(b"\t")[2]).rsplit(b"/", 1)[-1] == b".gitignore"
    }
    return nested_marker(fd, ignores)


def lease(tree, existing):
    fd = os.open(tree, DIRECTORY)
    inherited = os.getenv("AOS_GATE_LEASE_FD")
    reused = False
    if inherited and inherited.isdecimal() and int(inherited) > 2:
        old = int(inherited)
        try:
            same = old != fd and identity(os.fstat(old)) == identity(os.fstat(fd))
        except OSError:
            same = False
        if same:
            # A number naming this directory is insufficient. A distinct open description must
            # already be excluded, and acquiring on the inherited description must succeed.
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(fd, fcntl.LOCK_UN)
            except BlockingIOError:
                reused = True
            os.close(fd)
            fd = old
    if (existing or inherited is not None) and not reused:
        raise Refusal("GATE_ACTIVE_LEASE_REQUIRED")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Refusal("GATE_TREE_BUSY: a Gate still owns this checkout")
    os.set_inheritable(fd, True)
    os.environ["AOS_GATE_LEASE_FD"] = str(fd)
    return fd, reused


def state_directory(fd):
    root = Path(os.environ["ARCHITECT_OS_RUNTIME_ROOT"])
    state = root / "state"
    if state.resolve(strict=True) != state:
        raise Refusal("GATE_RECOVERY_UNSAFE")
    device = root.stat().st_dev
    tree_dev, tree_ino = identity(os.fstat(fd))
    for path in (state, state / "gate", state / "gate" / f"{tree_dev}-{tree_ino}"):
        if path != state:
            path.mkdir(mode=0o700, exist_ok=True)
        st = path.lstat()
        private(st, directory=True)
        if st.st_dev != device:
            raise Refusal("GATE_RECOVERY_UNSAFE")
    return path


def parts(relative):
    names = relative.split("/")
    if any(
        not name or name in (".", "..", ".git") or "\\" in name or "\0" in name
        for name in names
    ):
        raise Refusal("GATE_RECOVERY_PATH_INVALID")
    return names


@contextlib.contextmanager
def source(tree_fd, relative):
    names = parts(relative)
    fd = os.dup(tree_fd)
    try:
        for name in names[:-1]:
            nxt = os.open(name, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = nxt
        with os.fdopen(
            os.open(names[-1], FILE | os.O_RDWR, dir_fd=fd), "r+b"
        ) as stream:
            st = os.fstat(stream.fileno())
            if (
                not stat.S_ISREG(st.st_mode)
                or st.st_nlink != 1
                or st.st_uid != os.getuid()
            ):
                raise Refusal("GATE_RECOVERY_SOURCE_UNSAFE")
            yield stream, identity(st)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_source(stream, content):
    stream.seek(0)
    stream.write(content)
    stream.truncate()
    stream.flush()
    os.fsync(stream.fileno())


def committed_source(head, name, expected):
    blob = git("cat-file", "blob", head + ":" + name)
    if blob.returncode or blob.stdout != expected:
        raise Refusal("GATE_RECOVERY_SOURCE_DIFFERS_FROM_COMMIT")


def recover(fd, state):
    try:
        raw = os.open(state / PENDING, FILE | os.O_RDONLY)
    except FileNotFoundError:
        return
    with os.fdopen(raw, "r", encoding="utf8") as entry:
        private(os.fstat(entry.fileno()))
        data = json.load(entry)
    if (
        set(data) != {"version", "file", "source", "mutated", "identity", "head"}
        or data["version"] != 1
    ):
        raise Refusal("GATE_RECOVERY_RECORD_INVALID")
    if git("rev-parse", "HEAD").stdout.decode().strip() != data["head"]:
        raise Refusal("GATE_RECOVERY_COMMIT_CHANGED")
    original = data["source"].encode("utf8")
    mutated = data["mutated"].encode("utf8")
    committed_source(data["head"], data["file"], original)
    with source(fd, data["file"]) as (stream, found):
        current = stream.read()
        if list(found) != data["identity"] or current not in (original, mutated):
            raise Refusal(
                "GATE_RECOVERY_CONFLICT: inspect the changed source; its bytes were preserved"
            )
        if current != original:
            write_source(stream, original)
    (state / PENDING).unlink()
    sync_directory(state)


def begin(fd, state, data):
    if set(data) != {"file", "source", "mutated"} or not all(
        isinstance(value, str) for value in data.values()
    ):
        raise Refusal("GATE_RECOVERY_INPUT_INVALID")
    if (state / PENDING).exists():
        raise Refusal("GATE_RECOVERY_PENDING")
    original = data["source"].encode("utf8")
    head = git("rev-parse", "HEAD").stdout.decode().strip()
    committed_source(head, data["file"], original)
    with source(fd, data["file"]) as (stream, found):
        if stream.read() != original:
            raise Refusal("GATE_RECOVERY_SOURCE_CHANGED")
        # Publish a complete, durable record before touching the checkout. A crash while writing
        # its temporary file has no effect on the source. The per-tree lock serializes publishers.
        with tempfile.NamedTemporaryFile(
            dir=state, delete=False, mode="w", encoding="utf8"
        ) as entry:
            json.dump(dict(data, version=1, identity=found, head=head), entry)
            entry.flush()
            os.fsync(entry.fileno())
        os.replace(entry.name, state / PENDING)
        sync_directory(state)
        write_source(stream, data["mutated"].encode("utf8"))


def verify_admission():
    launcher = Path(__file__).resolve().parents[2]
    for location in (
        (launcher / "tools/runtime/node-locations").read_text().splitlines()
    ):
        node = Path(location) / "node"
        if not node.is_absolute():
            raise Refusal("GATE_ADMISSION_REQUIRED")
        if node.is_file() and os.access(node, os.X_OK):
            break
    else:
        raise Refusal("GATE_ADMISSION_REQUIRED")
    version = subprocess.run(
        [node, "--version"],
        env={"PATH": "/usr/bin:/bin"},
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    pin = (launcher / ".nvmrc").read_text().strip()
    if version.returncode or version.stdout.strip() != ("v" + pin).encode():
        raise Refusal("GATE_ADMISSION_REQUIRED")
    env = {
        k: v
        for k, v in os.environ.items()
        if k.startswith(("ARCHITECT_OS_", "XDG_", "npm_config_"))
        or k in ("TMPDIR", "TMP", "TEMP", "NODE_COMPILE_CACHE")
    }
    env["NODE_DISABLE_COMPILE_CACHE"] = "1"
    # All verbs, including restore, validate the same admission. When replay mutates the
    # validator itself, its worktree bytes cannot decide whether recovery is authorized.
    # A Git installation uses its committed, native-only validator, an independent
    # distribution uses the read-only module shipped with the installed launcher.
    if (launcher / ".git").exists():
        validator = git(
            "-C",
            launcher,
            "cat-file",
            "blob",
            "HEAD:packages/sandbox/src/runtime-context.ts",
        )
        if validator.returncode:
            raise Refusal("GATE_ADMISSION_REQUIRED")
        checked = subprocess.run(
            [node, "--input-type=module-typescript", "-"],
            cwd=launcher,
            input=validator.stdout + b"\nrequireAdmittedRun();\n",
            env=env,
        )
    else:
        checked = subprocess.run(
            [node, launcher / "scripts/require-run.mjs"],
            env=env,
            stdin=subprocess.DEVNULL,
        )
    if checked.returncode:
        raise Refusal("GATE_ADMISSION_REQUIRED")


def dirty():
    """Compare index entries and checkout bytes directly with the captured tree."""
    head = git("rev-parse", "--verify", "HEAD^{tree}")
    if head.returncode:
        raise Refusal("GATE_CHECKOUT_UNREADABLE")
    listed = git("ls-tree", "-r", "-z", head.stdout.strip())
    index = git("ls-files", "-s", "-z")
    if listed.returncode or index.returncode:
        raise Refusal("GATE_CHECKOUT_UNREADABLE")

    def entries(result):
        for entry in result.stdout.split(b"\0")[:-1]:
            meta, _, name = entry.partition(b"\t")
            yield name, meta.split(b" ")

    committed = {name: (mode, oid) for name, (mode, _, oid) in entries(listed)}
    staged = {}
    for name, (mode, oid, stage) in entries(index):
        if stage != b"0":
            return True
        staged[name] = (mode, oid)
    if staged != committed:
        return True

    links = {}
    for name, (mode, oid) in committed.items():
        try:
            # A directory of the path replaced by a link would read the file of another place.
            parts = name.split(b"/")
            for depth in range(1, len(parts)):
                parent = b"/".join(parts[:depth])
                if parent not in links:
                    links[parent] = stat.S_ISLNK(os.lstat(parent).st_mode)
                if links[parent]:
                    return True
            st = os.lstat(name)
            if mode == b"120000" and stat.S_ISLNK(st.st_mode):
                data = os.readlink(name)
            elif mode in (b"100644", b"100755") and stat.S_ISREG(st.st_mode):
                if bool(st.st_mode & 0o100) != (mode == b"100755"):
                    return True
                fd = os.open(name, os.O_RDONLY | FILE)
                try:
                    with os.fdopen(fd, "rb", closefd=False) as source:
                        data = source.read()
                finally:
                    os.close(fd)
            else:
                return True
        except OSError:
            return True
        blob = hashlib.sha1(b"blob %d\0" % len(data) + data, usedforsecurity=False)
        if blob.hexdigest().encode() != oid:
            return True
    return False


def clear_receipt(state):
    path = state / "latest.json"
    try:
        current = path.lstat()
    except FileNotFoundError:
        return
    private(current)
    path.unlink()
    sync_directory(state)


def main(args):
    # Read-only preflight for the other host adapters. It has no lease or receipt authority.
    if args == ["inspect-clean"]:
        checkout()
        fd = os.open(".", DIRECTORY)
        try:
            try:
                refuse_nested_repository(fd)
            except Refusal as error:
                if str(error) != "GATE_NESTED_REPOSITORY":
                    raise
                sys.exit(1)
            if dirty():
                sys.exit(1)
            untracked = git("ls-files", "--others", "--exclude-standard", "-z")
            if untracked.returncode:
                raise Refusal("GATE_CHECKOUT_UNREADABLE")
            sys.exit(1 if untracked.stdout else 0)
        finally:
            os.close(fd)
    if args == ["inspect-markers"]:
        fd = os.open(".", DIRECTORY)
        try:
            marker = visible_marker(fd, sys.stdin.buffer.read())
            if marker is not None:
                sys.stdout.buffer.write(marker)
        finally:
            os.close(fd)
        return

    editing = args in (["begin"], ["restore"], ["discard"]) or (
        len(args) == 2 and args[0] == "verify"
    )
    candidate = len(args) > 1 and args[0] == "candidate"
    verify_admission()
    tree = checkout()
    # Running or certifying a candidate is closed to a tree that holds a nested repository.
    # Restoring a recorded source and discarding a receipt stay open: they read no working file
    # through git, and a tree must be recoverable whatever was left in it.
    if candidate or args == ["begin"] or (len(args) == 2 and args[0] == "verify"):
        probe = os.open(tree, DIRECTORY)
        try:
            refuse_nested_repository(probe)
        finally:
            os.close(probe)
    fd, reused = lease(tree, editing or candidate)
    state = state_directory(fd)
    if candidate:
        # Keep the lease here while the candidate runs. No inherited descriptor or marker
        # authorizes a candidate to issue a mutation or publication on the host's lease.
        env = dict(os.environ)
        del env["AOS_GATE_LEASE_FD"]
        done = subprocess.run(args[1:], env=env, close_fds=True)
        sys.exit(done.returncode if done.returncode >= 0 else 128 - done.returncode)
    if args == ["begin"]:
        begin(fd, state, json.load(sys.stdin))
    elif args == ["restore"]:
        recover(fd, state)
    elif args == ["discard"]:
        clear_receipt(state)
    elif len(args) == 2 and args[0] == "verify":
        untracked = git("ls-files", "--others", "--exclude-standard", "-z")
        if (
            untracked.returncode
            or untracked.stdout
            or dirty()
            or git("rev-parse", "HEAD").stdout.decode().strip() != args[1]
        ):
            raise Refusal("GATE_RECEIPT_TREE_CHANGED")
    elif args == ["recover"]:
        recover(fd, state)
    elif len(args) > 1 and args[0] in ("exec", "full"):
        if not reused:
            recover(fd, state)
        if args[0] == "full":
            clear_receipt(state)
        refuse_nested_repository(fd)
        # Never run a gate over bytes left by a different runtime root, or overwrite an
        # operator's changes. A fresh clone or a clean linked worktree needs no pointer.
        if dirty():
            raise Refusal(
                "GATE_TREE_DIRTY: inspect tracked changes; retry with the original runtime root after an interrupted Gate"
            )
        os.execvp(args[1], args[1:])
    else:
        raise Refusal("GATE_LEASE_USAGE")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (Refusal, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(
            "gate:",
            str(error) if isinstance(error, Refusal) else "GATE_RECOVERY_UNAVAILABLE",
            file=sys.stderr,
        )
        sys.exit(2 if sys.argv[1:2] in (["inspect-clean"], ["inspect-markers"]) else 1)
