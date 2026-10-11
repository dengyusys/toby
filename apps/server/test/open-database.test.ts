/**
 * openDatabase: parent directory creation, WAL pragma, and basic
 * read/write round-trip in a temporary directory — production data is
 * never touched.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/infrastructure/db/open-database.ts";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDirForTest(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "toby-db-"));
  tempDirs.push(dir);
  return dir;
}

describe("openDatabase", () => {
  it("creates missing parent directories and the database file", () => {
    const dbPath = path.join(tempDirForTest(), "nested", "test.db");
    const db = openDatabase(dbPath);
    try {
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("enables WAL and accepts writes", () => {
    const db = openDatabase(path.join(tempDirForTest(), "test.db"));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      db.exec(
        "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      db.prepare("INSERT INTO sample (name) VALUES (?)").run("toby");
      const row = db.prepare("SELECT name FROM sample WHERE id = 1").get() as {
        name: string;
      };
      expect(row.name).toBe("toby");
    } finally {
      db.close();
    }
  });
});
