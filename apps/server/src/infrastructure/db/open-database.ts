/**
 * Database opening: every domain database goes through this single helper —
 * it creates the parent directory on demand and applies the shared SQLite
 * pragmas (WAL for concurrent reads during writes, foreign_keys for
 * integrity). Only the server process calls this.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
