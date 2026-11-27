/**
 * Auth repository against a real sqlite database in a temporary directory:
 * no password until the first one lands, exactly one ever, and it survives a
 * close and reopen; access tokens roundtrip by digest; plus the database's
 * lazy open + close lifecycle underneath.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import type { TobyConfig } from "../../src/infrastructure/config/config.ts";
import { createAuthDb, type AuthDb } from "../../src/domains/auth/db.ts";
import {
  createAuthRepository,
  type AuthRepository,
} from "../../src/domains/auth/repository.ts";
import type { AccessTokenRecord } from "../../src/domains/auth/types.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-auth-repository-"));
const fixedNow = () => Date.parse("2026-11-27T08:00:00.000Z");

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// One isolated database per case: a fresh subdirectory per call. The
// database opens and applies its schema lazily, exactly as in the app.
let caseCounter = 0;

async function openAuth(): Promise<{
  config: TobyConfig;
  db: AuthDb;
  repository: AuthRepository;
}> {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const db = createAuthDb({ config });
  return {
    config,
    db,
    repository: createAuthRepository({ db, clock: fixedNow }),
  };
}

describe("auth repository", () => {
  it("holds no password until the first one lands, then exactly one", async () => {
    const { db, repository } = await openAuth();
    try {
      expect(await repository.getPasswordHash()).toBeNull();
      expect(await repository.setFirstPasswordHash("scrypt$first")).toBe(true);
      expect(await repository.getPasswordHash()).toBe("scrypt$first");
      // A second password never overwrites the first.
      expect(await repository.setFirstPasswordHash("scrypt$second")).toBe(
        false,
      );
      expect(await repository.getPasswordHash()).toBe("scrypt$first");
    } finally {
      await db.close();
    }
  });

  it("the password can be replaced, and the replacement survives a reopen", async () => {
    const { config, db, repository } = await openAuth();
    await repository.setFirstPasswordHash("scrypt$first");
    await repository.updatePasswordHash("scrypt$second");
    expect(await repository.getPasswordHash()).toBe("scrypt$second");
    await db.close();
    const reopened = createAuthDb({ config });
    try {
      expect(
        await createAuthRepository({
          db: reopened,
          clock: fixedNow,
        }).getPasswordHash(),
      ).toBe("scrypt$second");
    } finally {
      await reopened.close();
    }
  });

  it("tokens roundtrip by digest; the list holds the live ones, newest first; revocation sticks", async () => {
    const { db, repository } = await openAuth();
    const older: AccessTokenRecord = {
      id: "token-1",
      name: "script",
      lastFour: "abcd",
      createdAt: "2026-11-27T08:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    };
    const newer: AccessTokenRecord = {
      id: "token-2",
      name: "page",
      lastFour: "wxyz",
      createdAt: "2026-11-27T08:05:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    };
    try {
      await repository.insertToken(older, "digest-older");
      await repository.insertToken(newer, "digest-newer");

      expect(await repository.findTokenByDigest("digest-older")).toEqual(older);
      expect(await repository.findTokenByDigest("no-such-digest")).toBeNull();
      expect(await repository.listTokens()).toEqual([newer, older]);

      await repository.touchToken("token-1", "2026-11-27T09:00:00.000Z");
      expect((await repository.findToken("token-1"))?.lastUsedAt).toBe(
        "2026-11-27T09:00:00.000Z",
      );

      expect(
        await repository.revokeToken("token-1", "2026-11-27T10:00:00.000Z"),
      ).toBe(true);
      expect(
        await repository.revokeToken("no-such-id", "2026-11-27T10:00:00.000Z"),
      ).toBe(false);
      // A revoked token is still found by id — so revoking twice can answer
      // "already revoked" — but it has left the list.
      expect((await repository.findToken("token-1"))?.revokedAt).toBe(
        "2026-11-27T10:00:00.000Z",
      );
      expect(await repository.listTokens()).toEqual([newer]);
    } finally {
      await db.close();
    }
  });

  it("the password survives a close and reopen", async () => {
    // A process restart ends every session but never the password itself.
    const { config, db, repository } = await openAuth();
    await repository.setFirstPasswordHash("scrypt$first");
    await db.close();
    const reopened = createAuthDb({ config });
    try {
      expect(
        await createAuthRepository({
          db: reopened,
          clock: fixedNow,
        }).getPasswordHash(),
      ).toBe("scrypt$first");
    } finally {
      await reopened.close();
    }
  });

  it("a closed database stays closed instead of reopening", async () => {
    const { db, repository } = await openAuth();
    await repository.getPasswordHash();
    await db.close();
    await expect(repository.getPasswordHash()).rejects.toThrow(/closed/);
    // Closing again is harmless.
    await db.close();
  });
});
