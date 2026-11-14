/**
 * Settings repository against a real sqlite database in a temporary
 * directory: settings key-value roundtrip, credential rows, and the
 * all-or-nothing `apply` (an injected failure rolls the whole change set
 * back), plus the database's lazy open + close lifecycle underneath.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import {
  createSettingsDb,
  type SettingsDb,
} from "../../src/domains/settings/db.ts";
import {
  createSettingsRepository,
  type SettingsRepository,
} from "../../src/domains/settings/repository.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-settings-repository-"));
const fixedNow = () => Date.parse("2026-11-14T08:00:00.000Z");

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// One isolated database per case: a fresh subdirectory per call. The
// database opens and migrates lazily, exactly as in the app.
let caseCounter = 0;

async function openSettings(): Promise<{
  db: SettingsDb;
  repository: SettingsRepository;
}> {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const db = createSettingsDb({ config });
  return { db, repository: createSettingsRepository({ db, clock: fixedNow }) };
}

describe("settings repository", () => {
  it("roundtrips settings values: set, overwrite, read, delete, missing is null", async () => {
    const { db, repository } = await openSettings();
    try {
      expect(await repository.get("ai.model")).toBeNull();
      await repository.apply({
        setSettings: [{ key: "ai.model", value: "zai/glm-4.7" }],
      });
      expect(await repository.get("ai.model")).toBe("zai/glm-4.7");
      await repository.apply({
        setSettings: [{ key: "ai.model", value: "zai/glm-5" }],
      });
      expect(await repository.get("ai.model")).toBe("zai/glm-5");
      await repository.apply({ deleteSettings: ["ai.model"] });
      expect(await repository.get("ai.model")).toBeNull();
      // Deleting an absent key is harmless.
      await repository.apply({ deleteSettings: ["ai.model"] });
    } finally {
      await db.close();
    }
  });

  it("roundtrips credentials: upsert, raw JSON read, sorted ids, delete", async () => {
    const { db, repository } = await openSettings();
    try {
      const zai = JSON.stringify({ type: "api_key", key: "fake-zai-key" });
      const anthropic = JSON.stringify({
        type: "api_key",
        key: "fake-anthropic-key",
      });
      await repository.apply({
        setCredentials: [
          { providerId: "zai", credentialJson: zai },
          { providerId: "anthropic", credentialJson: anthropic },
        ],
      });
      expect(await repository.listCredentialIds()).toEqual([
        "anthropic",
        "zai",
      ]);
      expect(await repository.readCredential("zai")).toBe(zai);
      // Upsert replaces the stored JSON verbatim.
      const replaced = JSON.stringify({ type: "api_key", key: "fake-zai-2" });
      await repository.apply({
        setCredentials: [{ providerId: "zai", credentialJson: replaced }],
      });
      expect(await repository.readCredential("zai")).toBe(replaced);
      await repository.apply({ deleteCredentials: ["zai"] });
      expect(await repository.readCredential("zai")).toBeNull();
      expect(await repository.listCredentialIds()).toEqual(["anthropic"]);
    } finally {
      await db.close();
    }
  });

  it("apply is all-or-nothing: one failing statement rolls the whole change set back", async () => {
    const { db, repository } = await openSettings();
    try {
      // Inject a mid-transaction failure: drop the credentials table after
      // the schema has been applied, so the second statement of the change
      // set fails inside the transaction.
      const handle = await db.open();
      await handle.exec("DROP TABLE provider_credentials");
      await expect(
        repository.apply({
          setSettings: [{ key: "ai.model", value: "zai/glm-4.7" }],
          setCredentials: [
            { providerId: "zai", credentialJson: '{"type":"api_key"}' },
          ],
        }),
      ).rejects.toThrow();
      // The settings write that ran before the failure did not survive.
      expect(await repository.get("ai.model")).toBeNull();
    } finally {
      await db.close();
    }
  });

  it("a closed database stays closed instead of reopening", async () => {
    const { db, repository } = await openSettings();
    await repository.get("ai.model");
    await db.close();
    await expect(repository.get("ai.model")).rejects.toThrow(/closed/);
    // Closing again is harmless.
    await db.close();
  });
});
