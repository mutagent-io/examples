// @implements capability-inventory
/**
 * Compiles the per-task tool definitions the evaluator delivers into an exact inventory
 * (tools, parameters, enums) — the ground truth for the feasibility gate and argument validation.
 *
 * The inventory is rebuilt from the CURRENT payload on every task and never cached across tasks:
 * hallucination tasks are constructed by REMOVING tools, parameters or results
 * (car-bench/README.md#2-hallucination-tasks), and the evaluator has already stripped
 * `planning_tool`/`think` plus the task's `removed_part` before we see the list
 * (car-bench/car_bench/orchestrator.py:126-136). A remembered superset would fabricate capability.
 */

import type { Inventory, RawToolDefinition, ToolEntry } from "./types.ts";

/**
 * CAR-bench splits its 58 tools into `set_apis/` (27, state-changing), `get_apis/` (29) and 2
 * no-ops (car-bench/README.md#key-features). State-changing status is derived from the declared
 * name, never from a hardcoded allow-list of specific tools.
 */
const STATE_CHANGING_PREFIXES = [
  "set_",
  "open_",
  "close_",
  "send_",
  "call_",
  "delete_",
  "navigation_",
];
const READ_ONLY_PREFIXES = ["get_", "search_", "calculate_", "convert_", "think", "planning"];

/**
 * CAR-bench marks confirmation-gated tools by PREFIXING the description (wiki POL:004: "If the tool
 * description starts with REQUIRES_CONFIRMATION ..."). Anchored at the start on purpose: a mere
 * mention inside a description is not the binding.
 */
const REQUIRES_CONFIRMATION = /^REQUIRES_CONFIRMATION/;

export function isStateChanging(toolName: string): boolean {
  const name = toolName.toLowerCase();
  if (READ_ONLY_PREFIXES.some((p) => name.startsWith(p))) return false;
  return STATE_CHANGING_PREFIXES.some((p) => name.startsWith(p));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Build the inventory. Malformed entries are EXCLUDED and counted; parsing never throws. */
export function buildInventory(
  definitions: readonly RawToolDefinition[] | null | undefined,
): Inventory {
  const tools: Record<string, ToolEntry> = {};
  const order: string[] = [];
  let malformed = 0;

  for (const def of definitions ?? []) {
    const fn = asRecord(def?.function);
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!fn || name === "") {
      malformed += 1;
      continue;
    }

    const parameters = asRecord(fn.parameters) ?? {};
    const properties = asRecord(parameters.properties) ?? {};
    const propertyEntries: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(properties)) {
      const schema = asRecord(value);
      if (schema) propertyEntries[key] = schema;
    }

    const requiredRaw = parameters.required;
    const required = Array.isArray(requiredRaw)
      ? requiredRaw.filter((r): r is string => typeof r === "string")
      : [];

    if (name in tools) {
      malformed += 1;
      continue;
    }

    const description = typeof fn.description === "string" ? fn.description : "";

    tools[name] = {
      name,
      description,
      // RAW schema, preserved byte-for-byte: it is handed to the model as `parametersJsonSchema`
      // and the evaluator must see the exact declared names/structure back.
      parameters,
      properties: propertyEntries,
      required,
      stateChanging: isStateChanging(name),
      // POL:004 binds "you must obtain explicit confirmation" to tools whose DESCRIPTION starts
      // with this marker. Nothing else in the payload carries that binding (diagnosis F2b).
      requiresConfirmation: REQUIRES_CONFIRMATION.test(description),
    };
    order.push(name);
  }

  return { tools, order, malformed };
}

export function hasTool(inventory: Inventory, toolName: string): boolean {
  return Object.hasOwn(inventory.tools, toolName);
}

export function getTool(inventory: Inventory, toolName: string): ToolEntry | undefined {
  return inventory.tools[toolName];
}

export function hasParameter(inventory: Inventory, toolName: string, parameter: string): boolean {
  const tool = inventory.tools[toolName];
  return tool !== undefined && Object.hasOwn(tool.properties, parameter);
}

export function listTools(inventory: Inventory): ToolEntry[] {
  return inventory.order.flatMap((name) => {
    const tool = inventory.tools[name];
    return tool ? [tool] : [];
  });
}

/** A short, stable digest of the live capability surface — recorded in the trace per task. */
export function inventoryDigest(inventory: Inventory): string {
  return inventory.order
    .map((name) => {
      const tool = inventory.tools[name];
      return tool ? `${name}(${Object.keys(tool.properties).sort().join(",")})` : name;
    })
    .join(";");
}
