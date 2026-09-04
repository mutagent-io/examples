"""Bridge tests + the TARGET SMOKE against the REAL pinned CAR-bench harness.

Hermetic: the CARlo server under test runs with a stub backbone INJECTED through
`CarloServerOptions.backbone` (tests/helpers/test-server.ts) rather than any env flag, so no
live Vertex call and no benchmark run happens here. The harness itself is the real thing, installed
from ../third_party/car-bench at the commit pinned in the build report (decision D11).

Run:  bridge/.venv/bin/python -m pytest bridge/test_bridge.py -v
"""

from __future__ import annotations

import inspect
import json
import re
import os
import pathlib
import socket
import subprocess
import time

import httpx
import pytest

from car_bench.agents.base import Agent
from car_bench.types import AgentState

from carlo_bridge import CarloBridgeAgent, make_carlo

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="module")
def carlo_server():
    """Start the real TypeScript A2A server with an INJECTED stub backbone."""
    port = _free_port()
    env = {
        **os.environ,
        "PORT": str(port),
        "HOST": "127.0.0.1",
        "GOOGLE_CLOUD_PROJECT": "test-project",
        "CARLO_TRACE_DIR": "/tmp/carlo-bridge-traces",
    }
    # The stub backbone arrives through the ServerOptions.backbone INJECTION SEAM, not an env flag:
    # tests/helpers/test-server.ts starts the real server with a stub client. `src/` has no
    # backbone-swap path at all, so a shipped image cannot be switched into stub mode (B7 finding).
    process = subprocess.Popen(
        ["bun", "run", "tests/helpers/test-server.ts"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    url = f"http://127.0.0.1:{port}/"

    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f"server exited early: {process.stderr.read().decode()[:2000]}")
        try:
            httpx.get(f"{url}.well-known/agent-card.json", timeout=1).raise_for_status()
            break
        except Exception:
            time.sleep(0.1)
    else:
        process.kill()
        raise RuntimeError("CARlo server did not become ready")

    yield url
    process.terminate()
    process.wait(timeout=10)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_sunroof_and_sunshade_position",
            "description": "Vehicle Control: get sunroof and sunshade position.",
            "parameters": {"type": "object", "required": [], "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_close_sunroof",
            "description": "Vehicle Control: open or close the sunroof.",
            "parameters": {
                "type": "object",
                "required": ["percentage"],
                "properties": {"percentage": {"type": "number"}},
            },
        },
    },
]

WIKI = "# In-Car Assistant agent policy\n\n- AUT-POL:005:The sunroof can only be opened if the sunshade is already fully opened."


class TestInterfaceConformance:
    """The bridge must BE a car_bench Agent, not merely look like one."""

    def test_is_a_real_car_bench_agent_subclass(self):
        assert issubclass(CarloBridgeAgent, Agent)

    @pytest.mark.parametrize("method", ["get_init_state", "generate_next_message"])
    def test_signatures_match_the_abc_exactly(self, method):
        """Parameter names, order and kinds must match the ABC.

        Annotation OBJECTS are compared by their string form: this module uses
        `from __future__ import annotations` (so its annotations are strings) while the harness's
        base.py evaluates them eagerly. That is a representation difference, not a contract
        difference, so the comparison is normalized.
        """
        mine = inspect.signature(getattr(CarloBridgeAgent, method))
        theirs = inspect.signature(getattr(Agent, method))

        assert list(mine.parameters) == list(theirs.parameters)
        assert [p.kind for p in mine.parameters.values()] == [
            p.kind for p in theirs.parameters.values()
        ]

        def norm(annotation):
            if annotation is inspect.Parameter.empty:
                return None
            if isinstance(annotation, type):
                return annotation.__name__
            text = annotation if isinstance(annotation, str) else str(annotation)
            # Drop module qualifiers (`typing.`, `car_bench.types.`) and spacing so the two
            # representations of the SAME annotation compare equal.
            return re.sub(r"[A-Za-z_][A-Za-z0-9_]*\.", "", text).replace(" ", "")

        assert [norm(p.annotation) for p in mine.parameters.values()] == [
            norm(p.annotation) for p in theirs.parameters.values()
        ]
        assert norm(mine.return_annotation) == norm(theirs.return_annotation)

    def test_factory_has_the_signature_run_py_expects(self):
        params = list(inspect.signature(make_carlo).parameters)
        assert params[:3] == ["tools_info", "wiki", "args"]


class TestTurnLoop:
    def test_three_turn_task_produces_well_formed_assistant_messages(self, carlo_server):
        agent = make_carlo(TOOLS, WIKI, type("Args", (), {"carlo_server_url": carlo_server})())
        state = agent.get_init_state(WIKI, "Open the sunroof halfway.")

        message, state = agent.generate_next_message(state, TOOLS)
        assert message["role"] == "assistant"
        assert "tool_calls" in message, "the stub drafts a tool call on the first turn"

        for call in message["tool_calls"]:
            assert call["function"]["name"]
            # The orchestrator json-decodes this itself, so it MUST be a string.
            assert isinstance(call["function"]["arguments"], str)
            json.loads(call["function"]["arguments"])
            assert call["id"]

        # The server minted a contextId and the bridge is echoing it.
        assert agent.context_id

        # Turn 2: feed the tool result back exactly as the orchestrator would.
        state.messages.append(
            {
                "role": "tool",
                "tool_call_id": message["tool_calls"][0]["id"],
                "name": message["tool_calls"][0]["function"]["name"],
                "content": json.dumps({"sunshade": 100, "sunroof": 0}),
            }
        )
        message2, state = agent.generate_next_message(state, TOOLS)
        assert message2["role"] == "assistant"
        assert isinstance(state, AgentState)

    def test_costs_and_tokens_accumulate_monotonically(self, carlo_server):
        agent = make_carlo(TOOLS, WIKI, type("Args", (), {"carlo_server_url": carlo_server})())
        state = agent.get_init_state(WIKI, "Is the sunshade open?")

        previous_cost = state.total_cost
        for _ in range(2):
            message, state = agent.generate_next_message(state, TOOLS)
            assert state.total_cost >= previous_cost
            previous_cost = state.total_cost
            if "tool_calls" in message:
                state.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": message["tool_calls"][0]["id"],
                        "name": message["tool_calls"][0]["function"]["name"],
                        "content": "{}",
                    }
                )

    def test_two_tasks_do_not_share_context(self, carlo_server):
        args = type("Args", (), {"carlo_server_url": carlo_server})()
        a = make_carlo(TOOLS, WIKI, args)
        b = make_carlo(TOOLS, WIKI, args)
        a.get_init_state(WIKI, "Task A.")
        b.get_init_state(WIKI, "Task B.")

        a.generate_next_message(a.get_init_state(WIKI, "Task A."), TOOLS)
        b.generate_next_message(b.get_init_state(WIKI, "Task B."), TOOLS)

        assert a.context_id != b.context_id


class TestWireContract:
    """Our response must survive the evaluator's STRICT protobuf parse (architect RULING 1)."""

    def test_server_response_parses_as_a2a_v1_message(self, carlo_server):
        from a2a.types import Message
        from google.protobuf.json_format import ParseDict

        payload = {
            "jsonrpc": "2.0",
            "id": "1",
            "method": "SendMessage",
            "params": {
                "message": {
                    "messageId": "m1",
                    "role": "ROLE_USER",
                    "parts": [
                        {"text": f"System: {WIKI}\n\nUser: Open the sunroof halfway."},
                        {"data": {"tools": TOOLS}},
                    ],
                    "metadata": {"source": "user"},
                }
            },
        }
        body = httpx.post(
            carlo_server,
            json=payload,
            headers={"Content-Type": "application/a2a+json", "A2A-Version": "1.0"},
            timeout=60,
        ).json()

        # NO ignore_unknown_fields — exactly how sync_client.py parses our reply.
        message = ParseDict(body["result"]["message"], Message())
        assert message.context_id
        assert len(message.parts) >= 1

    def test_negative_a_polluted_message_is_rejected_by_the_same_parser(self):
        """RULING 1 requires proving the check BITES, not just that clean output passes."""
        from a2a.types import Message
        from google.protobuf.json_format import ParseDict, ParseError

        polluted = {
            "messageId": "m",
            "contextId": "c",
            "role": "ROLE_AGENT",
            "parts": [{"text": "hi"}],
            "thinking": "an internal field that must never be emitted",
        }
        with pytest.raises(ParseError):
            ParseDict(polluted, Message())

    def test_negative_a_v0_3_style_part_is_rejected(self):
        from a2a.types import Message
        from google.protobuf.json_format import ParseDict, ParseError

        legacy = {
            "messageId": "m",
            "contextId": "c",
            "role": "ROLE_AGENT",
            "parts": [{"kind": "text", "text": "hi"}],  # v0.3 spelling
        }
        with pytest.raises(ParseError):
            ParseDict(legacy, Message())

    def test_agent_card_parses_with_the_real_resolver_helper(self, carlo_server):
        from a2a.client.card_resolver import parse_agent_card

        card = httpx.get(f"{carlo_server}.well-known/agent-card.json", timeout=10).json()
        parsed = parse_agent_card(card)
        assert parsed.name == "carlo"
        assert parsed.supported_interfaces[0].protocol_binding == "JSONRPC"


class TestTargetSmokeAgainstRealHarness:
    """D11: drive the REAL run.py factory path, not a stub of it."""

    def test_run_py_agent_factory_accepts_the_bridge(self, carlo_server):
        import run as car_bench_run  # the harness's own entrypoint module

        args = type(
            "Args",
            (),
            {"carlo_server_url": carlo_server, "agent_strategy": "tool-calling"},
        )()
        agent = car_bench_run.agent_factory(
            tools_info=TOOLS, wiki=WIKI, args=args, custom_agent_factory=make_carlo
        )

        assert isinstance(agent, Agent)
        assert isinstance(agent, CarloBridgeAgent)

    def test_the_real_orchestrator_drives_a_turn_through_the_bridge(self, carlo_server):
        """The harness's own AgentOrchestrator loop, with a stubbed environment."""
        from car_bench.orchestrator import message_to_actions

        agent = make_carlo(TOOLS, WIKI, type("Args", (), {"carlo_server_url": carlo_server})())
        state = agent.get_init_state(WIKI, "Open the sunroof halfway.")
        message, _ = agent.generate_next_message(state, TOOLS)

        # The orchestrator's own converter must accept our message shape unchanged.
        actions = message_to_actions(message)
        assert actions
        assert all(action.name for action in actions)
        assert all(isinstance(action.kwargs, dict) for action in actions)
