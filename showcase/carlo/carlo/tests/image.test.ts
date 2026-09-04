import { describe, expect, test } from "bun:test";

/**
 * Empirical assertions against the BUILT production image (B7 finding).
 *
 * The static checks in boundary.test.ts prove `src/` carries no stub and no backbone-swap flag.
 * These prove the consequence on the artifact organizers actually run: the image contains no stub
 * module, and setting `CARLO_TEST_BACKBONE=1` against it does NOT yield a stubbed turn.
 *
 * Requires the image from the docker gate:  docker build --platform linux/amd64 -t carlo:build .
 * If it is absent, these tests SKIP rather than fail — `bun test` must stay portable — so the docker
 * gate (G7/G8) is what guarantees they actually execute. The skip is reported, never silent.
 */

const IMAGE = process.env.CARLO_IMAGE ?? "carlo:build";

function sh(command: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

const imageAvailable = sh(["docker", "image", "inspect", IMAGE]).ok;
if (!imageAvailable) {
  console.warn(
    `[image.test.ts] SKIPPED — image "${IMAGE}" not found. Build it first: docker build --platform linux/amd64 -t ${IMAGE} .`,
  );
}

describe.skipIf(!imageAvailable)("production image contains no test backbone", () => {
  test("no stub module is present anywhere in the image", () => {
    const listing = sh([
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "find /app/src -name '*.ts' | sort",
    ]);
    expect(listing.ok).toBe(true);

    const files = listing.stdout.trim().split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => /stub/i.test(f))).toBe(false);
    // The real client is there; the test double is not.
    expect(files).toContain("/app/src/backbone/vertex.ts");
    expect(files.filter((f) => f.includes("/backbone/"))).toEqual(["/app/src/backbone/vertex.ts"]);
  });

  test("the tests/ tree (which holds the stub) is excluded from the image", () => {
    const listing = sh(["docker", "run", "--rm", "--entrypoint", "sh", IMAGE, "-c", "ls /app"]);
    expect(listing.ok).toBe(true);
    expect(listing.stdout).not.toContain("tests");
    expect(listing.stdout).not.toContain("bridge");
  });

  test("no source file in the image mentions the retired swap flag", () => {
    const grep = sh([
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "grep -rl 'CARLO_TEST_BACKBONE\\|StubBackbone' /app/src || echo NO_MATCH",
    ]);
    expect(grep.stdout.trim()).toBe("NO_MATCH");
  });

  test("CARLO_TEST_BACKBONE=1 against the production image does NOT yield a stubbed turn", () => {
    // The stub's signature response. With no stub in the image the turn must instead attempt a real
    // backbone call, which fails without credentials and surfaces as a JSON-RPC error.
    const STUB_SIGNATURE = "Let me check that first.";
    const port = 18099;
    const name = "carlo-b7-check";

    sh(["docker", "rm", "-f", name]);
    const run = sh([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-p",
      `${port}:8080`,
      "-e",
      "GOOGLE_CLOUD_PROJECT=b7-check",
      "-e",
      "CARLO_TEST_BACKBONE=1", // the retired flag — must have no effect whatsoever
      IMAGE,
    ]);
    expect(run.ok).toBe(true);

    try {
      // Wait for the card route.
      let ready = false;
      for (let i = 0; i < 60; i += 1) {
        if (
          sh(["curl", "-sS", "-m", "2", `http://127.0.0.1:${port}/.well-known/agent-card.json`]).ok
        ) {
          ready = true;
          break;
        }
        Bun.sleepSync(250);
      }
      expect(ready).toBe(true);

      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "m1",
            role: "ROLE_USER",
            parts: [
              { text: "System: - AUT-POL:005:test\n\nUser: hi" },
              {
                data: {
                  tools: [
                    {
                      type: "function",
                      function: {
                        name: "get_car_color",
                        description: "d",
                        parameters: { type: "object", required: [], properties: {} },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const response = sh([
        "curl",
        "-sS",
        "-m",
        "60",
        "-X",
        "POST",
        `http://127.0.0.1:${port}/`,
        "-H",
        "Content-Type: application/a2a+json",
        "-d",
        body,
      ]);
      expect(response.ok).toBe(true);

      // The decisive assertion: no stubbed turn, whatever else happens.
      expect(response.stdout).not.toContain(STUB_SIGNATURE);
      expect(response.stdout).not.toContain("get_car_color");

      // It failed on the real backbone path instead (no credentials in the container).
      const parsed = JSON.parse(response.stdout) as Record<string, any>;
      expect(parsed.error ?? parsed.result?.message).toBeDefined();
      expect(parsed.result?.message?.parts).toBeUndefined();
    } finally {
      sh(["docker", "rm", "-f", name]);
    }
  });
});
