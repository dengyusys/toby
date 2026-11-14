/**
 * The memory service semantics: keyword search with recall's substring
 * rule, replace-vs-duplicate, receipts, expiry, the layered prompt
 * section, and the session-scoped off-record gate — against the real
 * storage stack in a fresh temporary directory per case.
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

describe("memory service: list / recall / export", () => {
  it("lists entries 约定 → 关于我 → 人物 with expiry resolved", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "人物", name: "小王", text: "房东" },
      { type: "约定", text: "过期约定", until: "2026-11-13" },
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "不吃香菜" },
      { type: "人物", name: "妈妈", text: "退休教师", until: "2026-11-15" },
    ]);
    const { entries } = await service.list();
    expect(entries).toEqual([
      { type: "约定", text: "过期约定", until: "2026-11-13", expired: true },
      { type: "约定", text: "咖啡记「饮品」", expired: false },
      { type: "关于我", text: "不吃香菜", expired: false },
      { type: "人物", name: "小王", text: "房东", expired: false },
      {
        type: "人物",
        name: "妈妈",
        text: "退休教师",
        until: "2026-11-15",
        expired: false,
      },
    ]);
  });

  it("expiry is date-level: until today is not expired, until yesterday is", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "今天到期", until: "2026-11-14" },
      { type: "约定", text: "昨天到期", until: "2026-11-13" },
    ]);
    const { entries } = await service.list();
    expect(entries.map((entry) => entry.expired)).toEqual([false, true]);
  });

  it("recall matches names and texts, case-insensitively, non-expired only", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "人物", name: "Tim", text: "钢琴老师" },
      { type: "关于我", text: "Coffee 只喝美式" },
      { type: "约定", text: "咖啡记「饮品」", until: "2026-11-13" },
    ]);
    expect((await service.recall("tim")).map((entry) => entry.name)).toEqual([
      "Tim",
    ]);
    expect((await service.recall("COFFEE")).map((entry) => entry.text)).toEqual(
      ["Coffee 只喝美式"],
    );
    // Expired entries never come back, whatever the keyword.
    expect(await service.recall("咖啡记")).toEqual([]);
    // An empty keyword flips through the whole book: every non-expired
    // entry, in section order (约定 → 关于我 → 人物) — the 你记得我什么 case.
    expect((await service.recall("")).map((entry) => entry.text)).toEqual([
      "Coffee 只喝美式",
      "钢琴老师",
    ]);
    expect(await service.recall("   ")).toEqual(await service.recall(""));
    // Section headings and 至 markers never match.
    expect(await service.recall("关于我")).toEqual([]);
    expect(await service.recall("2026-11-13")).toEqual([]);
  });

  it("an empty keyword lists every non-expired entry across types", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "不吃香菜" },
      { type: "人物", name: "小王", text: "房东" },
      { type: "约定", text: "过期约定", until: "2026-11-13" },
    ]);
    const all = await service.recall("");
    expect(all).toEqual([
      { type: "约定", text: "咖啡记「饮品」", expired: false },
      { type: "关于我", text: "不吃香菜", expired: false },
      { type: "人物", name: "小王", text: "房东", expired: false },
    ]);
    void file;
  });

  it("exportMarkdown returns the raw file, or the empty skeleton when missing", async () => {
    const { service, file } = buildService();
    expect(await service.exportMarkdown()).toBe(
      serializeMemoryMarkdown({ entries: [] }),
    );
    seed(file, [{ type: "约定", text: "咖啡记「饮品」" }]);
    expect(await service.exportMarkdown()).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n\n## 关于我\n\n\n## 人物\n\n",
    );
  });
});

describe("memory service: remember", () => {
  it("appends and answers a receipt quoting the landed line", async () => {
    const { service, file } = buildService();
    const result = await service.remember({
      type: "约定",
      text: "咖啡记「饮品」",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt).toEqual({
      action: "remembered",
      type: "约定",
      after: "- 咖啡记「饮品」",
      created_at: new Date(BASE_MS).toISOString(),
    });
    expect((await service.list()).entries).toEqual([
      { type: "约定", text: "咖啡记「饮品」", expired: false },
    ]);
    expect(await service.exportMarkdown()).toContain("- 咖啡记「饮品」");
    void file;
  });

  it("normalizes and validates input like a parsed line", async () => {
    const { service, file } = buildService();
    // Whitespace settles; the receipt quotes the stored line.
    const result = await service.remember({
      type: "人物",
      name: "  小王 ",
      text: " 房东 ",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.after).toBe("- 小王: 房东");
    for (const bad of [
      { type: "约定" as const, text: "   " },
      { type: "约定" as const, text: "两\n行" },
      { type: "人物" as const, text: "没有名字" },
      { type: "人物" as const, name: "小王", text: "" },
      { type: "约定" as const, text: "x", until: "2026-02-30" },
      { type: "约定" as const, text: "自带 (至 2026-11-30)" },
    ]) {
      await expect(service.remember(bad)).rejects.toMatchObject({
        code: "INVALID_ENTRY",
        statusCode: 400,
      });
    }
    // Rejected writes changed nothing.
    expect((await service.list()).entries).toEqual([
      { type: "人物", name: "小王", text: "房东", expired: false },
    ]);
    void file;
  });

  it("answers already-remembered for an identical line, without writing", async () => {
    const { service } = buildService();
    await service.remember({ type: "约定", text: "咖啡记「饮品」" });
    const result = await service.remember({
      type: "约定",
      text: "咖啡记「饮品」",
    });
    expect(result).toEqual({
      kind: "already-remembered",
      line: "- 咖啡记「饮品」",
    });
    expect((await service.list()).entries).toHaveLength(1);
  });

  it("with replaceKeyword: one hit replaces, never coexists", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「拿铁」" },
      { type: "关于我", text: "不吃香菜" },
    ]);
    const result = await service.remember({
      type: "约定",
      text: "咖啡记「饮品」",
      replaceKeyword: "咖啡",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("updated");
    expect(result.receipt.before).toBe("- 咖啡记「拿铁」");
    expect(result.receipt.after).toBe("- 咖啡记「饮品」");
    expect((await service.list()).entries).toEqual([
      { type: "约定", text: "咖啡记「饮品」", expired: false },
      { type: "关于我", text: "不吃香菜", expired: false },
    ]);
  });

  it("with replaceKeyword: several hits refuse with rendered candidates", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "咖啡只喝美式" },
    ]);
    const result = await service.remember({
      type: "约定",
      text: "新约定",
      replaceKeyword: "咖啡",
    });
    expect(result).toEqual({
      kind: "ambiguous",
      candidates: ["- 咖啡记「饮品」", "- 咖啡只喝美式"],
    });
    expect((await service.list()).entries).toHaveLength(2);
  });

  it("with replaceKeyword: zero hits appends as new", async () => {
    const { service } = buildService();
    const result = await service.remember({
      type: "约定",
      text: "咖啡记「饮品」",
      replaceKeyword: "不存在的词",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("remembered");
    expect((await service.list()).entries).toHaveLength(1);
  });

  it("replaceKeyword only ever hits non-expired entries", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」", until: "2026-11-13" },
      { type: "关于我", text: "咖啡只喝美式" },
    ]);
    const result = await service.remember({
      type: "关于我",
      text: "咖啡都喝美式",
      replaceKeyword: "咖啡",
    });
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    // The expired 约定 was invisible to the search; the 关于我 line moved.
    expect(result.receipt.before).toBe("- 咖啡只喝美式");
    expect((await service.list()).entries[0]).toMatchObject({
      text: "咖啡记「饮品」",
      expired: true,
    });
  });
});

describe("memory service: forget", () => {
  it("deletes the one hit and answers a receipt with before only", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "不吃香菜" },
    ]);
    const result = await service.forget("饮品");
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("forgot");
    expect(result.receipt.before).toBe("- 咖啡记「饮品」");
    expect(result.receipt.after).toBeUndefined();
    expect((await service.list()).entries).toEqual([
      { type: "关于我", text: "不吃香菜", expired: false },
    ]);
  });

  it("several hits are ambiguous; zero hits answer nothing-matched", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "关于我", text: "咖啡只喝美式" },
    ]);
    expect(await service.forget("咖啡")).toEqual({
      kind: "ambiguous",
      candidates: ["- 咖啡记「饮品」", "- 咖啡只喝美式"],
    });
    expect(await service.forget("不存在的词")).toEqual({
      kind: "nothing-matched",
    });
    expect((await service.list()).entries).toHaveLength(2);
  });

  it("expired entries are not forgettable by keyword", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "出差餐饮记「差旅」", until: "2026-11-13" },
    ]);
    expect(await service.forget("差旅")).toEqual({ kind: "nothing-matched" });
    expect((await service.list()).entries).toHaveLength(1);
  });
});

describe("memory service: replaceExact", () => {
  it("replaces by exact full line and answers before/after", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "人物", name: "小王", text: "同事" }]);
    const result = await service.replaceExact(
      { type: "人物", name: "小王", text: "同事" },
      { type: "人物", name: "小王", text: "房东" },
    );
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("updated");
    expect(result.receipt.before).toBe("- 小王: 同事");
    expect(result.receipt.after).toBe("- 小王: 房东");
    expect((await service.list()).entries).toEqual([
      { type: "人物", name: "小王", text: "房东", expired: false },
    ]);
  });

  it("deletes with next = null", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "约定", text: "咖啡记「饮品」" }]);
    const result = await service.replaceExact(
      { type: "约定", text: "咖啡记「饮品」" },
      null,
    );
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("forgot");
    expect((await service.list()).entries).toEqual([]);
  });

  it("zero matches throw ENTRY_NOT_FOUND; a duplicated line throws AMBIGUOUS_ENTRY", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "约定", text: "咖啡记「饮品」" }]);
    await expect(
      service.replaceExact({ type: "约定", text: "不存在的" }, null),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND", statusCode: 404 });

    seed(file, [
      { type: "约定", text: "重复的一行" },
      { type: "约定", text: "重复的一行" },
    ]);
    await expect(
      service.replaceExact({ type: "约定", text: "重复的一行" }, null),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_ENTRY", statusCode: 409 });
    expect((await service.list()).entries).toHaveLength(2);
  });

  it("works on expired entries too — the page's veto does not expire", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "约定", text: "过期约定", until: "2026-11-13" }]);
    const result = await service.replaceExact(
      { type: "约定", text: "过期约定", until: "2026-11-13" },
      { type: "约定", text: "续期约定", until: "2027-11-13" },
    );
    if (result.kind !== "receipt") {
      throw new Error(`expected a receipt, got ${result.kind}`);
    }
    expect(result.receipt.action).toBe("updated");
    expect((await service.list()).entries[0]).toMatchObject({
      text: "续期约定",
      expired: false,
    });
  });
});

describe("memory service: buildMemorySection", () => {
  it("builds the layered section with all pieces", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "约定", text: "出差餐饮记「差旅」", until: "2026-11-13" },
      { type: "关于我", text: "不吃香菜" },
      { type: "关于我", text: "在减脂" },
      { type: "人物", name: "小王", text: "房东" },
      { type: "人物", name: "妈妈", text: "退休教师" },
    ]);
    expect(
      await service.buildMemorySection({
        conventions: true,
        peopleIndex: true,
        aboutIndex: true,
        sentence: "帮小王交房租",
      }),
    ).toBe(["## 约定\n- 咖啡记「饮品」", "## 人物\n- 小王: 房东"].join("\n\n"));
    // The same request without a sentence is the tool-carrying agent's
    // view: full index, no hits block (no sentence to hit against).
    expect(
      await service.buildMemorySection({
        conventions: true,
        peopleIndex: true,
        aboutIndex: true,
      }),
    ).toBe(
      [
        "## 约定\n- 咖啡记「饮品」",
        "## 记忆索引 — 详情用 recall 工具查询\n人物: 小王、妈妈\n关于我: 不吃香菜；在减脂",
      ].join("\n\n"),
    );
  });

  it("omits empty pieces and still emits the index heading when both indexes are requested", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "约定", text: "咖啡记「饮品」" }]);
    expect(
      await service.buildMemorySection({
        conventions: true,
        peopleIndex: true,
        aboutIndex: true,
      }),
    ).toBe("## 约定\n- 咖啡记「饮品」\n\n## 记忆索引 — 详情用 recall 工具查询");
    // One index requested with an empty list: no block at all.
    expect(
      await service.buildMemorySection({
        conventions: false,
        peopleIndex: true,
        aboutIndex: false,
      }),
    ).toBe("");
    // Everything requested empty → empty string.
    expect(
      await service.buildMemorySection({
        conventions: false,
        peopleIndex: false,
        aboutIndex: false,
      }),
    ).toBe("");
    void file;
  });

  it("sentence hits list full 人物 lines without the index line; expired entries appear nowhere", async () => {
    const { service, file } = buildService();
    seed(file, [
      { type: "人物", name: "小王", text: "房东", until: "2026-11-13" },
      { type: "人物", name: "小王", text: "球友" },
      { type: "约定", text: "过期约定", until: "2026-11-13" },
    ]);
    // False hits (小王 inside 小王子) are accepted — the model's job.
    // The sentence mechanism rides with peopleIndex, and a sentence means
    // no index line: the read-time agent carries the tools itself, so the
    // heading that names one would go stale.
    expect(
      await service.buildMemorySection({
        conventions: false,
        peopleIndex: true,
        aboutIndex: false,
        sentence: "小王子的花",
      }),
    ).toBe("## 人物\n- 小王: 球友");
    // The expired 约定 never enters the section; without it nothing is left.
    expect(
      await service.buildMemorySection({
        conventions: true,
        peopleIndex: false,
        aboutIndex: false,
      }),
    ).toBe("");
    void file;
  });

  it("sentence matching is case-insensitive over names", async () => {
    const { service, file } = buildService();
    seed(file, [{ type: "人物", name: "Tim", text: "钢琴老师" }]);
    expect(
      await service.buildMemorySection({
        conventions: false,
        peopleIndex: true,
        aboutIndex: false,
        sentence: "问 tim 下节课",
      }),
    ).toBe("## 人物\n- Tim: 钢琴老师");
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
