/**
 * The agent card served at `/.well-known/agent-card.json`.
 *
 * Its only consumer is the readiness probe: car-bench-ijcai/src/agentbeats/run_scenario.py
 * ::check_endpoint calls `A2ACardResolver(base_url).get_agent_card()` before a run starts. That
 * resolver parses with `ParseDict(..., AgentCard(), ignore_unknown_fields=True)` plus legacy-field
 * compatibility (a2a-python/src/a2a/client/card_resolver.py::parse_agent_card), so a small, correct
 * card is sufficient — but `supportedInterfaces` must advertise the JSONRPC 1.0 binding we serve.
 *
 * Field shape mirrors the organizer reference card
 * (car-bench-ijcai/src/track_1_agent_under_test/server.py::prepare_agent_card).
 */

export interface AgentCardOptions {
  url: string;
  version?: string;
}

export function buildAgentCard(options: AgentCardOptions): Record<string, unknown> {
  return {
    name: "carlo",
    description: "CARlo — reliable in-car voice assistant agent for CAR-bench evaluation",
    version: options.version ?? "0.1.0",
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    supportedInterfaces: [
      {
        url: options.url,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    skills: [
      {
        id: "car_assistant",
        name: "In-Car Voice Assistant",
        description:
          "Helps drivers with navigation, vehicle controls, charging, and productivity tasks",
        tags: ["benchmark", "car-bench", "voice-assistant"],
      },
    ],
  };
}
