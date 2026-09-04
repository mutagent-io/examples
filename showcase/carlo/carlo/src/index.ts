/**
 * CARlo — public surface.
 *
 * Implements spec_id: carlo (.mutagent/specs/carlo/agentspec.yaml, AgentSpec 0.3.0).
 * The implementation points UP to the spec; the spec never enumerates the implementation.
 */

export { buildAgentCard } from "./a2a/card.ts";
export { A2AExecutor } from "./a2a/executor.ts";
export { createHandler, startServer } from "./a2a/server.ts";
export {
  BackboneError,
  buildContents,
  buildRequest,
  isRetryable,
  mapResult,
  mapUsage,
  THINKING_LEVEL_HIGH,
  thinkingConfigFor,
  VertexBackbone,
} from "./backbone/vertex.ts";
export { comb, compareToBaseline, computeMetrics, isSuccessful } from "./baseline.ts";
export type { CarloConfig, VerifyMode } from "./config.ts";
export {
  assertLiveReady,
  ConfigError,
  describeConfig,
  loadConfig,
  MINIMAL_THINKING_BUDGET,
} from "./config.ts";
export { conservativeChoice, decideEscalation } from "./escalation.ts";
export {
  buildInventory,
  getTool,
  hasParameter,
  hasTool,
  isStateChanging,
  listTools,
} from "./inventory.ts";
export { GatePipeline, MINIMAL_CALL_BUDGET, repairCall } from "./pipeline.ts";
export { compilePolicy, orderingFor, prerequisitesFor, rulesForTool } from "./policy.ts";
export {
  composeSystemInstruction,
  MINIMAL_BEHAVIOR_RULES,
  SYSTEM_PROMPT,
} from "./prompts.ts";
export { JsonlTraceSink, MemoryTraceSink } from "./trace.ts";
export * from "./types.ts";
export {
  checkFieldParity,
  hasCapabilityAbsence,
  isCapabilityAbsence,
  isRepairable,
  validateCall,
} from "./validator.ts";
