// @implements harness-adapters
/**
 * PRIMARY ENTRYPOINT — the A2A 1.0 server implementing the IJCAI Track 1 evaluator wire contract.
 *
 * Two routes are all the evaluator uses:
 *   GET  /.well-known/agent-card.json   readiness probe (run_scenario.py::check_endpoint)
 *   POST /                              the `SendMessage` turn (sync_client.py), DEFAULT_RPC_URL
 *
 * The second entrypoint over this same core is the minimal Python bridge in `bridge/`, which plugs
 * into CAR-bench's `run.py` custom-agent factory and forwards each turn to THIS server over THIS
 * wire — so local development, baseline measurement and evals exercise the production path
 * (spec.capabilities.code[harness-adapters]: "two thin entrypoints over one TypeScript core").
 *
 * CARlo never executes a CAR-bench tool: it returns tool-call REQUESTS and the evaluator executes
 * them (spec.actions[emit-tool-call-request]; agent-under-test-harnessing.md#agentic-harness-boundaries).
 */

import { VertexBackbone } from "../backbone/vertex.ts";
import { assertLiveReady, type CarloConfig, describeConfig, loadConfig } from "../config.ts";
import { GatePipeline } from "../pipeline.ts";
import { JsonlTraceSink } from "../trace.ts";
import type { Backbone, TraceSink } from "../types.ts";
import { buildAgentCard } from "./card.ts";
import { A2AExecutor } from "./executor.ts";
import {
  A2A_CONTENT_TYPE,
  AGENT_CARD_PATH,
  assertAllowlisted,
  decodeRequest,
  encodeError,
  encodeMessage,
  encodeResult,
} from "./wire.ts";

export interface CarloServerOptions {
  config?: CarloConfig;
  backbone?: Backbone;
  sink?: TraceSink;
  newId?: () => string;
}

/** Builds the request handler. Exposed separately so tests drive it without binding a port. */
export function createHandler(options: CarloServerOptions = {}): {
  fetch: (request: Request) => Promise<Response>;
  executor: A2AExecutor;
  config: CarloConfig;
} {
  const config = options.config ?? loadConfig();
  const sink = options.sink ?? new JsonlTraceSink(config.traceDir);
  // The ONLY way to supply a different backbone is this injection seam, which is unreachable from
  // the environment: no env flag can swap the model client in a shipped image (B7 finding).
  const backbone = options.backbone ?? new VertexBackbone({ config });
  const pipeline = new GatePipeline({ backbone, config, sink });
  const executor = new A2AExecutor({ pipeline, model: config.model, newId: options.newId });

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === AGENT_CARD_PATH) {
      return Response.json(buildAgentCard({ url: `${url.origin}/`, version: "0.1.0" }));
    }

    if (request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    let rpcId: unknown = null;
    try {
      const body = await request.json();
      const { rpcId: id, turn } = decodeRequest(body);
      rpcId = id;

      const { step, contextId } = await executor.handleTurn(turn);
      const message = encodeMessage(step, contextId, crypto.randomUUID());
      // Defence in depth: the evaluator parses our reply with a STRICT protobuf parser.
      assertAllowlisted(message);

      return new Response(JSON.stringify(encodeResult(message, rpcId)), {
        headers: { "content-type": A2A_CONTENT_TYPE },
      });
    } catch (error) {
      // A single bad frame must never take the server down mid-benchmark.
      console.error("[carlo] turn failed:", error instanceof Error ? error.message : error);
      return new Response(JSON.stringify(encodeError(error, rpcId)), {
        status: 200,
        headers: { "content-type": A2A_CONTENT_TYPE },
      });
    }
  }

  return { fetch, executor, config };
}

export function startServer(options: CarloServerOptions = {}) {
  const handler = createHandler(options);
  const { config } = handler;
  // Unconditional: the model/region guard must never be bypassable at runtime.
  assertLiveReady(config);

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: handler.fetch,
    idleTimeout: 255,
  });

  console.error(
    `[carlo] listening on http://${config.host}:${config.port} ${describeConfig(config)} traces=${config.traceDir}`,
  );
  return server;
}

if (import.meta.main) {
  startServer();
}
