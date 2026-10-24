/**
 * Backup CLI: wraps runBackup with argument parsing and exit codes.
 *
 *   node src/infrastructure/db/backup-cli.ts [--data-root <dir>] [--out <dir>]
 *
 * Defaults: data root from TOBY_DATA_ROOT (falling back to <repo>/data),
 * output to <repo>/backups/<timestamp>. Runs against the live data root
 * safely — VACUUM INTO takes a consistent snapshot without stopping the
 * server and never writes to the source databases.
 */

import path from "node:path";
import { runBackup } from "./backup.ts";
import { repositoryRoot } from "../../utils/paths/index.ts";

function argumentOf(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataRoot = path.resolve(
  argumentOf("--data-root") ??
    process.env.TOBY_DATA_ROOT ??
    path.join(repositoryRoot, "data"),
);
const outDir = path.resolve(
  argumentOf("--out") ??
    path.join(
      repositoryRoot,
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);

try {
  const manifest = runBackup({ dataRoot, outDir });
  for (const entry of manifest.entries) {
    console.log(
      `backed up ${entry.source} → ${entry.file} (${entry.method}, ${entry.bytes} bytes, sha256 ${entry.sha256})`,
    );
  }
  console.log(`manifest: ${path.join(outDir, "manifest.json")}`);
} catch (error) {
  console.error(
    "backup failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
