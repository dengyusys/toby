/**
 * MySQL adapter tests. The ungated leg needs no running server: it only
 * proves connection failures map to DbError. The full port contract suite
 * runs when TOBY_TEST_MYSQL_URL is set (skipped by default, so
 * `pnpm run test` never requires a MySQL daemon).
 */

import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/infrastructure/config/config.ts";
import { createDomainDb } from "../../../src/infrastructure/db/create-db.ts";
import { DbError } from "../../../src/infrastructure/db/errors.ts";
import {
  createMysqlTestDbs,
  runDomainDbContractSuite,
} from "./port-contract.ts";

describe("mysql adapter (no server required)", () => {
  it("maps connection failures to DbError connection", async () => {
    const config = resolveConfig({
      env: {
        TOBY_DB_DIALECT: "mysql",
        TOBY_DB_MYSQL_HOST: "127.0.0.1",
        TOBY_DB_MYSQL_PORT: "1", // nothing listens here
      },
    });
    const error = await createDomainDb(config, "system").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).code).toBe("connection");
  });

  it("rejects domain names that would not form a valid schema", async () => {
    const config = resolveConfig({
      env: { TOBY_DB_DIALECT: "mysql" },
    });
    await expect(createDomainDb(config, "not-a-domain")).rejects.toBeInstanceOf(
      DbError,
    );
  });
});

const mysqlDbs = createMysqlTestDbs();

describe.skipIf(!mysqlDbs)("mysql adapter (TOBY_TEST_MYSQL_URL)", () => {
  // skipIf still collects the suite body; bail out when the gate is off.
  if (!mysqlDbs) {
    return;
  }

  afterAll(async () => {
    await mysqlDbs.cleanup();
  });

  runDomainDbContractSuite(mysqlDbs.makeDb);

  it("reopens an existing schema and sees prior writes", async () => {
    // createDomainDb twice on the same domain: the second call must find the
    // schema already there (CREATE DATABASE IF NOT EXISTS is idempotent) and
    // see rows written through the first handle.
    const first = await mysqlDbs.makeDbFor("reopen");
    await first.exec("CREATE TABLE reopen_probe (id INTEGER PRIMARY KEY)");
    await first.run("INSERT INTO reopen_probe (id) VALUES (?)", [1]);
    await first.close();

    const second = await mysqlDbs.makeDbFor("reopen");
    const rows = await second.query<{ id: number }>(
      "SELECT id FROM reopen_probe",
    );
    await second.close();
    expect(rows).toEqual([{ id: 1 }]);
  });
});
