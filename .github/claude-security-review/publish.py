#!/usr/bin/env python3
"""Publish the findings of the Claude security review as one pull request comment.

Runs in the job `publish` of .github/workflows/claude-security-review.yml, after the review, with no model and no
secret but the job's token. The reviewer posts nothing itself: it returns JSON (`--json-schema`), which is untrusted,
since a prompt injected by the diff can shape it. This script checks it against findings.schema.json (beside this
file), neutralises what a reader could act on (an @mention, which an app such as Codex obeys whoever writes it; a
line `Verdict:`, which a merge resolver reads, kept out by writing each field on one line after a prefix; HTML),
and writes one comment.

  publish.py render    reads the JSON on stdin, prints the comment; exit 0, or 2 when the JSON is refused
  publish.py post      reads FINDINGS, PR, GITHUB_REPOSITORY, RUN_URL; posts the comment with gh; a refused JSON
                       posts a fixed notice instead and writes the reason to GITHUB_STEP_SUMMARY; exit 0, or 3
                       when gh fails

Only the standard library: the job installs nothing.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SCHEMA = Path(__file__).with_name("findings.schema.json")
# source: GitHub refuses an issue comment body above 65,536 characters; the margin keeps the header and the cut line.
MAX_BODY = 60_000
HEADER = "### Claude security review\n\nAdvisory: these findings block no merge (docs/infrastructure.md).\n"
REFUSED = (
    "### Claude security review\n\nThe review returned an output that failed validation; "
    "nothing of it is published. The job summary says why.\n"
)
# source: operational bound on one `gh` call, far above its usual second.
GH_TIMEOUT_SECONDS = 60


class Refused(ValueError):
    """The output of the reviewer does not satisfy the schema."""


def check(value: Any, schema: dict[str, Any], where: str = "$") -> None:
    """Check `value` against the subset of JSON Schema findings.schema.json uses; refuse any other keyword."""
    known = {
        "type", "enum", "required", "properties", "additionalProperties", "items",
        "maxItems", "minLength", "maxLength", "minimum", "maximum",
    }
    unknown = set(schema) - known
    if unknown:
        raise Refused(f"{where}: schema keyword not supported: {sorted(unknown)}")
    if "enum" in schema and value not in schema["enum"]:
        raise Refused(f"{where}: not one of {schema['enum']}")
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise Refused(f"{where}: not an object")
        for key in schema.get("required", []):
            if key not in value:
                raise Refused(f"{where}: missing {key}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(properties)
            if extra:
                raise Refused(f"{where}: unexpected {sorted(extra)}")
        for key, inner in value.items():
            if key in properties:
                check(inner, properties[key], f"{where}.{key}")
    elif kind == "array":
        if not isinstance(value, list):
            raise Refused(f"{where}: not an array")
        if len(value) > schema.get("maxItems", len(value)):
            raise Refused(f"{where}: more than {schema['maxItems']} items")
        for index, inner in enumerate(value):
            check(inner, schema.get("items", {}), f"{where}[{index}]")
    elif kind == "string":
        if not isinstance(value, str):
            raise Refused(f"{where}: not a string")
        if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", len(value)):
            raise Refused(f"{where}: length out of bounds")
    elif kind in ("integer", "number"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise Refused(f"{where}: not a number")
        if kind == "integer" and not isinstance(value, int):
            raise Refused(f"{where}: not an integer")
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            raise Refused(f"{where}: out of bounds")
    elif kind is not None:
        raise Refused(f"{where}: schema type not supported: {kind}")


def neutral(text: str) -> str:
    """Text a reader cannot act on: one line, no @mention, no HTML, no backtick to close a code span.

    One line is what keeps a `Verdict:` line out: every field is written after a prefix of its own on a line of the
    comment, so no field can begin a line, and a resolver that reads `^Verdict:` finds none.
    """
    flat = " ".join(line.strip() for line in text.splitlines() if line.strip())
    return flat.replace("@", "\uff20").replace("<", "&lt;").replace(">", "&gt;").replace("`", "'")


def parse(raw: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError) as error:
        raise Refused(f"$: not JSON ({type(error).__name__})") from None
    check(data, json.loads(SCHEMA.read_text(encoding="utf-8")))
    return data["findings"]


def render(findings: list[dict[str, Any]], run_url: str = "") -> str:
    parts = [HEADER]
    if run_url:
        parts.append(f"[Run]({neutral(run_url)})\n")
    if not findings:
        parts.append("\nNo security finding passed the filter.\n")
    for index, finding in enumerate(findings, start=1):
        parts.append(
            f"\n**{index}. {finding['severity']}, {neutral(finding['category'])}** "
            f"`{neutral(finding['file'])}:{finding['line']}` (confidence {finding['confidence']:.2f})\n\n"
            f"- Description: {neutral(finding['description'])}\n"
            f"- Exploit scenario: {neutral(finding['exploit_scenario'])}\n"
            f"- Recommendation: {neutral(finding['recommendation'])}\n"
        )
    body = "".join(parts)
    if len(body) > MAX_BODY:
        body = body[:MAX_BODY] + "\n\n(cut: the comment reached its bound)\n"
    return body


def summary(line: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def post(body: str) -> int:
    pr = os.environ["PR"]
    if not pr.isdigit():
        raise Refused("PR is not a number")
    with tempfile.TemporaryDirectory() as scratch:
        file = Path(scratch) / "body.md"
        file.write_text(body, encoding="utf-8")
        # A closed environment: the token, the path, and a config directory of its own.
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "GH_TOKEN": os.environ["GH_TOKEN"],
            "GH_CONFIG_DIR": scratch,
            "GH_PROMPT_DISABLED": "1",
        }
        done = subprocess.run(
            ["gh", "pr", "comment", pr, "--repo", os.environ["GITHUB_REPOSITORY"], "--body-file", str(file)],
            env=env,
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT_SECONDS,
            check=False,
        )
    if done.returncode != 0:
        summary("The findings could not be posted (gh exited with %d)." % done.returncode)
        return 3
    return 0


def main(argv: list[str]) -> int:
    if argv == ["render"]:
        try:
            sys.stdout.write(render(parse(sys.stdin.read())))
        except Refused as error:
            sys.stderr.write(f"refused: {error}\n")
            return 2
        return 0
    if argv == ["post"]:
        try:
            body = render(parse(os.environ.get("FINDINGS", "")), os.environ.get("RUN_URL", ""))
        except Refused as error:
            summary(f"The output of the review was refused: {error}.")
            return post(REFUSED)
        return post(body)
    sys.stderr.write("usage: publish.py render | post\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
