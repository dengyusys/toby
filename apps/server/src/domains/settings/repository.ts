/**
 * Settings repository: hand-written SQL over the domain database (db.ts
 * owns the connection and schema). Credential JSON is treated as opaque
 * here — pi-ai's typing lives in the credential-store adapter. Every
 * write goes through `apply`: one transaction over the whole change set,
 * so a PUT is all-or-nothing by construction.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { DbDialect } from "../../infrastructure/db/types.ts";
import type { SettingsDb } from "./db.ts";

/** One all-or-nothing write: every listed change lands, or none does. */
export interface SettingsChanges {
  readonly setSettings?: readonly { key: string; value: string }[];
  readonly deleteSettings?: readonly string[];
  readonly setCredentials?: readonly {
    providerId: string;
    credentialJson: string;
  }[];
  readonly deleteCredentials?: readonly string[];
}

export interface SettingsRepository {
  /** One stored settings value, or null when the key is absent. */
  get(key: string): Promise<string | null>;
  /** Every change in one transaction: all land, or nothing does. */
  apply(changes: SettingsChanges): Promise<void>;
  /** The raw credential JSON stored for one provider, or null. */
  readCredential(providerId: string): Promise<string | null>;
  /** The provider ids that carry a stored credential, sorted. */
  listCredentialIds(): Promise<readonly string[]>;
}

/**
 * The upsert per dialect: each dialect's own single-statement replace on a
 * PRIMARY KEY table (`REPLACE INTO` on MySQL, `INSERT OR REPLACE` on SQLite).
 */
function upsertSql(
  dialect: DbDialect,
  table: "settings" | "provider_credentials",
): string {
  const columns =
    table === "settings"
      ? "setting_key, value, updated_at"
      : "provider_id, credential_json, updated_at";
  if (dialect === "mysql") {
    return `REPLACE INTO ${table} (${columns}) VALUES (?, ?, ?)`;
  }
  return `INSERT OR REPLACE INTO ${table} (${columns}) VALUES (?, ?, ?)`;
}

export function createSettingsRepository(deps: {
  db: SettingsDb;
  clock: Clock;
}): SettingsRepository {
  const { db, clock } = deps;

  return {
    async get(key) {
      const handle = await db.open();
      const rows = await handle.query<{ value: string }>(
        "SELECT value FROM settings WHERE setting_key = ?",
        [key],
      );
      return rows[0]?.value ?? null;
    },

    async apply(changes) {
      const handle = await db.open();
      await handle.transaction(async (tx) => {
        const updatedAt = new Date(clock()).toISOString();
        // Deletes first: a change set that both deletes and re-sets one
        // key ends up with the new value, never the old one.
        for (const key of changes.deleteSettings ?? []) {
          await tx.run("DELETE FROM settings WHERE setting_key = ?", [key]);
        }
        for (const { key, value } of changes.setSettings ?? []) {
          await tx.run(upsertSql(handle.dialect, "settings"), [
            key,
            value,
            updatedAt,
          ]);
        }
        for (const providerId of changes.deleteCredentials ?? []) {
          await tx.run(
            "DELETE FROM provider_credentials WHERE provider_id = ?",
            [providerId],
          );
        }
        for (const { providerId, credentialJson } of changes.setCredentials ??
          []) {
          await tx.run(upsertSql(handle.dialect, "provider_credentials"), [
            providerId,
            credentialJson,
            updatedAt,
          ]);
        }
      });
    },

    async readCredential(providerId) {
      const handle = await db.open();
      const rows = await handle.query<{ credential_json: string }>(
        "SELECT credential_json FROM provider_credentials WHERE provider_id = ?",
        [providerId],
      );
      return rows[0]?.credential_json ?? null;
    },

    async listCredentialIds() {
      const handle = await db.open();
      const rows = await handle.query<{ provider_id: string }>(
        "SELECT provider_id FROM provider_credentials ORDER BY provider_id ASC",
      );
      return rows.map((row) => row.provider_id);
    },
  };
}
