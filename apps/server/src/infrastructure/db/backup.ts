/**
 * Domain database backup: snapshots every SQLite database in the data root
 * via `VACUUM INTO` — a consistent copy even while the server is running,
 * because the statement reads a clean snapshot (WAL-buffered content
 * included) instead of copying files that may be mid-write. Every snapshot
 * gets a SHA-256 checksum recorded in a manifest, per the AGENTS.md data
 * rule (checksums before and after any move or restore).
 *
 * The library part has no side effects and takes explicit paths — the CLI
 * wrapper (backup-cli.ts) resolves defaults and parses arguments. Restore
 * procedure is documented in docs/operations/backup.md.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface BackupOptions {
  /** Directory holding the domain databases (the server's data root). */
  readonly dataRoot: string;
  /** Target directory for this backup run; must be empty or absent. */
  readonly outDir: string;
}

export type BackupMethod = "vacuum-into" | "file-copy";

export interface BackupEntry {
  /** Source path relative to the data root. */
  readonly source: string;
  /** Backed-up file path relative to the backup directory. */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** vacuum-into = consistent SQLite snapshot; file-copy = byte copy. */
  readonly method: BackupMethod;
}

export interface BackupManifest {
  readonly createdAt: string;
  readonly dataRoot: string;
  readonly entries: readonly BackupEntry[];
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Back up every domain database in `dataRoot` into `outDir`.
 * Throws when the data root is missing, contains no databases, or the
 * target directory already holds files — a backup never overwrites.
 */
export function runBackup(options: BackupOptions): BackupManifest {
  const { dataRoot, outDir } = options;
  if (!existsSync(dataRoot) || !statSync(dataRoot).isDirectory()) {
    throw new Error(`data root does not exist: ${dataRoot}`);
  }

  const names = readdirSync(dataRoot).filter((name) => {
    if (!name.endsWith(".db")) return false;
    // WAL sidecars are folded into the VACUUM snapshot; copying them
    // separately would back up mid-write state.
    return !name.endsWith(".db-wal") && !name.endsWith(".db-shm");
  });
  if (names.length === 0) {
    throw new Error(`no SQLite databases found in ${dataRoot}`);
  }

  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`backup target is not empty: ${outDir}`);
  }
  mkdirSync(outDir, { recursive: true });

  const entries: BackupEntry[] = [];

  for (const name of names) {
    const source = path.join(dataRoot, name);
    const target = path.join(outDir, name);
    // VACUUM INTO refuses an existing target and interprets the path as a
    // SQL string: forward slashes and doubled quotes, always.
    const targetSql = target.replace(/\\/g, "/").replace(/'/g, "''");
    const db = new Database(source, { readonly: true });
    try {
      db.exec(`VACUUM INTO '${targetSql}'`);
    } finally {
      db.close();
    }
    entries.push({
      source: name,
      file: name,
      bytes: statSync(target).size,
      sha256: sha256(target),
      method: "vacuum-into",
    });
  }

  // Non-database files in the data root (domain file storage) travel as
  // plain byte copies; -wal / -shm sidecars are excluded — the VACUUM
  // snapshot already contains their committed content.
  for (const name of readdirSync(dataRoot)) {
    if (
      name.endsWith(".db") ||
      name.endsWith(".db-wal") ||
      name.endsWith(".db-shm")
    ) {
      continue;
    }
    const source = path.join(dataRoot, name);
    if (!statSync(source).isFile()) {
      continue;
    }
    copyFileSync(source, path.join(outDir, name));
    entries.push({
      source: name,
      file: name,
      bytes: statSync(path.join(outDir, name)).size,
      sha256: sha256(path.join(outDir, name)),
      method: "file-copy",
    });
  }

  entries.sort((a, b) => a.source.localeCompare(b.source));

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    dataRoot,
    entries,
  };
  writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
