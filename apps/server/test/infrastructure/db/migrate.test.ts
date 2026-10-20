/**
 * Migration runner: applied once in order, recorded in schema_version,
 * idempotent on re-runs, dialect-aware statement lists. The MySQL leg runs
 * only when TOBY_TEST_MYSQL_URL is set.
 */

import { afterAll, describe, expect, it } from "vitest";
import { DbError } from "../../../src/infrastructure/db/errors.ts";
import {
  type DomainMigrations,
  applyMigrations,
} from "../../../src/infrastructure/db/migrate.ts";
import type { DomainDb } from "../../../src/infrastructure/db/types.ts";
import {
  createMysqlTestDbs,
  createSqliteTestDbs,
  type MakeDomainDb,
} from "./port-contract.ts";

const sqliteDbs = createSqliteTestDbs();
const mysqlDbs = createMysqlTestDbs();

afterAll(() => {
  sqliteDbs.cleanup();
});

afterAll(async () => {
  await mysqlDbs?.cleanup();
});

async function appliedVersions(db: DomainDb): Promise<number[]> {
  const rows = await db.query<{ version: number }>(
    "SELECT version FROM schema_version ORDER BY version",
  );
  return rows.map((row) => row.version);
}

function runMigrationSuite(makeDb: MakeDomainDb): void {
  it("applies steps in order, records versions, re-runs change nothing", async () => {
    const db = await makeDb();
    try {
      const migrations: DomainMigrations = {
        steps: [
          {
            version: 1,
            sqlite: [
              "CREATE TABLE mg_one (id INTEGER PRIMARY KEY, name VARCHAR(32) NOT NULL)",
            ],
            mysql: [
              "CREATE TABLE mg_one (id INT PRIMARY KEY, name VARCHAR(32) NOT NULL)",
            ],
          },
          {
            version: 2,
            sqlite: ["INSERT INTO mg_one (id, name) VALUES (1, 'seed')"],
            mysql: ["INSERT INTO mg_one (id, name) VALUES (1, 'seed')"],
          },
        ],
      };
      await applyMigrations(db, migrations);
      expect(await appliedVersions(db)).toEqual([1, 2]);
      const seeded = (
        await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM mg_one")
      )[0]!;
      expect(seeded.n).toBe(1);

      // Second run: already-applied versions are skipped, zero new writes.
      await applyMigrations(db, migrations);
      expect(await appliedVersions(db)).toEqual([1, 2]);
      const stillSeeded = (
        await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM mg_one")
      )[0]!;
      expect(stillSeeded.n).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("picks the statement list for its own dialect", async () => {
    const db = await makeDb();
    try {
      await applyMigrations(db, {
        steps: [
          {
            version: 1,
            sqlite: ["CREATE TABLE mg_sqlite_marker (x INTEGER)"],
            mysql: ["CREATE TABLE mg_mysql_marker (x INTEGER)"],
          },
        ],
      });
      const ownTable =
        db.dialect === "sqlite" ? "mg_sqlite_marker" : "mg_mysql_marker";
      const otherTable =
        db.dialect === "sqlite" ? "mg_mysql_marker" : "mg_sqlite_marker";
      const rows = await db.query(`SELECT x FROM ${ownTable}`);
      expect(rows).toEqual([]);
      const error = await db
        .query(`SELECT x FROM ${otherTable}`)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
    } finally {
      await db.close();
    }
  });

  it("rejects unordered versions before applying anything", async () => {
    const db = await makeDb();
    try {
      await expect(
        applyMigrations(db, {
          steps: [
            {
              version: 2,
              sqlite: ["CREATE TABLE mg_bad (x INTEGER)"],
              mysql: ["CREATE TABLE mg_bad (x INTEGER)"],
            },
            {
              version: 1,
              sqlite: ["CREATE TABLE mg_worse (x INTEGER)"],
              mysql: ["CREATE TABLE mg_worse (x INTEGER)"],
            },
          ],
        }),
      ).rejects.toThrow(/strictly increasing/);
      // Zero writes: validation fires before even schema_version exists.
      const schemaTable = await db
        .query("SELECT version FROM schema_version")
        .catch((caught: unknown) => caught);
      expect(schemaTable).toBeInstanceOf(DbError);
      const badTable = await db
        .query("SELECT x FROM mg_bad")
        .catch((caught: unknown) => caught);
      expect(badTable).toBeInstanceOf(DbError);
    } finally {
      await db.close();
    }
  });
}

describe("migrations (sqlite)", () => {
  runMigrationSuite(sqliteDbs.makeDb);
});

describe.skipIf(!mysqlDbs)("migrations (TOBY_TEST_MYSQL_URL)", () => {
  // skipIf still collects the suite body; bail out when the gate is off.
  if (!mysqlDbs) {
    return;
  }
  runMigrationSuite(mysqlDbs.makeDb);
});
