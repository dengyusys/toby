/**
 * The shared port-level contract suite: every adapter must satisfy the same
 * behavior — statements, every declared parameter type, transactions,
 * normalized results, mapped errors. This is a helper file (not a .test
 * file) so each adapter's test file runs the suite exactly once against its
 * own databases, and the migration tests can reuse the same factories.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/infrastructure/config/config.ts";
import { createDomainDb } from "../../../src/infrastructure/db/create-db.ts";
import { DbError } from "../../../src/infrastructure/db/errors.ts";
import type { DomainDb } from "../../../src/infrastructure/db/types.ts";

export type MakeDomainDb = () => Promise<DomainDb>;

// INTEGER / BIGINT / VARCHAR / BLOB / NULL behave identically in both
// dialects; only auto-increment needs dialect-specific DDL (one test below).
const SAMPLES_DDL =
  "CREATE TABLE port_samples (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL, flag INTEGER, amount BIGINT, payload BLOB)";

const UNIQUE_DDL =
  "CREATE TABLE port_unique (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE)";

/** Catch helper: assert on the caught error, not the rejection shape. */
async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

export function runDomainDbContractSuite(makeDb: MakeDomainDb): void {
  describe("domain db contract", () => {
    it("exec/query/run round-trip a table; no match returns []", async () => {
      const db = await makeDb();
      try {
        await db.exec(SAMPLES_DDL);
        const inserted = await db.run(
          "INSERT INTO port_samples (id, name) VALUES (?, ?)",
          [1, "toby"],
        );
        expect(inserted.changes).toBe(1);
        const rows = await db.query<{ id: number; name: string }>(
          "SELECT id, name FROM port_samples WHERE id = ?",
          [1],
        );
        expect(rows).toEqual([{ id: 1, name: "toby" }]);
        const missing = await db.query(
          "SELECT id FROM port_samples WHERE id = ?",
          [404],
        );
        expect(missing).toEqual([]);
      } finally {
        await db.close();
      }
    });

    it("run() reports insertId after INSERT", async () => {
      const db = await makeDb();
      try {
        const ddl =
          db.dialect === "sqlite"
            ? "CREATE TABLE port_auto (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(64) NOT NULL)"
            : "CREATE TABLE port_auto (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(64) NOT NULL)";
        await db.exec(ddl);
        const first = await db.run("INSERT INTO port_auto (name) VALUES (?)", [
          "one",
        ]);
        const second = await db.run("INSERT INTO port_auto (name) VALUES (?)", [
          "two",
        ]);
        expect(first.changes).toBe(1);
        expect(first.insertId).toBe(1);
        expect(second.insertId).toBe(2);
      } finally {
        await db.close();
      }
    });

    it("binds every declared parameter type", async () => {
      const db = await makeDb();
      try {
        await db.exec(SAMPLES_DDL);
        await db.run(
          "INSERT INTO port_samples (id, name, flag, amount, payload) VALUES (?, ?, ?, ?, ?)",
          [1, "all-types", true, 9007199254740991n, new Uint8Array([1, 2, 3])],
        );
        await db.run(
          "INSERT INTO port_samples (id, name, flag) VALUES (?, ?, ?)",
          [2, "null-flag", null],
        );
        const rows = await db.query<{
          name: string;
          flag: number | null;
          amount: number | bigint | null;
          payload: Uint8Array | null;
        }>(
          "SELECT name, flag, amount, payload FROM port_samples WHERE id = ?",
          [1],
        );
        const row = rows[0]!;
        expect(row.name).toBe("all-types");
        // Neither driver returns real booleans: bound true reads back as 1.
        expect(row.flag).toBe(1);
        expect(Number(row.amount)).toBe(9007199254740991);
        expect(Buffer.from(row.payload!)).toEqual(Buffer.from([1, 2, 3]));
        const nullRows = await db.query<{ flag: number | null }>(
          "SELECT flag FROM port_samples WHERE id = ?",
          [2],
        );
        expect(nullRows[0]!.flag).toBeNull();
      } finally {
        await db.close();
      }
    });

    it("run() counts affected rows on UPDATE", async () => {
      const db = await makeDb();
      try {
        await db.exec(SAMPLES_DDL);
        for (const id of [1, 2, 3]) {
          await db.run("INSERT INTO port_samples (id, name) VALUES (?, ?)", [
            id,
            `row-${id}`,
          ]);
        }
        const updated = await db.run(
          "UPDATE port_samples SET name = ? WHERE id <= ?",
          ["renamed", 2],
        );
        expect(updated.changes).toBe(2);
      } finally {
        await db.close();
      }
    });

    it("maps unique violations to DbError unique-violation", async () => {
      const db = await makeDb();
      try {
        await db.exec(UNIQUE_DDL);
        await db.run("INSERT INTO port_unique (id, name) VALUES (?, ?)", [
          1,
          "only",
        ]);
        const error = await catchError(
          db.run("INSERT INTO port_unique (id, name) VALUES (?, ?)", [
            2,
            "only",
          ]),
        );
        expect(error).toBeInstanceOf(DbError);
        const dbError = error as DbError;
        expect(dbError.code).toBe("unique-violation");
        expect(dbError.cause).toBeInstanceOf(Error);
      } finally {
        await db.close();
      }
    });

    it("enforces foreign keys and maps violations", async () => {
      const db = await makeDb();
      try {
        await db.exec(
          "CREATE TABLE port_parent (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL)",
        );
        await db.exec(
          "CREATE TABLE port_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL, CONSTRAINT port_child_parent_fk FOREIGN KEY (parent_id) REFERENCES port_parent (id))",
        );
        const orphan = await catchError(
          db.run(
            "INSERT INTO port_child (id, parent_id) VALUES (?, ?)",
            [1, 404],
          ),
        );
        expect(orphan).toBeInstanceOf(DbError);
        expect((orphan as DbError).code).toBe("foreign-key-violation");
        await db.run("INSERT INTO port_parent (id, name) VALUES (?, ?)", [
          1,
          "parent",
        ]);
        await db.run(
          "INSERT INTO port_child (id, parent_id) VALUES (?, ?)",
          [1, 1],
        );
        const removal = await catchError(
          db.run("DELETE FROM port_parent WHERE id = ?", [1]),
        );
        expect(removal).toBeInstanceOf(DbError);
        expect((removal as DbError).code).toBe("foreign-key-violation");
      } finally {
        await db.close();
      }
    });

    it("transaction commits on resolve, rolls back on reject", async () => {
      const db = await makeDb();
      try {
        await db.exec(SAMPLES_DDL);
        const value = await db.transaction(async (tx) => {
          await tx.run("INSERT INTO port_samples (id, name) VALUES (?, ?)", [
            1,
            "kept",
          ]);
          return "done";
        });
        expect(value).toBe("done");
        // Body errors pass through unwrapped — they are not driver errors.
        await expect(
          db.transaction(async (tx) => {
            await tx.run("INSERT INTO port_samples (id, name) VALUES (?, ?)", [
              2,
              "doomed",
            ]);
            throw new Error("boom");
          }),
        ).rejects.toThrow("boom");
        const rows = await db.query<{ id: number }>(
          "SELECT id FROM port_samples ORDER BY id",
        );
        expect(rows).toEqual([{ id: 1 }]);
      } finally {
        await db.close();
      }
    });

    it("a failed statement inside a transaction rolls back the batch", async () => {
      const db = await makeDb();
      try {
        await db.exec(UNIQUE_DDL);
        const error = await catchError(
          db.transaction(async (tx) => {
            await tx.run("INSERT INTO port_unique (id, name) VALUES (?, ?)", [
              1,
              "first",
            ]);
            await tx.run("INSERT INTO port_unique (id, name) VALUES (?, ?)", [
              2,
              "first",
            ]);
          }),
        );
        expect(error).toBeInstanceOf(DbError);
        expect((error as DbError).code).toBe("unique-violation");
        const count = (
          await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM port_unique")
        )[0]!;
        expect(count.n).toBe(0);
      } finally {
        await db.close();
      }
    });

    it("close() ends the database; later operations reject as DbError", async () => {
      const db = await makeDb();
      await db.exec(SAMPLES_DDL);
      await db.close();
      const error = await catchError(db.exec("SELECT * FROM port_samples"));
      expect(error).toBeInstanceOf(DbError);
    });
  });
}

/**
 * Fresh sqlite databases: unique domain names, one temp data root per run,
 * removed afterwards. Production data/ is never touched.
 */
export function createSqliteTestDbs(): {
  makeDb: MakeDomainDb;
  dataRoot: string;
  cleanup: () => void;
} {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-db-contract-"));
  const config = resolveConfig({ env: { TOBY_DATA_ROOT: dataRoot } });
  let counter = 0;
  return {
    makeDb: () => {
      counter += 1;
      return createDomainDb(config, `contract${counter}`);
    },
    dataRoot,
    cleanup: () => {
      rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Fresh MySQL schemas (only when TOBY_TEST_MYSQL_URL is set): the URL
 * supplies connection coordinates, schemas are named toby_test_<domain> and
 * dropped afterwards. Returns undefined when the gate is off.
 */
export function createMysqlTestDbs():
  | {
      makeDb: MakeDomainDb;
      makeDbFor: (domain: string) => Promise<DomainDb>;
      cleanup: () => Promise<void>;
    }
  | undefined {
  const urlText = process.env.TOBY_TEST_MYSQL_URL;
  if (!urlText) {
    return undefined;
  }
  const url = new URL(urlText);
  const env = {
    TOBY_DB_DIALECT: "mysql",
    TOBY_DB_MYSQL_HOST: url.hostname,
    TOBY_DB_MYSQL_PORT: url.port || "3306",
    TOBY_DB_MYSQL_USER: decodeURIComponent(url.username),
    TOBY_DB_MYSQL_PASSWORD: decodeURIComponent(url.password),
    TOBY_DB_MYSQL_DATABASE_PREFIX: "toby_test_",
  };
  const config = resolveConfig({ env });
  let counter = 0;
  const created = new Set<string>();
  return {
    makeDb: () => {
      counter += 1;
      const domain = `contract${counter}`;
      created.add(`${env.TOBY_DB_MYSQL_DATABASE_PREFIX}${domain}`);
      return createDomainDb(config, domain);
    },
    makeDbFor: (domain: string) => {
      created.add(`${env.TOBY_DB_MYSQL_DATABASE_PREFIX}${domain}`);
      return createDomainDb(config, domain);
    },
    cleanup: async () => {
      const { createConnection } = await import("mysql2/promise");
      const connection = await createConnection({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      });
      try {
        for (const schema of created) {
          await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
        }
      } finally {
        await connection.end();
      }
    },
  };
}
