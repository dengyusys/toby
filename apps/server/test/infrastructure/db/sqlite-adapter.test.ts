/**
 * SQLite adapter: the shared port contract plus sqlite-specific behavior —
 * file placement, WAL, and the serialization queue that keeps a transaction
 * exclusive. All in temporary directories; production data is never touched.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/infrastructure/config/config.ts";
import { createDomainDb } from "../../../src/infrastructure/db/create-db.ts";
import {
  createSqliteTestDbs,
  runDomainDbContractSuite,
} from "./port-contract.ts";

const sqliteDbs = createSqliteTestDbs();

afterAll(() => {
  sqliteDbs.cleanup();
});

runDomainDbContractSuite(sqliteDbs.makeDb);

describe("sqlite adapter specifics", () => {
  it("creates the domain file and missing parent directories", async () => {
    const nestedRoot = path.join(sqliteDbs.dataRoot, "nested", "deeper");
    const config = resolveConfig({ env: { TOBY_DATA_ROOT: nestedRoot } });
    const db = await createDomainDb(config, "ledger");
    try {
      expect(existsSync(path.join(nestedRoot, "ledger.db"))).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("enables WAL journal mode", async () => {
    const db = await sqliteDbs.makeDb();
    try {
      const rows = await db.query<{ journal_mode: string }>(
        "PRAGMA journal_mode",
      );
      expect(rows[0]!.journal_mode).toBe("wal");
    } finally {
      await db.close();
    }
  });

  it("serializes operations: a transaction holds the queue until commit", async () => {
    const db = await sqliteDbs.makeDb();
    try {
      await db.exec(
        "CREATE TABLE queue_order (id INTEGER PRIMARY KEY, v VARCHAR(16))",
      );
      const events: string[] = [];
      const transaction = db.transaction(async (tx) => {
        events.push("tx-begin");
        await tx.run("INSERT INTO queue_order (id, v) VALUES (?, ?)", [
          1,
          "one",
        ]);
        // A foreign await during the transaction: the queue is held, so no
        // outside statement can slip between the two inserts.
        await new Promise((resolve) => setTimeout(resolve, 80));
        await tx.run("INSERT INTO queue_order (id, v) VALUES (?, ?)", [
          2,
          "two",
        ]);
        events.push("tx-end");
      });
      const queuedWrite = db
        .run("INSERT INTO queue_order (id, v) VALUES (?, ?)", [3, "three"])
        .then(() => {
          events.push("queued-write-done");
        });
      await Promise.all([transaction, queuedWrite]);
      expect(events.indexOf("tx-end")).toBeLessThan(
        events.indexOf("queued-write-done"),
      );
      const count = (
        await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM queue_order")
      )[0]!;
      expect(count.n).toBe(3);
    } finally {
      await db.close();
    }
  });
});
