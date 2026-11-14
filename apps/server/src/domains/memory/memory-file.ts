/**
 * The memory storage: data/memory/MEMORY.md, the one non-database store —
 * the recorded exception to one-database-per-domain
 * (docs/decisions/personal-agent-memory.md). This is the only memory file
 * that touches disk. Reads never create the file and never repair it;
 * writes are one full-file atomic replace (temp file + rename).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { parseMemoryMarkdown, serializeMemoryMarkdown } from "./parser.ts";
import type { ParsedMemory } from "./types.ts";

/**
 * Windows rename-over-existing can transiently fail with EPERM/EACCES/
 * EBUSY (antivirus or indexer holding the fresh temp file). A short
 * bounded retry keeps the atomic replace reliable; anything else, or
 * exhausting the retries, is a real error.
 */
async function renameWithRetry(
  fromPath: string,
  toPath: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

export interface MemoryFile {
  /** Absolute path of MEMORY.md (for tests and diagnostics). */
  readonly path: string;
  /** Parsed memory; a missing file reads as empty. */
  read(): Promise<ParsedMemory>;
  /** Raw file content, or null when the file does not exist yet. */
  readRaw(): Promise<string | null>;
  /** One full-file atomic replace of the serialized memory. */
  write(memory: ParsedMemory): Promise<void>;
}

export function createMemoryFile(deps: { config: TobyConfig }): MemoryFile {
  const filePath = path.join(deps.config.paths.dataRoot, "memory", "MEMORY.md");

  async function readRaw(): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      // A missing file is empty memory — reads never create the file.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  return {
    path: filePath,
    async read() {
      const raw = await readRaw();
      // A file that no longer parses throws MemoryFileInvalidError here:
      // refused, never repaired.
      return raw === null ? { entries: [] } : parseMemoryMarkdown(raw);
    },
    readRaw,
    async write(memory) {
      await mkdir(path.dirname(filePath), { recursive: true });
      // A unique staging name per write; the rename is the atomic step
      // that replaces the whole file at once.
      const tempPath = `${filePath}.${Date.now()}-${Math.trunc(Math.random() * 1e9)}.tmp`;
      await writeFile(tempPath, serializeMemoryMarkdown(memory), "utf8");
      await renameWithRetry(tempPath, filePath);
    },
  };
}
