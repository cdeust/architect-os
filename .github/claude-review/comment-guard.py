#!/usr/bin/env python3
"""Refuse, before it is created, a comment of the Claude review that a reader could act on.

A PreToolUse hook of the managed settings that claude-review.yml installs in /etc/claude-code
(features/descriptive/comment-guard.feature). Claude Code runs it before each call of the two tools that publish:
the tracking comment (`mcp__github_comment__update_claude_comment`) and the inline comments
(`mcp__github_inline_comment__create_inline_comment`). It reads the call on stdin (code.claude.com/docs/en/hooks,
"PreToolUse input": `tool_name`, `tool_input`) and refuses it with `permissionDecision: "deny"` on stdout, exit 0
(the same page, "PreToolUse decision control"); Claude receives the reason and writes the comment again.

A comment is acted on when it is created: an app such as Codex obeys an @mention whoever writes it, and the merge
resolver of pipeline-after-merge.yml reads a line `Verdict:` of claude[bot] next to the link of the run. So the
guard refuses a mention anywhere, a verdict anywhere but the last line of the tracking comment after the link of
this run, and the shape of a credential. It reads the body as it reads (format characters removed, compatibility
forms folded), so a zero-width character cuts neither a mention nor a key. Its reasons are fixed: none echoes the
comment. What it cannot read, it refuses.

Only the standard library: it runs as Claude Code's child, with nothing installed.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from typing import Any

MENTION = "The comment holds an @ followed by a name: GitHub apps obey a mention whoever writes it. Name the account without @."
VERDICT = "A line Verdict: may only end the tracking comment, after the link of this run. Put the verdict there, once."
CREDENTIAL = "The comment holds the shape of a credential. Do not quote a key or a token."
UNREADABLE = "The guard could not read this call."

TRACKING = "mcp__github_comment__update_claude_comment"
INLINE = "mcp__github_inline_comment__create_inline_comment"

# An @ before a letter or a digit: the start of a GitHub login, which a mention needs.
AT_NAME = re.compile(r"@[A-Za-z0-9]")
VERDICT_LINE = re.compile(r"^\s*verdict\s*:", re.IGNORECASE)
VERDICT_EXACT = re.compile(r"Verdict: (approve|block)")
# source: the prefixes of the keys and OAuth tokens of the Claude Console (sk-ant-) and of GitHub tokens
# (https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/).
KEY = re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}|gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}")


def visible(text: str) -> str:
    """The text as it reads: no format character (category Cf), compatibility forms folded (NFKC: `＠` is `@`)."""
    return unicodedata.normalize("NFKC", "".join(c for c in text if unicodedata.category(c) != "Cf"))


def run_link() -> str | None:
    """The line that links this run, as the prompt of claude-review.yml asks for it; None outside a run."""
    server = os.environ.get("GITHUB_SERVER_URL", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    if not (server and repository and run_id.isdigit()):
        return None
    return f"[View job run]({server}/{repository}/actions/runs/{run_id})"


def verdict_refused(tool: str, lines: list[str]) -> bool:
    at = [index for index, line in enumerate(lines) if VERDICT_LINE.match(line)]
    if not at:
        return False
    if tool != TRACKING or len(at) > 1:
        return True
    filled = [line.strip() for line in lines if line.strip()]
    if len(filled) < 2 or not VERDICT_EXACT.fullmatch(filled[-1]):
        return True
    link = run_link()
    return link is None or filled[-2] != link


def decide(call: Any) -> str | None:
    """The fixed reason of a refusal, or None to let the call through."""
    if not isinstance(call, dict):
        return UNREADABLE
    tool = call.get("tool_name")
    if tool not in (TRACKING, INLINE):
        return None
    payload = call.get("tool_input")
    body = payload.get("body") if isinstance(payload, dict) else None
    if not isinstance(body, str):
        return UNREADABLE
    text = visible(body)
    if KEY.search(text):
        return CREDENTIAL
    if AT_NAME.search(text):
        return MENTION
    if verdict_refused(tool, text.splitlines()):
        return VERDICT
    return None


def main() -> int:
    try:
        reason = decide(json.loads(sys.stdin.read()))
    except (ValueError, RecursionError, UnicodeDecodeError):
        reason = UNREADABLE
    if reason is not None:
        sys.stdout.write(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
            )
            + "\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
