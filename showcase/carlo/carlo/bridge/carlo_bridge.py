"""Minimal Python bridge: CAR-bench `run.py` custom-agent factory -> HTTP -> the CARlo A2A server.

CARlo's PRIMARY artifact is the TypeScript A2A server (the competition surface). CAR-bench's local
harness, however, only accepts a Python `Agent` subclass through `run.py`'s `custom_agent_factory`
(car-bench/README.md#custom-agent-factory). This bridge is that adapter and nothing more: it
implements the two-method ABC and forwards each turn over the SAME A2A wire the official evaluator
uses, so local development, baseline measurement and evals exercise the production code path
instead of a parallel one.

The outbound mapping deliberately MIRRORS the evaluator's own
(car-bench-ijcai/src/evaluator/car_bench_evaluator.py:345-380):

    first turn      -> text Part "System: <wiki>\\n\\nUser: <msg>" + data Part {"tools": [...]}
    tool-result turn-> data Part {"tool_results": [{tool_name, tool_call_id, content}]}
    user turn       -> text Part with the user's message

and the response is converted back into the OpenAI-style assistant dict the orchestrator consumes
(car-bench/car_bench/orchestrator.py:22-38,169-212): `content` and/or
`tool_calls[{id, function:{name, arguments: <JSON string>}}]`.

The bridge NEVER executes a CAR-bench tool; it only relays tool-call requests.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Tuple
from uuid import uuid4

import httpx

from car_bench.agents.base import Agent
from car_bench.types import AgentState

DEFAULT_SERVER_URL = os.getenv("CARLO_SERVER_URL", "http://127.0.0.1:8080/")
DEFAULT_TIMEOUT = float(os.getenv("CARLO_BRIDGE_TIMEOUT_SECONDS", "600"))

# Mirrors car-bench-ijcai/src/agentbeats/sync_client.py
A2A_HEADERS = {"Content-Type": "application/a2a+json", "A2A-Version": "1.0"}


def _text_part(text: str) -> Dict[str, Any]:
    return {"text": text}


def _data_part(data: Dict[str, Any]) -> Dict[str, Any]:
    return {"data": data}


class CarloBridgeAgent(Agent):
    """A CAR-bench `Agent` whose reasoning lives in the CARlo A2A server."""

    def __init__(
        self,
        tools_info: List[Dict[str, Any]],
        wiki: str,
        server_url: str = DEFAULT_SERVER_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.tools_info = tools_info
        self.wiki = wiki or ""
        self.server_url = server_url
        self.timeout = timeout
        self.context_id: str | None = None
        self._first_message = True
        self._pending_tool_calls: List[Dict[str, Any]] = []

    # ── CAR-bench Agent ABC ────────────────────────────────────────────────────────────────────
    def get_init_state(self, system_prompt: str, initial_observation: str) -> AgentState:
        self.wiki = system_prompt or self.wiki
        self._first_message = True
        self.context_id = None
        self._pending_tool_calls = []
        return AgentState(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": initial_observation},
            ]
        )

    def generate_next_message(
        self, state: AgentState, tools_info: List[Dict[str, Any]]
    ) -> Tuple[Dict[str, Any], AgentState]:
        parts = self._outbound_parts(state, tools_info)
        source = "environment" if self._trailing_tool_messages(state) else "user"

        response_message = self._send(parts, metadata={"source": source})
        next_message = self._to_assistant_message(response_message)

        turn_metrics = self._extract_turn_metrics(response_message)
        updated = AgentState(
            messages=state.messages + [next_message],
            total_cost=state.total_cost + float(turn_metrics.get("cost", 0.0) or 0.0),
            total_llm_induced_latency_ms=state.total_llm_induced_latency_ms
            + float(turn_metrics.get("avg_llm_call_time_ms", 0.0) or 0.0)
            * float(turn_metrics.get("num_llm_calls", 0) or 0),
            turn_counter=state.turn_counter,
            least_prompt_tokens=state.least_prompt_tokens,
            latest_prompt_tokens=int(
                turn_metrics.get("prompt_tokens", state.latest_prompt_tokens) or 0
            ),
        )
        return next_message, updated

    # ── outbound mapping (mirrors the official evaluator) ──────────────────────────────────────
    def _trailing_tool_messages(self, state: AgentState) -> List[Dict[str, Any]]:
        trailing: List[Dict[str, Any]] = []
        for message in reversed(state.messages):
            if message.get("role") == "tool":
                trailing.insert(0, message)
            else:
                break
        return trailing

    def _outbound_parts(
        self, state: AgentState, tools_info: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        tool_messages = self._trailing_tool_messages(state)
        last_content = state.messages[-1].get("content") if state.messages else ""
        if not last_content or not str(last_content).strip():
            last_content = "none"  # the evaluator's empty-message sentinel

        if self._first_message:
            self._first_message = False
            system_prompt = (
                state.messages[0]["content"] if state.messages[0].get("role") == "system" else ""
            )
            text = f"System: {system_prompt}\n\nUser: {last_content}" if system_prompt else str(last_content)
            parts = [_text_part(text)]
            if tools_info:
                parts.append(_data_part({"tools": tools_info}))
            return parts

        if tool_messages:
            return [
                _data_part(
                    {
                        "tool_results": [
                            {
                                "tool_name": message.get("name", ""),
                                "tool_call_id": message.get("tool_call_id", ""),
                                "content": message.get("content", ""),
                            }
                            for message in tool_messages
                        ]
                    }
                )
            ]

        return [_text_part(str(last_content))]

    def _send(self, parts: List[Dict[str, Any]], metadata: Dict[str, Any]) -> Dict[str, Any]:
        message: Dict[str, Any] = {
            "messageId": uuid4().hex,
            "role": "ROLE_USER",
            "parts": parts,
            "metadata": metadata,
        }
        if self.context_id:
            message["contextId"] = self.context_id

        payload = {
            "jsonrpc": "2.0",
            "id": uuid4().hex,
            "method": "SendMessage",
            "params": {"message": message},
        }

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(self.server_url, json=payload, headers=A2A_HEADERS)
            response.raise_for_status()
            body = response.json()

        if "error" in body:
            raise RuntimeError(f"CARlo server returned a JSON-RPC error: {body['error']}")

        result_message = body.get("result", {}).get("message", {})
        # Echo the server's contextId back on every later turn, exactly as the evaluator does.
        if result_message.get("contextId"):
            self.context_id = result_message["contextId"]
        return result_message

    # ── inbound mapping (back to the OpenAI-style assistant dict) ──────────────────────────────
    def _to_assistant_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        content: str | None = None
        tool_calls: List[Dict[str, Any]] = []

        for part in message.get("parts", []):
            if "text" in part:
                content = part["text"]
            elif "data" in part:
                data = part["data"] or {}
                for call in data.get("tool_calls", []) or []:
                    tool_calls.append(
                        {
                            "id": f"call_{uuid4().hex[:8]}",
                            "type": "function",
                            "function": {
                                "name": call.get("tool_name", ""),
                                # The orchestrator json-decodes this string itself.
                                "arguments": json.dumps(call.get("arguments", {})),
                            },
                        }
                    )

        assistant: Dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            assistant["tool_calls"] = tool_calls
        return assistant

    @staticmethod
    def _extract_turn_metrics(message: Dict[str, Any]) -> Dict[str, Any]:
        metadata = message.get("metadata") or {}
        return metadata.get("turn_metrics") or {}


def make_carlo(
    tools_info: List[Dict[str, Any]], wiki: Any, args: Any = None
) -> CarloBridgeAgent:
    """The `custom_agent_factory` CAR-bench's run.py expects: (tools_info, wiki, args) -> Agent."""
    server_url = getattr(args, "carlo_server_url", None) or DEFAULT_SERVER_URL
    return CarloBridgeAgent(tools_info=tools_info, wiki=wiki, server_url=server_url)
