/**
 * Auth storage: the single owner row. The first password lands as one
 * INSERT whose primary key decides the outcome, so two concurrent
 * registrations cannot both win.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { DbError } from "../../infrastructure/db/errors.ts";
import type { AuthDb } from "./db.ts";

/** The one and only owner row. */
const OWNER_ID = 1;

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
  };
}
