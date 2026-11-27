/**
 * Auth storage: the single owner row, and one row per access token — never
 * the secret, only its digest. The first password lands as one INSERT whose
 * primary key decides the outcome, so two concurrent registrations cannot
 * both win. Every write is one statement.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { DbError } from "../../infrastructure/db/errors.ts";
import type { AuthDb } from "./db.ts";
import type { AccessTokenRecord } from "./types.ts";

/** The one and only owner row. */
const OWNER_ID = 1;

const TOKEN_COLUMNS =
  "id, name, token_last4, created_at, last_used_at, revoked_at";

interface TokenRow {
  id: string;
  name: string;
  token_last4: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toRecord(row: TokenRow): AccessTokenRecord {
  return {
    id: row.id,
    name: row.name,
    lastFour: row.token_last4,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export interface AuthRepository {
  /** The stored hash, or null before the owner has registered. */
  getPasswordHash(): Promise<string | null>;
  /**
   * Stores the first password. Resolves false when a password already
   * exists — including when a concurrent registration won the race.
   */
  setFirstPasswordHash(hash: string): Promise<boolean>;
  /** Replaces the stored hash; the owner row already exists. */
  updatePasswordHash(hash: string): Promise<void>;

  /**
   * The token a presented secret's digest belongs to, revoked ones
   * included — the caller judges whether it is still live.
   */
  findTokenByDigest(digest: string): Promise<AccessTokenRecord | null>;
  insertToken(token: AccessTokenRecord, digest: string): Promise<void>;
  /** Tokens that are not revoked, newest first. */
  listTokens(): Promise<AccessTokenRecord[]>;
  findToken(id: string): Promise<AccessTokenRecord | null>;
  /** Stamps the revocation; false when no token has that id. */
  revokeToken(id: string, revokedAt: string): Promise<boolean>;
  /** Records a use. One UPDATE that is never read back on the request path. */
  touchToken(id: string, lastUsedAt: string): Promise<void>;
}

export function createAuthRepository(deps: {
  db: AuthDb;
  clock: Clock;
}): AuthRepository {
  const { db, clock } = deps;
  return {
    async getPasswordHash() {
      const handle = await db.open();
      const rows = await handle.query<{ password_hash: string }>(
        "SELECT password_hash FROM owner WHERE id = ?",
        [OWNER_ID],
      );
      return rows[0]?.password_hash ?? null;
    },

    async setFirstPasswordHash(hash) {
      const handle = await db.open();
      const updatedAt = new Date(clock()).toISOString();
      try {
        await handle.run(
          "INSERT INTO owner (id, password_hash, updated_at) VALUES (?, ?, ?)",
          [OWNER_ID, hash, updatedAt],
        );
        return true;
      } catch (error) {
        // The primary key is the arbiter, not a read that could go stale
        // between two requests.
        if (error instanceof DbError && error.code === "unique-violation") {
          return false;
        }
        throw error;
      }
    },

    async updatePasswordHash(hash) {
      const handle = await db.open();
      await handle.run(
        "UPDATE owner SET password_hash = ?, updated_at = ? WHERE id = ?",
        [hash, new Date(clock()).toISOString(), OWNER_ID],
      );
    },

    async findTokenByDigest(digest) {
      const handle = await db.open();
      const rows = await handle.query<TokenRow>(
        `SELECT ${TOKEN_COLUMNS} FROM access_tokens WHERE token_digest = ?`,
        [digest],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async insertToken(token, digest) {
      const handle = await db.open();
      await handle.run(
        `INSERT INTO access_tokens (${TOKEN_COLUMNS}, token_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          token.id,
          token.name,
          token.lastFour,
          token.createdAt,
          token.lastUsedAt,
          token.revokedAt,
          digest,
        ],
      );
    },

    async listTokens() {
      const handle = await db.open();
      const rows = await handle.query<TokenRow>(
        `SELECT ${TOKEN_COLUMNS} FROM access_tokens
         WHERE revoked_at IS NULL
         ORDER BY created_at DESC, id DESC`,
      );
      return rows.map(toRecord);
    },

    async findToken(id) {
      const handle = await db.open();
      const rows = await handle.query<TokenRow>(
        `SELECT ${TOKEN_COLUMNS} FROM access_tokens WHERE id = ?`,
        [id],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async revokeToken(id, revokedAt) {
      const handle = await db.open();
      const result = await handle.run(
        "UPDATE access_tokens SET revoked_at = ? WHERE id = ?",
        [revokedAt, id],
      );
      return result.changes > 0;
    },

    async touchToken(id, lastUsedAt) {
      const handle = await db.open();
      await handle.run(
        "UPDATE access_tokens SET last_used_at = ? WHERE id = ?",
        [lastUsedAt, id],
      );
    },
  };
}
