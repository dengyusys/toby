/**
 * Migrations are code, not tooling (docs/decisions/db-adapter.md): a minimal
 * schema_version table plus a forward-only ordered statement list per
 * domain, applied through the port at startup. No down migrations, no CLI.
 * A batch is atomic on SQLite; MySQL DDL auto-commits, so DDL statements
 * lean on IF NOT EXISTS habits. The schema_version table name is reserved
 * inside every domain database.
 */

import type { DomainDb } from "./types.ts";

/** One migration step; each statement string is exactly one statement. */
export interface DomainMigrationStep {
  readonly version: number;
  /** Statements per dialect — DDL is where the dialects genuinely differ. */
  readonly sqlite: readonly string[];
  readonly mysql: readonly string[];
}

export interface DomainMigrations {
  readonly steps: readonly DomainMigrationStep[];
}

const CREATE_SCHEMA_VERSION =
  "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL PRIMARY KEY)";

export async function applyMigrations(
  db: DomainDb,
  migrations: DomainMigrations,
): Promise<void> {
  for (const [index, step] of migrations.steps.entries()) {
    const previous = index > 0 ? migrations.steps[index - 1] : undefined;
    if (
      !Number.isInteger(step.version) ||
      step.version < 1 ||
      (previous !== undefined && step.version <= previous.version)
    ) {
      throw new Error(
        `migration versions must be integers >= 1, strictly increasing; step ${index} has ${step.version}`,
      );
    }
  }

  await db.exec(CREATE_SCHEMA_VERSION);
  const appliedRows = await db.query<{ version: number }>(
    "SELECT version FROM schema_version",
  );
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const step of migrations.steps) {
    if (applied.has(step.version)) {
      continue;
    }
    const statements = db.dialect === "sqlite" ? step.sqlite : step.mysql;
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.exec(statement);
      }
      await tx.run("INSERT INTO schema_version (version) VALUES (?)", [
        step.version,
      ]);
    });
  }
}
