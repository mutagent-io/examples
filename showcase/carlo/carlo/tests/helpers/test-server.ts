/**
 * TEST-ONLY server entrypoint for the Python bridge smoke.
 *
 * It starts the REAL server (`startServer` from src/) with the stub backbone supplied through the
 * `CarloServerOptions.backbone` injection seam — so the bridge exercises the production wire,
 * executor and gate pipeline while staying hermetic (no live Vertex call, no cost).
 *
 * This file is under tests/ and is excluded from the image by `.dockerignore`; nothing in `src/`
 * references it or the stub. That is what keeps the shipped image free of any backbone-swap path.
 *
 *   GOOGLE_CLOUD_PROJECT=test-project PORT=8080 bun run tests/helpers/test-server.ts
 *
 * `assertLiveReady` still runs unconditionally inside `startServer`, so this entrypoint must supply
 * a project just like production does.
 */

import { startServer } from "../../src/a2a/server.ts";
import { StubBackbone } from "./stub-backbone.ts";

startServer({ backbone: new StubBackbone() });
