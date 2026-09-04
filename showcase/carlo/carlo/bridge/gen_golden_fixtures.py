"""Generate the golden A2A wire fixtures with the GENUINE a2a-sdk serializer.

Why this exists: the evaluator's agent-under-test path is a raw JSON-RPC POST built by
`car-bench-ijcai/src/agentbeats/sync_client.py::build_send_message_jsonrpc_request`, i.e.
`{"jsonrpc":"2.0","id":..,"method":"SendMessage","params":{"message": MessageToDict(<Message>)}}`,
and it parses our reply with `ParseDict(..., Message())` and NO `ignore_unknown_fields`. Rather than
hand-writing what I *believe* those bytes look like, this script builds them with the same protobuf
types the evaluator uses, so the TypeScript codec is tested against the real thing.

Offline: no network, no LLM, no evaluator process.

Usage:  bridge/.venv/bin/python bridge/gen_golden_fixtures.py
"""

from __future__ import annotations

import json
import pathlib
from uuid import uuid4

from a2a.types import Message, Role
from a2a.helpers.proto_helpers import new_text_part, new_data_part
from google.protobuf.json_format import MessageToDict

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "golden"
WIKI = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "wiki.md"

# A tiny but structurally faithful slice of the real tool payload.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Weather: get the weather for a location.",
            "parameters": {
                "type": "object",
                "required": ["location_or_poi_id"],
                "properties": {
                    "location_or_poi_id": {"type": "string", "description": "Location id"}
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_close_sunroof",
            "description": "Vehicle Control: Open or close the sunroof to a percentage.",
            "parameters": {
                "type": "object",
                "required": ["percentage"],
                "properties": {
                    "percentage": {"type": "number", "description": "0 to 100"}
                },
                "additionalProperties": False,
            },
        },
    },
]


def build_message(parts, *, context_id: str | None, metadata: dict) -> Message:
    """Mirror sync_client.create_message_with_parts."""
    msg = Message(role=Role.ROLE_USER, message_id=uuid4().hex)
    if context_id:
        msg.context_id = context_id
    msg.metadata.update(metadata)
    for part in parts:
        msg.parts.append(part)
    return msg


def jsonrpc(message: Message) -> dict:
    """Mirror sync_client.build_send_message_jsonrpc_request."""
    return {
        "jsonrpc": "2.0",
        "id": uuid4().hex,
        "method": "SendMessage",
        "params": {"message": MessageToDict(message)},
    }


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    wiki = WIKI.read_text()

    # Turn 1 — the evaluator sends System:/User: text plus the tool definitions, and NO contextId.
    first = build_message(
        [
            new_text_part(f"System: {wiki}\n\nUser: Open the sunroof halfway."),
            new_data_part({"tools": TOOLS}),
        ],
        context_id=None,
        metadata={"source": "user"},
    )
    (FIXTURES / "request-first.json").write_text(json.dumps(jsonrpc(first), indent=2))

    # Turn 2 — structured tool results.
    tool_results = build_message(
        [
            new_data_part(
                {
                    "tool_results": [
                        {
                            "tool_name": "get_weather",
                            "tool_call_id": "call_1",
                            "content": '{"condition":"sunny"}',
                        }
                    ]
                }
            )
        ],
        context_id="ctx-abc",
        metadata={"source": "environment"},
    )
    (FIXTURES / "request-tool-results.json").write_text(json.dumps(jsonrpc(tool_results), indent=2))

    # Turn 3 — a plain simulated-user follow-up.
    follow_up = build_message(
        [new_text_part("Yes, please.")], context_id="ctx-abc", metadata={"source": "user"}
    )
    (FIXTURES / "request-user.json").write_text(json.dumps(jsonrpc(follow_up), indent=2))

    print(f"wrote 3 golden request fixtures to {FIXTURES}")


if __name__ == "__main__":
    main()
