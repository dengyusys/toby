/**
 * Config resolution: defaults, overrides, and validation failures —
 * all against an injected env, never the process environment.
 */

import { describe, expect, it } from "vitest";
import {
  repositoryRoot,
  resolveConfig,
} from "../src/infrastructure/config/config.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Independent anchor: this test lives at apps/server/test/, three levels
// below the repository root. Asserting against it (not against the exported
// constant) catches off-by-one errors in the config module's own anchor.
const testAnchorRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("resolveConfig", () => {
  it("defaults: loopback host, port 8629, repo data root, info logs", () => {
    const config = resolveConfig({ env: {} });
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8629);
    expect(config.paths.dataRoot).toBe(path.join(testAnchorRoot, "data"));
    expect(config.paths.webRoot).toBe(
      path.join(testAnchorRoot, "apps/web/dist"),
    );
    expect(config.logLevel).toBe("info");
  });

  it("repositoryRoot matches the independent test anchor", () => {
    expect(repositoryRoot).toBe(testAnchorRoot);
  });

  it("TOBY_* overrides are honored, paths resolve against the repo root", () => {
    const config = resolveConfig({
      env: {
        TOBY_HOST: "localhost",
        TOBY_PORT: "9000",
        TOBY_DATA_ROOT: "./store",
        TOBY_LOG_LEVEL: "debug",
      },
    });
    expect(config.server.host).toBe("localhost");
    expect(config.server.port).toBe(9000);
    expect(config.paths.dataRoot).toBe(path.join(repositoryRoot, "store"));
    expect(config.logLevel).toBe("debug");
  });

  it("0.0.0.0 is allowed for containers, other public hosts rejected", () => {
    expect(resolveConfig({ env: { TOBY_HOST: "0.0.0.0" } }).server.host).toBe(
      "0.0.0.0",
    );
    expect(() => resolveConfig({ env: { TOBY_HOST: "10.0.0.1" } })).toThrow();
  });

  it("invalid ports are rejected", () => {
    expect(() => resolveConfig({ env: { TOBY_PORT: "abc" } })).toThrow();
    expect(() => resolveConfig({ env: { TOBY_PORT: "70000" } })).toThrow();
  });
});
