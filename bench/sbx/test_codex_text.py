"""Offline contract tests for the native text probe. No client or account is required."""

import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("codex_guest", Path(__file__).with_name("codex-guest.py"))
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)

MODEL = "fixture-model"
TEXT = "AOS-00000000-0000-4000-8000-000000000000"
PROMPT = "Reply with exactly this value: " + TEXT
USAGE = {"input_tokens": 8, "output_tokens": 4}


def response_events():
    header = {"id": "resp_fixture", "object": "response", "model": MODEL}
    item = {"id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": TEXT, "annotations": []}]}
    return [
        {"type": "response.created", "response": {**header, "status": "in_progress"}},
        {"type": "response.output_item.done", "output_index": 0, "item": item},
        {"type": "response.completed",
         "response": {**header, "status": "completed", "output": [item],
                      "usage": {**USAGE, "total_tokens": sum(USAGE.values())}}},
    ]


def sse(events):
    return "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events)


def ndjson(events):
    return b"".join(json.dumps(event).encode() + b"\n" for event in events)


class TextContract(unittest.TestCase):
    def test_only_an_admitted_http_request_can_trigger_one_host_turn(self):
        body = json.dumps({"model": MODEL, "stream": True, "input": [
            {"role": "user", "content": [{"type": "input_text", "text": PROMPT}]}]}).encode()
        reply = ndjson([{"kind": "response", "body": sse(response_events())}])

        def new_server():
            return SimpleNamespace(server_port=80, model=MODEL, prompt=PROMPT, challenge=TEXT,
                                   requested=False, refused=False, expected=None)

        def invoke(server, method="POST", path="/v1/responses", extra_header=None):
            headers = [f"{method} {path} HTTP/1.0", "Host: 127.0.0.1:80", "Content-Type: application/json",
                       f"Content-Length: {len(body)}"]
            if extra_header:
                headers.append(extra_header)
            local, remote = socket.socketpair()
            with local, remote:
                remote.sendall(("\r\n".join(headers) + "\r\n\r\n").encode() + body)
                remote.shutdown(socket.SHUT_WR)
                output = io.StringIO()
                with redirect_stdout(output), patch.object(sys, "stdin", SimpleNamespace(buffer=io.BytesIO(reply))):
                    guest.TextResponses(local, ("127.0.0.1", 0), server)
                local.shutdown(socket.SHUT_WR)
                with remote.makefile("rb") as response:
                    status = int(response.readline().split()[1])
                return status, output.getvalue()

        fresh = new_server()
        status, emitted = invoke(fresh)
        self.assertEqual(status, 200)
        self.assertEqual([json.loads(line) for line in emitted.splitlines()], [{"kind": "request", "model": MODEL}])
        self.assertEqual(fresh.expected, (TEXT, USAGE))
        self.assertEqual(invoke(fresh), (403, ""))
        for fields in ({"method": "GET"}, {"path": "/elsewhere"}, {"extra_header": "Authorization: synthetic"},
                       {"extra_header": "Transfer-Encoding: chunked"}, {"extra_header": "Content-Length: 1"}):
            fresh = new_server()
            with self.subTest(fields=fields):
                status, emitted = invoke(fresh, **fields)
                self.assertGreaterEqual(status, 400)
                self.assertEqual(emitted, "")
                self.assertTrue(fresh.refused)
                self.assertFalse(fresh.requested)

    def test_match_only_the_original_prompt(self):
        user = {"role": "user", "content": [{"type": "input_text", "text": PROMPT}]}
        context = {"role": "user", "content": [{"type": "input_text", "text": "<environment_context>ephemeral</environment_context>"}]}
        developer = {"role": "developer", "content": [{"type": "input_text", "text": "native instructions"}]}
        tool = {"type": "function", "name": "fixture", "parameters": {"type": "object"}, "strict": True}
        namespace = {"type": "namespace", "name": "fixture", "tools": [tool]}
        declarations = {"type": "additional_tools", "role": "developer", "id": "fixture", "tools": [namespace]}
        envelope = {"model": MODEL, "stream": True, "input": [declarations, developer, context, user]}
        self.assertTrue(guest.eligible_request(envelope, MODEL, PROMPT))
        self.assertFalse(guest.eligible_request(envelope, "other", PROMPT))
        for entry in (user, {"type": "function_call_output", "content": []},
                      declarations, {"role": "developer", "content": []}, {"role": "user", "content": []},
                      {"role": "system", "content": []},
                      {"role": "user", "content": [{"type": "input_text", "text": "another prompt"}]}):
            with self.subTest(entry=entry):
                self.assertFalse(guest.eligible_request({**envelope, "input": [user, entry]}, MODEL, PROMPT))
        self.assertFalse(guest.eligible_request({**envelope, "input": [context]}, MODEL, PROMPT))
        for bad in ({**declarations, "role": "user"}, {**declarations, "method": "run"},
                    {**declarations, "tools": [{**namespace, "tools": [{**tool, "call_id": "call"}]}]},
                    {**declarations, "tools": [{**namespace, "tools": [{"type": "function_call", "name": "fixture"}]}]}):
            with self.subTest(catalog=bad):
                self.assertFalse(guest.eligible_request({**envelope, "input": [bad, user]}, MODEL, PROMPT))

    def test_refuse_invalid_frames(self):
        for raw in (b'{"model":"x","model":"y"}\n', b"{}", b"\xff\n", b" " * guest.FRAME_BYTES + b"\n"):
            with self.subTest(size=len(raw)), self.assertRaises(ValueError):
                guest.read_frame(io.BytesIO(raw))

    def test_bind_challenge_to_one_canonical_host_prompt(self):
        self.assertEqual(guest.challenge_from(PROMPT), TEXT)
        for bad in (TEXT, PROMPT + " ", PROMPT + "\n", PROMPT + PROMPT, PROMPT.replace("4000", "1000")):
            with self.subTest(prompt=bad), self.assertRaises(ValueError):
                guest.challenge_from(bad)

    def test_validate_host_turn_before_relay(self):
        valid = response_events()
        self.assertEqual(guest.text_response(sse(valid), MODEL, TEXT), (TEXT, USAGE))
        for field, value in (("status", "incomplete"), ("model", "other"), ("id", "other"), ("output", []),
                             ("usage", {**USAGE, "input_tokens": True})):
            events = copy.deepcopy(valid)
            events[-1]["response"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                guest.text_response(sse(events), MODEL, TEXT)
        events = response_events()
        events[1]["item"]["content"][0]["type"] = "refusal"
        with self.assertRaises(ValueError):
            guest.text_response(sse(events), MODEL, TEXT)
        for bad in (TEXT[:-1], TEXT[4:], "AOS", PROMPT, TEXT + " "):
            events = response_events()
            events[1]["item"]["content"][0]["text"] = bad
            with self.subTest(text=bad), self.assertRaises(ValueError):
                guest.text_response(sse(events), MODEL, TEXT)
        for bad in (valid + valid, valid[:2], valid[:1] + [{"type": "response.function_call_arguments.delta"}] + valid[1:]):
            with self.subTest(length=len(bad)), self.assertRaises(ValueError):
                guest.text_response(sse(bad), MODEL, TEXT)

    def test_require_the_native_text_and_terminal_usage(self):
        native = [{"type": "thread.started"}, {"type": "turn.started"},
                  {"type": "item.completed", "item": {"type": "agent_message", "text": TEXT}},
                  {"type": "turn.completed", "usage": USAGE.copy()}]
        self.assertEqual(guest.observed_turn(ndjson(native)), (TEXT, USAGE))
        for bad in (native[:-1], native + native, native[:-1] + [{"type": "turn.failed"}],
                    native[:2] + [{"type": "item.completed", "item": {"type": "command_execution"}}] + native[3:],
                    native[:2] + [{"type": "approval.requested"}] + native[2:]):
            with self.subTest(events=len(bad)), self.assertRaises(ValueError):
                guest.observed_turn(ndjson(bad))


if __name__ == "__main__":
    unittest.main()
