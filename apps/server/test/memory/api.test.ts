/**
 * Memory domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real storage in a fresh temporary directory per
 * case, injected clock). Pins the public shapes: receipts, refusal codes,
 * the markdown export, the off-record toggle, and the corrupt-file 500.
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

let app: FastifyInstance;
let dataRoot: string;
let caseCounter = 0;

async function buildApp(): Promise<void> {
  caseCounter += 1;
  dataRoot = path.join(baseDir, `case-${caseCounter}`);
  const config = resolveConfig({ env: { TOBY_DATA_ROOT: dataRoot } });
  app = await createTestApp({
    config,
    domains: [
      (instance) =>
        instance.register(
          createMemoryDomain({ config, clock: () => BASE_MS }).plugin,
        ),
    ],
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

describe("memory api: list and remember", () => {
  it("an empty memory lists as an empty page", async () => {
    const response = await inject("GET", "/api/memory");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ entries: [] });
  });

  it("remembering lands at once and answers a receipt of what landed", async () => {
    const response = await inject("POST", "/api/memory/entries", {
      type: "约定",
      text: "咖啡记「饮品」",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      action: "remembered",
      type: "约定",
      after: "- 咖啡记「饮品」",
      created_at: new Date(BASE_MS).toISOString(),
    });

    const list = await inject("GET", "/api/memory");
    expect(list.json()).toEqual({
      entries: [{ type: "约定", text: "咖啡记「饮品」", expired: false }],
    });
  });

  it("an identical line answers 409 DUPLICATE_ENTRY", async () => {
    await inject("POST", "/api/memory/entries", {
      type: "约定",
      text: "咖啡记「饮品」",
    });
    const response = await inject("POST", "/api/memory/entries", {
      type: "约定",
      text: "咖啡记「饮品」",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe("DUPLICATE_ENTRY");
    expect((await inject("GET", "/api/memory")).json().entries).toHaveLength(1);
  });

  it("malformed bodies answer BAD_REQUEST from the route schema", async () => {
    for (const body of [
      {},
      { type: "其他", text: "x" },
      { type: "约定" },
      { type: "约定", text: "x", extra: 1 },
      { type: "约定", text: "x", until: "2026-11-14", replaceKeyword: 5 },
    ]) {
      const response = await inject("POST", "/api/memory/entries", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
  });

  it("nonsense semantics answer 400 INVALID_ENTRY from the domain", async () => {
    for (const body of [
      { type: "约定", text: "   " },
      { type: "人物", text: "没有名字" },
      { type: "人物", name: "小王", text: "  " },
      // Shape-valid but impossible: the domain owns real calendars.
      { type: "约定", text: "x", until: "2026-02-30" },
    ]) {
      const response = await inject("POST", "/api/memory/entries", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_ENTRY");
    }
    expect((await inject("GET", "/api/memory")).json()).toEqual({
      entries: [],
    });
  });
});

describe("memory api: replace and forget", () => {
  it("replaceExact updates the matched line and answers before/after", async () => {
    seed([{ type: "人物", name: "小王", text: "同事" }]);
    const response = await inject("POST", "/api/memory/entry/replace", {
      current: { type: "人物", name: "小王", text: "同事" },
      next: { type: "人物", name: "小王", text: "房东" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      action: "updated",
      type: "人物",
      before: "- 小王: 同事",
      after: "- 小王: 房东",
      created_at: new Date(BASE_MS).toISOString(),
    });
  });

  it("replaceExact deletes with next = null and answers forgot", async () => {
    seed([{ type: "约定", text: "咖啡记「饮品」" }]);
    const response = await inject("POST", "/api/memory/entry/replace", {
      current: { type: "约定", text: "咖啡记「饮品」" },
      next: null,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe("forgot");
    expect(response.json().before).toBe("- 咖啡记「饮品」");
    expect(response.json().after).toBeUndefined();
    expect((await inject("GET", "/api/memory")).json()).toEqual({
      entries: [],
    });
  });

  it("an unknown line is 404 ENTRY_NOT_FOUND; a duplicated line is 409 AMBIGUOUS_ENTRY", async () => {
    const missing = await inject("POST", "/api/memory/entry/replace", {
      current: { type: "约定", text: "不存在的" },
      next: null,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("ENTRY_NOT_FOUND");

    seed([
      { type: "约定", text: "重复的一行" },
      { type: "约定", text: "重复的一行" },
    ]);
    const ambiguous = await inject("POST", "/api/memory/entry/replace", {
      current: { type: "约定", text: "重复的一行" },
      next: null,
    });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json().errorCode).toBe("AMBIGUOUS_ENTRY");
    expect((await inject("GET", "/api/memory")).json().entries).toHaveLength(2);
  });

  it("forget deletes the one keyword hit; zero hits are an honest 404; several hits are 409", async () => {
    seed([
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "不吃香菜" },
    ]);
    const forgot = await inject("POST", "/api/memory/entry/forget", {
      keyword: "饮品",
    });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json()).toEqual({
      action: "forgot",
      type: "约定",
      before: "- 咖啡记「饮品」",
      created_at: new Date(BASE_MS).toISOString(),
    });

    const missing = await inject("POST", "/api/memory/entry/forget", {
      keyword: "饮品",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("ENTRY_NOT_FOUND");
    expect(missing.json().message).toContain("没有找到");

    seed([
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "约定", text: "咖啡记「拿铁」" },
    ]);
    const ambiguous = await inject("POST", "/api/memory/entry/forget", {
      keyword: "咖啡",
    });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json().errorCode).toBe("AMBIGUOUS_ENTRY");
    expect(ambiguous.json().message).toContain("- 咖啡记「饮品」");
    expect(ambiguous.json().message).toContain("- 咖啡记「拿铁」");
  });

  it("a forget body without a keyword is a BAD_REQUEST", async () => {
    const response = await inject("POST", "/api/memory/entry/forget", {});
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("BAD_REQUEST");
  });
});

describe("memory api: export, off-record, corrupt file, cap", () => {
  it("export answers the raw markdown with a text/markdown content type", async () => {
    seed([{ type: "约定", text: "咖啡记「饮品」" }]);
    const response = await inject("GET", "/api/memory/export");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.body).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n\n## 关于我\n\n\n## 人物\n\n",
    );
  });

  it("export on an empty memory answers the empty skeleton", async () => {
    const response = await inject("GET", "/api/memory/export");
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("## 约定\n\n\n## 关于我\n\n\n## 人物\n\n");
  });

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

  it("an unparseable file is refused with 500 MEMORY_FILE_INVALID, never repaired", async () => {
    seed([{ type: "约定", text: "咖啡记「饮品」" }]);
    const file = path.join(dataRoot, "memory", "MEMORY.md");
    writeFileSync(file, "这不是记忆文件\n", "utf8");

    const list = await inject("GET", "/api/memory");
    expect(list.statusCode).toBe(500);
    expect(list.json().errorCode).toBe("MEMORY_FILE_INVALID");
    expect(list.json().message).toContain("手工修正");

    const write = await inject("POST", "/api/memory/entries", {
      type: "约定",
      text: "新的一条",
    });
    expect(write.statusCode).toBe(500);
    expect(write.json().errorCode).toBe("MEMORY_FILE_INVALID");

    const exportResponse = await inject("GET", "/api/memory/export");
    // The export reads raw bytes, so it still works on a corrupt file.
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body).toBe("这不是记忆文件\n");
    // Nothing was repaired.
    expect(readFileSync(file, "utf8")).toBe("这不是记忆文件\n");
  });

  it("a full memory refuses with 409 LIMIT_REACHED and asks what to forget", async () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      type: "约定" as const,
      text: `条目${i}`,
    }));
    seed(entries);
    const response = await inject("POST", "/api/memory/entries", {
      type: "约定",
      text: "第501条",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe("LIMIT_REACHED");
    expect(response.json().message).toContain("该忘点什么");
    const list = await inject("GET", "/api/memory");
    expect(list.json().entries).toHaveLength(500);
  });
});
