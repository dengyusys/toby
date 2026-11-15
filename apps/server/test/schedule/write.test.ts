/**
 * The schedule service's one-sentence write path, against a real domain
 * (real sqlite in a fresh temporary directory per case, injected clock)
 * and a fake extractor: the example sentence lands as three puts and a
 * receipt; one ambiguous op — an unknown item, a status outside the
 * vocabulary — asks and lands NOTHING (no partial application); clear
 * resolves by natural key and an absent record is an honest no-op;
 * unconfigured AI answers the shared unconfigured error.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import {
  createScheduleDomain,
  type ScheduleDomain,
} from "../../src/domains/schedule/plugin.ts";
import type {
  ScheduleDraft,
  ScheduleExtractor,
} from "../../src/domains/schedule/extraction.ts";
import { createTestApp } from "../app-fixture.ts";
import { caughtAiError } from "../helpers.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-schedule-write-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-15T08:00:00.000Z");

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;
let domain: ScheduleDomain | undefined;

/** The scripted extraction draft, swapped per case. */
let draft: () => ScheduleDraft = () => ({ question: "没听懂。" });

const extractor: ScheduleExtractor = {
  extract: async () => draft(),
};

/**
 * A real schedule domain with the fake extractor wired exactly like the
 * composition root wires the real one; the plugin mounts (unused routes,
 * real lifecycle: the database closes with the app, so the temp tree can
 * go on Windows too).
 */
async function buildDomain(): Promise<ScheduleDomain> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  const built = createScheduleDomain({
    config,
    clock: () => nowMs,
    extractor,
  });
  app = await createTestApp({
    config,
    domains: [(instance) => instance.register(built.plugin)],
  });
  return built;
}

beforeEach(async () => {
  draft = () => ({ question: "没听懂。" });
  domain = await buildDomain();
});

afterEach(async () => {
  await app.close();
});

describe("schedule service write", () => {
  it("the example sentence lands as three puts and one receipt", async () => {
    const service = domain!.service;
    const 早饭 = await service.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    const 中饭 = await service.createItem({
      title: "中饭",
      statuses: ["是", "否"],
    });
    const 晚饭 = await service.createItem({
      title: "晚饭",
      statuses: ["是", "否"],
    });
    draft = () => ({
      ops: [
        { kind: "put", itemId: 早饭.id, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 中饭.id, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 晚饭.id, date: "2026-11-15", status: "是" },
      ],
    });

    const result = await service.write({
      text: "今天没有吃早饭,没有吃中饭,但是吃了晚饭",
    });
    expect("question" in result).toBe(false);
    if (!("entries" in result)) throw new Error("unreachable");
    expect(result.written).toBe(3);
    expect(result.cleared).toEqual([]);
    expect(result.createdAt).toBe("2026-11-15T08:00:00.000Z");
    expect(result.entries).toHaveLength(3);
    // Full landed rows, mirrored by hand in the contract client.
    expect(result.entries[0]).toEqual({
      id: result.entries[0]!.id,
      itemId: 早饭.id,
      title: "早饭",
      date: "2026-11-15",
      status: "否",
      updatedAt: "2026-11-15T08:00:00.000Z",
      created: true,
    });
    const day = await service.listEntries("2026-11-15", "2026-11-15");
    expect(day.entries.map((entry) => [entry.title, entry.status])).toEqual([
      ["早饭", "否"],
      ["中饭", "否"],
      ["晚饭", "是"],
    ]);
  });

  it("one ambiguous op asks and lands nothing — no partial application", async () => {
    const service = domain!.service;
    const 早饭 = await service.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    draft = () => ({
      // The first op would land; the second names an unknown item. The
      // resolve-first law: the question wins, zero writes.
      ops: [
        { kind: "put", itemId: 早饭.id, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 99, date: "2026-11-15", status: "是" },
      ],
    });
    const result = await service.write({ text: "早饭没吃,晚饭也没吃" });
    expect(result).toEqual({
      question: "没有找到 id 为 99 的事项。请在界面里确认事项名称后再说一次。",
    });
    const day = await service.listEntries("2026-11-15", "2026-11-15");
    expect(day.entries).toEqual([]);
  });

  it("a status outside the vocabulary asks and lands nothing", async () => {
    const service = domain!.service;
    const 早饭 = await service.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    draft = () => ({
      ops: [
        { kind: "put", itemId: 早饭.id, date: "2026-11-15", status: "没吃" },
      ],
    });
    const result = await service.write({ text: "早饭没吃" });
    expect(result).toEqual({
      question:
        "「没吃」不在「早饭」的状态词表里(可选:是、否)。请在界面里对照词表后再说一次。",
    });
    const day = await service.listEntries("2026-11-15", "2026-11-15");
    expect(day.entries).toEqual([]);
  });

  it("a clear lands by natural key; an absent record is an honest no-op", async () => {
    const service = domain!.service;
    const 早饭 = await service.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    const landed = await service.putEntry({
      itemId: 早饭.id,
      date: "2026-11-15",
      status: "是",
    });
    draft = () => ({
      ops: [{ kind: "clear", itemId: 早饭.id, date: "2026-11-15" }],
    });
    const result = await service.write({ text: "把今天早饭的记录删掉" });
    expect(result).toEqual({
      written: 0,
      entries: [],
      cleared: [
        { id: landed.id, itemId: 早饭.id, title: "早饭", date: "2026-11-15" },
      ],
      createdAt: "2026-11-15T08:00:00.000Z",
    });
    expect(
      (await service.listEntries("2026-11-15", "2026-11-15")).entries,
    ).toEqual([]);

    // The same clear again: nothing stored for the pair, still no error.
    const again = await service.write({ text: "把今天早饭的记录删掉" });
    expect(again).toEqual({
      written: 0,
      entries: [],
      cleared: [],
      createdAt: "2026-11-15T08:00:00.000Z",
    });
  });

  it("memory receipts ride the receipt, opaque passthrough", async () => {
    const service = domain!.service;
    const 早饭 = await service.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    const memoryReceipt = { action: "remembered", after: "- 早饭默认否" };
    draft = () => ({
      ops: [{ kind: "put", itemId: 早饭.id, date: "2026-11-15", status: "否" }],
      memoryReceipts: [memoryReceipt],
    });
    const result = await service.write({ text: "早饭没吃" });
    expect(result).toMatchObject({
      written: 1,
      memoryReceipts: [memoryReceipt],
    });
  });

  it("AI unconfigured answers the shared unconfigured error", async () => {
    // A domain without an extractor: no agentFactory, no env AI.
    caseCounter += 1;
    const config = resolveConfig({
      env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
    });
    await app.close();
    const bare = createScheduleDomain({ config, clock: () => nowMs });
    app = await createTestApp({
      config,
      domains: [(instance) => instance.register(bare.plugin)],
    });
    const error = await caughtAiError(bare.service.write({ text: "早饭没吃" }));
    expect(error.code).toBe("unconfigured");
    expect(error.message).toContain("AI is not configured");
  });

  it("blank text is rejected before anything runs", async () => {
    const service = domain!.service;
    await expect(service.write({ text: "   " })).rejects.toThrow(
      "text must not be empty",
    );
  });
});
