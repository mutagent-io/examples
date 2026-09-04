# CARlo — IJCAI-ECAI 2026 Track 1 agent-under-test image.
#
# Structure mirrors the organizer baseline
# (car-bench-ijcai/src/track_1_agent_under_test/Dockerfile.track-1-agent-under-test): a pinned base,
# a non-root user, a frozen dependency install, port 8080, and the A2A server as the entrypoint.
#
# The base is DIGEST-PINNED: bun is the runtime and a silent bun upgrade would change the agent
# under test between validation and the official run. `@google/genai` is likewise pinned <3.0.0 in
# package.json — the SDK's own docs advise this, because 3.0.0 changes AFC invocation and requires
# Node 22+ (build-report gap G-B).
#
# Build (organizers run linux/amd64):
#   docker build --platform linux/amd64 -t ghcr.io/<org>/carlo:latest .
#
# NO SECRET IS BAKED IN: model, project, location and credentials all arrive as env vars.
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS base

WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun tsconfig.json ./
COPY --chown=bun:bun src ./src

# Traces are the eval/diagnose evidence sink; keep the default path writable for the non-root user.
RUN mkdir -p /app/traces && chown -R bun:bun /app

USER bun

ENV HOST=0.0.0.0 \
    PORT=8080 \
    CARLO_MODEL=gemini-3.5-flash \
    CARLO_TEMPERATURE=0 \
    CARLO_THINKING_BUDGET=0 \
    CARLO_MAX_TURNS=50 \
    CARLO_VERIFY_MODE=risk \
    CARLO_TRACE_DIR=/app/traces \
    GOOGLE_CLOUD_LOCATION=global \
    GOOGLE_GENAI_USE_VERTEXAI=true

EXPOSE 8080

ENTRYPOINT ["bun", "run", "src/a2a/server.ts"]
