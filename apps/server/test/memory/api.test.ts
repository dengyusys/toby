/**
 * Memory domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real storage in a fresh temporary directory per
 * case, injected clock). Pins the public shapes of the read-only page
 * surface: the raw MEMORY.md file read, the off-record toggle, and the
 * human maintenance reset — including the corrupt-file recovery path.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createMemoryDomain } from "../../src/domains/memory/plugin.ts";
import { serializeMemoryMarkdown } from "../../src/domains/memory/parser.ts";
import type { MemoryEntry } from "../../src/domains/memory/types.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-memory-api-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-14T08:00:00.000Z");
const BASE_ISO = new Date(BASE_MS).toISOString();

let app: FastifyInstance;
let dataRoot: string;
let caseCounter = 0;
// The assembled domain, kept so tests can pin the prompt-side reading
// (buildMemorySection) against what the HTTP surface just wrote.
let buildMemorySection: () => Promise<string>;

async function buildApp(): Promise<void> {
  caseCounter += 1;
  dataRoot = path.join(baseDir, `case-${caseCounter}`);
  const config = resolveConfig({ env: { TOBY_DATA_ROOT: dataRoot } });
  const domain = createMemoryDomain({ config, clock: () => BASE_MS });
  buildMemorySection = () => domain.service.buildMemorySection();
  app = await createTestApp({
    config,
    domains: [(instance) => instance.register(domain.plugin)],
  });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Seed MEMORY.md directly, the hand-edit path. */
function seed(entries: readonly MemoryEntry[]): void {
  const file = path.join(dataRoot, "memory", "MEMORY.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeMemoryMarkdown({ entries }), "utf8");
}

function memoryFilePath(): string {
  return path.join(dataRoot, "memory", "MEMORY.md");
}

describe("memory api: file", () => {
  it("file answers the raw markdown with a text/markdown content type", async () => {
    seed([
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "人物", text: "小王: 房东" },
    ]);
    const response = await inject("GET", "/api/memory/file");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.body).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n\n## 人物\n\n- 小王: 房东\n",
    );
  });

  it("file on an empty memory answers the empty book", async () => {
    const response = await inject("GET", "/api/memory/file");
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it("file still answers the raw bytes on a corrupt file, repairing nothing", async () => {
    seed([{ section: "约定", text: "咖啡记「饮品」" }]);
    const file = memoryFilePath();
    writeFileSync(file, "这不是记忆文件\n", "utf8");

    const fileResponse = await inject("GET", "/api/memory/file");
    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.body).toBe("这不是记忆文件\n");
    // Nothing was repaired.
    expect(readFileSync(file, "utf8")).toBe("这不是记忆文件\n");
  });
});

describe("memory api: off-record", () => {
  it("the off-record toggle round-trips and is validated", async () => {
    expect((await inject("GET", "/api/memory/off-record")).json()).toEqual({
      on: false,
    });
    const toggled = await inject("POST", "/api/memory/off-record", {
      on: true,
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json()).toEqual({ on: true });
    expect((await inject("GET", "/api/memory/off-record")).json()).toEqual({
      on: true,
    });
    const bad = await inject("POST", "/api/memory/off-record", { on: "yes" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errorCode).toBe("BAD_REQUEST");
  });
});

describe("memory api: reset", () => {
  it("reset empties a populated file: the raw read and the prompt section go empty", async () => {
    seed([
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "人物", text: "小王: 房东" },
    ]);
    const response = await inject("POST", "/api/memory/reset");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reset_at: BASE_ISO });

    // The file is the empty book: raw read empty, prompt section empty.
    const fileResponse = await inject("GET", "/api/memory/file");
    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.body).toBe("");
    expect(await buildMemorySection()).toBe("");
  });

  it("reset succeeds on a corrupt file — the documented recovery path", async () => {
    const file = memoryFilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "这不是记忆文件\n", "utf8");

    const response = await inject("POST", "/api/memory/reset");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reset_at: BASE_ISO });

    // Explicit discard: the corrupt content is gone, replaced by the
    // empty book that parses.
    expect(readFileSync(file, "utf8")).toBe("");
    expect((await inject("GET", "/api/memory/file")).body).toBe("");
    expect(await buildMemorySection()).toBe("");
  });

  it("reset is not gated by off-record — it never touches the AI tools", async () => {
    await inject("POST", "/api/memory/off-record", { on: true });
    seed([{ section: "约定", text: "咖啡记「饮品」" }]);

    const response = await inject("POST", "/api/memory/reset");
    expect(response.statusCode).toBe(200);
    expect((await inject("GET", "/api/memory/file")).body).toBe("");
    // The toggle itself is untouched by the reset.
    expect((await inject("GET", "/api/memory/off-record")).json()).toEqual({
      on: true,
    });
  });
});
