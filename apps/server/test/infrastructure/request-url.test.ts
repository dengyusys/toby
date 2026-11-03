/**
 * The pre-routing URL rewrite: `/api` paths lose one trailing slash;
 * static paths collapse in-root dot segments and doubled slashes — and
 * never collapse INTO an `/api` route, which belongs to routing, not file
 * normalization.
 */

import { describe, expect, it } from "vitest";
import { normalizeRequestUrl } from "../../src/infrastructure/http/request-url.ts";

describe("normalizeRequestUrl", () => {
  it("drops one trailing slash from an /api path, keeping the query", () => {
    expect(normalizeRequestUrl("/api/ledger/months/")).toBe(
      "/api/ledger/months",
    );
    expect(normalizeRequestUrl("/api/ledger/transactions/?month=2026-10")).toBe(
      "/api/ledger/transactions?month=2026-10",
    );
    expect(normalizeRequestUrl("/api/system/health//")).toBe(
      "/api/system/health/",
    );
  });

  it("leaves /api path noise as sent, so it misses the route", () => {
    for (const url of [
      "/api/ledger/../ledger/months",
      "/api//ledger/months",
      "/api/ledger/months",
      "/api/",
      "/api",
    ]) {
      expect(normalizeRequestUrl(url)).toBe(url);
    }
  });

  it("collapses in-root dot segments and doubled slashes on static paths", () => {
    expect(normalizeRequestUrl("/assets/../index.html")).toBe("/index.html");
    expect(normalizeRequestUrl("/assets/./index.js")).toBe("/assets/index.js");
    expect(normalizeRequestUrl("//index.html")).toBe("/index.html");
    expect(normalizeRequestUrl("/assets//index.js")).toBe("/assets/index.js");
    expect(normalizeRequestUrl("/m/x/../index.html")).toBe("/m/index.html");
    expect(normalizeRequestUrl("/a/..")).toBe("/");
    expect(normalizeRequestUrl("/a/.")).toBe("/a/");
    expect(normalizeRequestUrl("/%61ssets/../index.html")).toBe("/index.html");
    expect(normalizeRequestUrl("/assets/%2e/index.js")).toBe(
      "/assets/index.js",
    );
  });

  it("keeps escapes and would-be /api collapses as sent", () => {
    for (const url of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/a/../../index.html",
      "/m/../api/system/health",
      "/assets/../../api/ledger/months",
      "/%zz",
    ]) {
      expect(normalizeRequestUrl(url)).toBe(url);
    }
  });

  it("preserves queries and untouched paths", () => {
    expect(normalizeRequestUrl("/assets/../index.html?v=1")).toBe(
      "/index.html?v=1",
    );
    expect(normalizeRequestUrl("/m/")).toBe("/m/");
    expect(normalizeRequestUrl("/")).toBe("/");
    expect(normalizeRequestUrl("/api/ledger/months?next=/a/")).toBe(
      "/api/ledger/months?next=/a/",
    );
  });

  it("a mount's own dots may cross it — the root layer's collapse decides", () => {
    // With ["m"] wired in production: a request whose dots climb out of
    // the mount keeps its original path inside the mount (the mount
    // refuses it → not-found) and serves the root collapse across it.
    const mounts = ["m"] as const;
    expect(normalizeRequestUrl("/m/../m/index.html", mounts)).toBe(
      "/m/../m/index.html",
    );
    expect(normalizeRequestUrl("/m/../m/", mounts)).toBe("/m/../m/");
    expect(normalizeRequestUrl("/m/../m", mounts)).toBe("/m/../m");
    expect(normalizeRequestUrl("/m/../index.html", mounts)).toBe("/index.html");
    expect(normalizeRequestUrl("/m/assets/../index.html", mounts)).toBe(
      "/m/index.html",
    );
    // Old quirk kept: /m/.. collapses to the root index (the first server
    // answered a 301 here; see the ADR's byte-level residual list).
    expect(normalizeRequestUrl("/m/..", mounts)).toBe("/");
  });
});
