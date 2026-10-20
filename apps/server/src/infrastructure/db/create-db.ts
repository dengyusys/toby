/**
 * Per-domain database factory: one call per domain, one database per domain —
 * a SQLite file `data/<domain>.db` or, when the mysql dialect is on, a MySQL
 * schema `<prefix><domain>`. Which adapter answers is a configuration
 * choice, never a code choice.
 */

import type { TobyConfig } from "../config/config.ts";
import { DbError } from "./errors.ts";
import { createMySqlDomainDb } from "./mysql/adapter.ts";
import { createSqliteDomainDb } from "./sqlite/adapter.ts";
import type { DomainDb } from "./types.ts";

const DOMAIN_NAME = /^[a-z][a-z0-9]*$/;

export async function createDomainDb(
  config: TobyConfig,
  domain: string,
): Promise<DomainDb> {
  if (!DOMAIN_NAME.test(domain)) {
    throw new DbError("unknown", `invalid domain name: ${domain}`);
  }
  if (config.db.dialect === "mysql") {
    return createMySqlDomainDb(config.db.mysql, domain);
  }
  return createSqliteDomainDb(config.paths.dataRoot, domain);
}
