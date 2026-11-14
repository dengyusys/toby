/**
 * The memory service semantics: keyword search with the substring rule,
 * replace-vs-duplicate, receipts, expiry, the whole-book prompt section,
 * and the session-scoped off-record gate — against the real storage stack
 * in a fresh temporary directory per case. Also the human maintenance
 * resetMemory, including the corrupt-file recovery path.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createMemoryFile } from "../../src/domains/memory/memory-file.ts";
import { serializeMemoryMarkdown } from "../../src/domains/memory/parser.ts";
import { createMemoryRepository } from "../../src/domains/memory/repository.ts";
import { createMemoryService } from "../../src/domains/memory/service.ts";
import type {
  MemoryEntry,
  MemoryService,
} from "../../src/domains/memory/types.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-memory-service-"));
const BASE_MS = Date.parse("2026-11-14T08:00:00.000Z");
const BASE_ISO = new Date(BASE_MS).toISOString();

let nowMs = BASE_MS;
let caseCounter = 0;

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

function buildService(): { service: MemoryService; file: string } {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const memoryFile = createMemoryFile({ config });
  const repository = createMemoryRepository({ memoryFile, clock: () => nowMs });
  return {
    service: createMemoryService({ repository, clock: () => nowMs }),
    file: memoryFile.path,
  };
}

/** Seed a memory file directly (hand-edited-file scenarios). */
function seed(file: string, entries: readonly MemoryEntry[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeMemoryMarkdown({ entries }), "utf8");
}

describe("memory service: export", () => {
  it("readFile returns the raw file, or the empty book when missing", async () => {
    const { service, file } = buildService();
    expect(await service.readFile()).toBe(
      serializeMemoryMarkdown({ entries: [] }),
    );
    seed(file, [{ section: "约定", text: "咖啡记「饮品」" }]);
    expect(await service.readFile()).toBe("## 约定\n\n- 咖啡记「饮品」\n");
    void file;
  });

  it("readFile still answers the raw bytes of a corrupt file", async () => {
    const { service, file } = buildService();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "这不是记忆文件\n", "utf8");
    expect(await service.readFile()).toBe("这不是记忆文件\n");
  });
});

describe("memory service: remember", () => {
  it("appends and answers a receipt quoting the landed line", async () => {
    const { service, file } = buildService();
    const result = await service.remember({
      section: "约定",
      text: "咖啡记「饮品」",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt).toEqual({
      action: "remembered",
      section: "约定",
      after: "- 咖啡记「饮品」",
      created_at: BASE_ISO,
    });
    expect(await service.readFile()).toBe("## 约定\n\n- 咖啡记「饮品」\n");
    void file;
  });

  it("normalizes and validates input like a parsed line", async () => {
    const { service, file } = buildService();
    // Whitespace settles; the receipt quotes the stored line.
    const result = await service.remember({
      section: " 人物 ",
      text: " 小王: 房东 ",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.section).toBe("人物");
    expect(result.receipt.after).toBe("- 小王: 房东");
    for (const bad of [
      { section: "约定", text: "   " },
      { section: "约定", text: "两\n行" },
      { section: "", text: "x" },
      { section: "x".repeat(25), text: "x" },
      { section: "约定", text: "x", until: "2026-02-30" },
      { section: "约定", text: "自带 (至 2026-11-30)" },
    ]) {
      await expect(service.remember(bad)).rejects.toMatchObject({
        code: "INVALID_ENTRY",
        statusCode: 400,
      });
    }
    // Rejected writes changed nothing.
    expect(await service.buildMemorySection()).toBe("## 人物\n- 小王: 房东");
    void file;
  });

  it("answers already-remembered for an identical line anywhere in the book", async () => {
    const { service, file } = buildService();
    await service.remember({ section: "约定", text: "咖啡记「饮品」" });
    // Same text, a different section: still the same rendered line, so
    // the whole-book duplicate check answers already-remembered.
    const result = await service.remember({
      section: "工作",
      text: "咖啡记「饮品」",
    });
    expect(result).toEqual({
      kind: "already-remembered",
      line: "- 咖啡记「饮品」",
    });
    expect(await service.readFile()).toBe("## 约定\n\n- 咖啡记「饮品」\n");
    void file;
  });

  it("with replaceKeyword: one hit anywhere replaces, never coexists", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「拿铁」" },
      { section: "关于我", text: "不吃香菜" },
    ]);
    const result = await service.remember({
      section: "工作",
      text: "咖啡记「饮品」",
      replaceKeyword: "咖啡",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("updated");
    expect(result.receipt.section).toBe("工作");
    expect(result.receipt.before).toBe("- 咖啡记「拿铁」");
    expect(result.receipt.after).toBe("- 咖啡记「饮品」");
    expect(await service.readFile()).toBe(
      "## 工作\n\n- 咖啡记「饮品」\n\n## 关于我\n\n- 不吃香菜\n",
    );
  });

  it("with replaceKeyword: several hits refuse with rendered candidates", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "关于我", text: "咖啡只喝美式" },
    ]);
    const result = await service.remember({
      section: "约定",
      text: "新约定",
      replaceKeyword: "咖啡",
    });
    expect(result).toEqual({
      kind: "ambiguous",
      candidates: ["- 咖啡记「饮品」", "- 咖啡只喝美式"],
    });
    // The refusal changed nothing.
    expect(await service.readFile()).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n\n## 关于我\n\n- 咖啡只喝美式\n",
    );
  });

  it("with replaceKeyword: zero hits appends as new", async () => {
    const { service } = buildService();
    const result = await service.remember({
      section: "约定",
      text: "咖啡记「饮品」",
      replaceKeyword: "不存在的词",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("remembered");
    expect(await service.readFile()).toBe("## 约定\n\n- 咖啡记「饮品」\n");
  });

  it("replaceKeyword only ever hits non-expired entries", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」", until: "2026-11-13" },
      { section: "关于我", text: "咖啡只喝美式" },
    ]);
    const result = await service.remember({
      section: "关于我",
      text: "咖啡都喝美式",
      replaceKeyword: "咖啡",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    // The expired 约定 was invisible to the search; the 关于我 line moved.
    expect(result.receipt.before).toBe("- 咖啡只喝美式");
    expect(await service.readFile()).toBe(
      "## 约定\n\n- 咖啡记「饮品」 (至 2026-11-13)\n\n## 关于我\n\n- 咖啡都喝美式\n",
    );
  });
});

describe("memory service: forget", () => {
  it("deletes the one hit and answers a receipt with before only", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "关于我", text: "不吃香菜" },
    ]);
    const result = await service.forget("饮品");
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("forgot");
    expect(result.receipt.section).toBe("约定");
    expect(result.receipt.before).toBe("- 咖啡记「饮品」");
    expect(result.receipt.after).toBeUndefined();
    expect(await service.readFile()).toBe("## 关于我\n\n- 不吃香菜\n");
  });

  it("keyword matching is a substring over all non-expired texts, any section", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "人物", text: "小王: 房东" },
      { section: "关于我", text: "Coffee 只喝美式" },
      { section: "约定", text: "咖啡记「饮品」", until: "2026-11-13" },
    ]);
    // The colon style keeps the name inside the text, so names match too.
    const hit = await service.forget("小王");
    expect(hit).toEqual({
      kind: "receipt",
      receipt: {
        action: "forgot",
        section: "人物",
        before: "- 小王: 房东",
        created_at: BASE_ISO,
      },
    });
    // Case-insensitive, across sections.
    const second = await service.forget("coffee");
    expect(second).toEqual({
      kind: "receipt",
      receipt: expect.objectContaining({
        action: "forgot",
        section: "关于我",
        before: "- Coffee 只喝美式",
      }),
    });
    // Expired entries never match, whatever the keyword.
    expect(await service.forget("咖啡记")).toEqual({ kind: "nothing-matched" });
    // Headings and 至 markers never match.
    expect(await service.forget("约定")).toEqual({ kind: "nothing-matched" });
    expect(await service.forget("2026-11-13")).toEqual({
      kind: "nothing-matched",
    });
    void file;
  });

  it("several hits are ambiguous; zero hits answer nothing-matched", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "关于我", text: "咖啡只喝美式" },
    ]);
    expect(await service.forget("咖啡")).toEqual({
      kind: "ambiguous",
      candidates: ["- 咖啡记「饮品」", "- 咖啡只喝美式"],
    });
    expect(await service.forget("不存在的词")).toEqual({
      kind: "nothing-matched",
    });
    // The ambiguous refusal and the miss changed nothing.
    expect(await service.readFile()).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n\n## 关于我\n\n- 咖啡只喝美式\n",
    );
  });

  it("expired entries are not forgettable by keyword", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "出差餐饮记「差旅」", until: "2026-11-13" },
    ]);
    expect(await service.forget("差旅")).toEqual({ kind: "nothing-matched" });
    expect(await service.readFile()).toBe(
      "## 约定\n\n- 出差餐饮记「差旅」 (至 2026-11-13)\n",
    );
  });
});

describe("memory service: resetMemory", () => {
  it("empties a populated book: export and the prompt section go empty", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "人物", text: "小王: 房东" },
    ]);
    expect(await service.resetMemory()).toEqual({ reset_at: BASE_ISO });
    // The file is the empty book, and it parses as the empty book.
    expect(await service.readFile()).toBe("");
    expect(await service.buildMemorySection()).toBe("");
    void file;
  });

  it("discards a corrupt file — the documented recovery path — and the book is writable again", async () => {
    const { service, file } = buildService();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "这不是记忆文件\n", "utf8");
    // The raw bytes are still readable (export reads raw), but every
    // parsed view refuses.
    expect(await service.readFile()).toBe("这不是记忆文件\n");
    await expect(service.buildMemorySection()).rejects.toMatchObject({
      code: "MEMORY_FILE_INVALID",
    });

    expect(await service.resetMemory()).toEqual({ reset_at: BASE_ISO });
    // Explicit discard, not repair-in-place: the file is now the empty
    // book, which parses.
    expect(await service.readFile()).toBe("");
    expect(await service.buildMemorySection()).toBe("");

    // And the book takes writes again.
    const result = await service.remember({
      section: "约定",
      text: "重新开始",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(await service.readFile()).toBe("## 约定\n\n- 重新开始\n");
  });

  it("resetMemory is not gated by off-record", async () => {
    const { service, file } = buildService();
    seed(file, [{ section: "约定", text: "咖啡记「饮品」" }]);
    service.setOffRecord(true);
    expect(service.isOffRecord("s1")).toBe(true);
    expect(await service.resetMemory()).toEqual({ reset_at: BASE_ISO });
    expect(await service.readFile()).toBe("");
    void file;
  });
});

describe("memory service: buildMemorySection", () => {
  it("builds the whole book: every non-expired entry of every section, file order", async () => {
    const { service, file } = buildService();
    seed(file, [
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "约定", text: "出差餐饮记「差旅」", until: "2026-11-13" },
      { section: "关于我", text: "不吃香菜" },
      { section: "关于我", text: "在减脂" },
      { section: "转账", text: "给小王的转账走「人情往来」" },
      { section: "人物", text: "小王: 房东" },
      { section: "人物", text: "妈妈: 退休教师" },
    ]);
    expect(await service.buildMemorySection()).toBe(
      [
        "## 约定\n- 咖啡记「饮品」",
        "## 关于我\n- 不吃香菜\n- 在减脂",
        "## 转账\n- 给小王的转账走「人情往来」",
        "## 人物\n- 小王: 房东\n- 妈妈: 退休教师",
      ].join("\n\n"),
    );
    void file;
  });

  it("expired entries appear nowhere; an empty book builds the empty string", async () => {
    const { service, file } = buildService();
    expect(await service.buildMemorySection()).toBe("");
    seed(file, [
      { section: "约定", text: "过期约定", until: "2026-11-13" },
      { section: "关于我", text: "不吃香菜" },
    ]);
    expect(await service.buildMemorySection()).toBe("## 关于我\n- 不吃香菜");
    // A section whose every entry expired contributes no heading at all.
    seed(file, [{ section: "约定", text: "过期约定", until: "2026-11-13" }]);
    expect(await service.buildMemorySection()).toBe("");
    void file;
  });
});

describe("memory service: off-record gate", () => {
  it("starts off and binds to sessions per the observe/reset rules", () => {
    const { service } = buildService();
    expect(service.getOffRecord()).toEqual({ sessionId: null, on: false });
    expect(service.isOffRecord("s1")).toBe(false);

    // A flag set before any session stays unbound: it refuses every session.
    service.setOffRecord(true);
    expect(service.isOffRecord()).toBe(true);
    expect(service.isOffRecord("s1")).toBe(true);

    // First observation binds the flag to the session without resetting it.
    service.observeSession("s1");
    expect(service.getOffRecord()).toEqual({ sessionId: "s1", on: true });
    expect(service.isOffRecord("s1")).toBe(true);
    expect(service.isOffRecord()).toBe(false);
    expect(service.isOffRecord("s2")).toBe(false);

    // Same session observing again changes nothing.
    service.observeSession("s1");
    expect(service.isOffRecord("s1")).toBe(true);

    // A different session resets the flag.
    service.observeSession("s2");
    expect(service.getOffRecord()).toEqual({ sessionId: "s2", on: false });
    expect(service.isOffRecord("s2")).toBe(false);
    expect(service.isOffRecord("s1")).toBe(false);

    service.setOffRecord(true);
    expect(service.isOffRecord("s2")).toBe(true);
    service.setOffRecord(false);
    expect(service.isOffRecord("s2")).toBe(false);
  });
});
