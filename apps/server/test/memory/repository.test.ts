/**
 * The memory repository over a real temp directory: missing file reads as
 * empty without creating it, one write is one full-file atomic replace,
 * the cap refuses instead of truncating, and a corrupt file is refused —
 * never repaired.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import {
  MemoryFileInvalidError,
  MemoryRequestError,
} from "../../src/domains/memory/errors.ts";
import { createMemoryFile } from "../../src/domains/memory/memory-file.ts";
import { serializeMemoryMarkdown } from "../../src/domains/memory/parser.ts";
import {
  createMemoryRepository,
  MAX_ENTRIES,
} from "../../src/domains/memory/repository.ts";
import type { MemoryEntry } from "../../src/domains/memory/types.ts";
import type { MemoryFile } from "../../src/domains/memory/memory-file.ts";
import type { MemoryRepository } from "../../src/domains/memory/repository.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-memory-repository-"));
// Late November evening UTC: a local (UTC+8) date would already be the 15th.
const clock = (): number => Date.parse("2026-11-14T23:30:00.000Z");

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

let caseCounter = 0;

function buildRepository(): {
  memoryFile: MemoryFile;
  repository: MemoryRepository;
} {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const memoryFile = createMemoryFile({ config });
  return {
    memoryFile,
    repository: createMemoryRepository({ memoryFile, clock }),
  };
}

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return { type: "约定", text: "条目", ...overrides };
}

describe("memory repository", () => {
  it("reads a missing file as empty memory and never creates it", async () => {
    const { memoryFile, repository } = buildRepository();
    expect(await repository.list()).toEqual([]);
    expect(await repository.readRaw()).toBeNull();
    // Neither MEMORY.md nor its memory/ parent was created by the read.
    expect(existsSync(memoryFile.path)).toBe(false);
    expect(existsSync(path.dirname(memoryFile.path))).toBe(false);
  });

  it("writes one full file atomically and reads it back", async () => {
    const { memoryFile, repository } = buildRepository();
    const entries = await repository.mutate((list) => [
      ...list,
      entry({ text: "咖啡记「饮品」" }),
      entry({ type: "人物", name: "小王", text: "房东" }),
    ]);
    expect(entries).toHaveLength(2);

    const raw = await repository.readRaw();
    expect(raw).toBe(
      serializeMemoryMarkdown({
        entries: [
          entry({ text: "咖啡记「饮品」" }),
          entry({ type: "人物", name: "小王", text: "房东" }),
        ],
      }),
    );
    expect(await repository.list()).toEqual([
      entry({ text: "咖啡记「饮品」" }),
      entry({ type: "人物", name: "小王", text: "房东" }),
    ]);

    // The atomic replace leaves no staging files behind.
    expect(
      readdirSync(path.dirname(memoryFile.path)).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("edits run against a freshly parsed list and land in one cycle", async () => {
    const { repository } = buildRepository();
    await repository.mutate((list) => [
      ...list,
      entry({ text: "第一条" }),
      entry({ text: "第二条" }),
    ]);
    const after = await repository.mutate((list) =>
      list.filter((e) => e.text !== "第一条"),
    );
    expect(after.map((e) => e.text)).toEqual(["第二条"]);
    expect(await repository.list()).toEqual([entry({ text: "第二条" })]);
  });

  it("today() is the UTC calendar date of the clock", () => {
    const { repository } = buildRepository();
    expect(repository.today()).toBe("2026-11-14");
  });

  it("refuses a corrupt file on read and on write, never repairing it", async () => {
    const { memoryFile, repository } = buildRepository();
    mkdirSync(path.dirname(memoryFile.path), { recursive: true });
    writeFileSync(memoryFile.path, "这不是记忆文件\n", "utf8");

    await expect(repository.list()).rejects.toBeInstanceOf(
      MemoryFileInvalidError,
    );
    await expect(repository.mutate((list) => list)).rejects.toBeInstanceOf(
      MemoryFileInvalidError,
    );
    // The garbage stays exactly as it was — no silent rewrite.
    expect(await repository.readRaw()).toBe("这不是记忆文件\n");
  });

  it("refuses writes past the cap instead of truncating", async () => {
    const { repository } = buildRepository();
    await repository.mutate((list) => [...list, entry({ text: "原有的一条" })]);

    const exactlyFull = Array.from({ length: MAX_ENTRIES - 1 }, (_, i) =>
      entry({ text: `条目${i}` }),
    );
    await repository.mutate((list) => [...list, ...exactlyFull]);
    expect(await repository.list()).toHaveLength(MAX_ENTRIES);
    const before = await repository.readRaw();

    let error: unknown;
    try {
      await repository.mutate((list) => [...list, entry({ text: "第501条" })]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MemoryRequestError);
    expect((error as MemoryRequestError).code).toBe("LIMIT_REACHED");
    expect((error as Error).message).toContain("该忘点什么");
    // The refused write changed nothing.
    expect(await repository.readRaw()).toBe(before);
  });
});
