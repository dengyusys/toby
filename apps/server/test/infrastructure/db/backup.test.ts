/**
 * Domain database backup against fixture databases in a temporary data
 * root: the VACUUM INTO snapshot (including WAL-buffered content from a
 * concurrently open writer), manifest checksums, file-copy for non-database
 * files, and the guard rails (missing root, empty root, non-empty target).
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { runBackup } from "../../../src/infrastructure/db/backup.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-backup-"));
const dataRoot = path.join(baseDir, "data");

beforeAll(() => {
  mkdirSync(dataRoot, { recursive: true });
  // Two domain databases with real tables and rows, WAL mode like production.
  for (const name of ["ledger.db", "notes.db"]) {
    const db = new Database(path.join(dataRoot, name));
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, note TEXT)");
    db.prepare("INSERT INTO items (note) VALUES (?)").run(`first-${name}`);
    db.close();
  }
  // A non-database file travels as a byte copy.
  writeFileSync(path.join(dataRoot, "domain-file.txt"), "attachment");
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("runBackup", () => {
  it("snapshots both databases and copies non-database files", () => {
    const outDir = path.join(baseDir, "out-1");
    const manifest = runBackup({ dataRoot, outDir });

    expect(manifest.entries.map((entry) => entry.source)).toEqual([
      "domain-file.txt",
      "ledger.db",
      "notes.db",
    ]);
    expect(manifest.entries.map((entry) => entry.method)).toEqual([
      "file-copy",
      "vacuum-into",
      "vacuum-into",
    ]);
    for (const entry of manifest.entries) {
      const file = path.join(outDir, entry.file);
      expect(existsSync(file)).toBe(true);
      expect(entry.sha256).toBe(
        createHash("sha256").update(readFileSync(file)).digest("hex"),
      );
    }
    expect(readFileSync(path.join(outDir, "manifest.json"), "utf8")).toContain(
      "ledger.db",
    );
  });

  it("captures WAL-buffered rows from a concurrently open writer", () => {
    // Connection A stays open (WAL holds the latest insert); the backup
    // runs over a second connection and must include the committed row —
    // the whole point versus a naive file copy.
    const writer = new Database(path.join(dataRoot, "ledger.db"));
    writer.prepare("INSERT INTO items (note) VALUES (?)").run("during-wal");

    const outDir = path.join(baseDir, "out-2");
    runBackup({ dataRoot, outDir });

    const snapshot = new Database(path.join(outDir, "ledger.db"), {
      readonly: true,
    });
    const notes = snapshot
      .prepare("SELECT note FROM items ORDER BY id")
      .all()
      .map((row) => (row as { note: string }).note);
    snapshot.close();
    writer.close();
    expect(notes).toEqual(["first-ledger.db", "during-wal"]);
  });

  it("leaves the source databases untouched", () => {
    const before = readFileSync(path.join(dataRoot, "ledger.db"));
    const writer = new Database(path.join(dataRoot, "ledger.db"));
    const rows = writer
      .prepare("SELECT COUNT(*) AS count FROM items")
      .get() as { count: number };
    writer.close();
    const after = readFileSync(path.join(dataRoot, "ledger.db"));
    expect(rows.count).toBe(2);
    expect(after.equals(before)).toBe(true);
  });

  it("refuses a missing data root", () => {
    expect(() =>
      runBackup({
        dataRoot: path.join(baseDir, "no-such-root"),
        outDir: path.join(baseDir, "out-3"),
      }),
    ).toThrow(/data root does not exist/);
  });

  it("refuses a data root without databases", () => {
    const emptyRoot = path.join(baseDir, "empty");
    mkdirSync(emptyRoot, { recursive: true });
    expect(() =>
      runBackup({ dataRoot: emptyRoot, outDir: path.join(baseDir, "out-4") }),
    ).toThrow(/no SQLite databases/);
  });

  it("refuses to overwrite a non-empty backup target", () => {
    const outDir = path.join(baseDir, "out-5");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "stale.db"), "x");
    expect(() => runBackup({ dataRoot, outDir })).toThrow(
      /backup target is not empty/,
    );
  });
});
