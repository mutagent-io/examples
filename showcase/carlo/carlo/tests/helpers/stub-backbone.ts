/**
 * A deterministic STUB backbone for hermetic smoke tests.
 *
 * It lets the Python bridge smoke drive the real server, the real wire and the real gate pipeline
 * WITHOUT a live Vertex call or a benchmark run.
 *
 * IT LIVES UNDER tests/ ON PURPOSE. It is reached ONLY through the `CarloServerOptions.backbone`
 * injection seam (see tests/helpers/test-server.ts), never through an environment flag, and `src/`
 * contains no reference to it. Consequently the production entrypoint has no backbone-swap channel
 * and the shipped image cannot contain this module — `.dockerignore` excludes `tests`, and
 * tests/image.test.ts asserts both properties against the built image.
 *
 * (B7 finding: an earlier revision lived in src/ and was activated by `CARLO_TEST_BACKBONE=1`,
 * which shipped an env-activated backbone swap that also bypassed the live-config guard.)
 */

import type { Backbone, BackboneRequest, BackboneResult } from "../../src/types.ts";

export class StubBackbone implements Backbone {
  async generate(request: BackboneRequest): Promise<BackboneResult> {
    const usage = {
      promptTokens: 100,
      completionTokens: 10,
      thinkingTokens: 0,
      cachedTokens: 0,
      totalTokens: 110,
      cost: 0,
      llmCalls: 1,
      llmMillis: 1,
    };

    const alreadyGathered = request.transcript.some((entry) => entry.role === "tool");
    if (!alreadyGathered) {
      // Draft an information-gathering call that is valid without invented arguments.
      const callable = request.tools.find(
        (tool) => !tool.stateChanging && tool.required.length === 0,
      );
      if (callable) {
        return {
          text: "Let me check that first.",
          toolCalls: [{ toolName: callable.name, arguments: {} }],
          usage,
        };
      }
    }

    return { text: "All set — anything else?", toolCalls: [], usage };
  }
}
