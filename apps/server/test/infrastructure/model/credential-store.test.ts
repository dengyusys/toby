/**
 * The pi-ai CredentialStore adapter over a fake persistence: reads (miss,
 * invalid JSON), modify upsert + delete, a list that leaks no key
 * material, and the per-provider serialization pi-ai's contract requires
 * (two concurrent modifies cannot interleave their halves).
 */

import { describe, expect, it } from "vitest";
import type { Credential } from "@earendil-works/pi-ai";
import {
  createSettingsCredentialStore,
  type CredentialPersistence,
} from "../../../src/infrastructure/model/credential-store.ts";

/** In-memory persistence shaped like the settings repository's slice. */
function fakePersistence() {
  const rows = new Map<string, string>();
  const persistence: CredentialPersistence = {
    async readCredential(providerId) {
      return rows.get(providerId) ?? null;
    },
    async listCredentialIds() {
      return [...rows.keys()].sort();
    },
    async apply(changes) {
      for (const id of changes.deleteCredentials ?? []) {
        rows.delete(id);
      }
      for (const { providerId, credentialJson } of changes.setCredentials ??
        []) {
        rows.set(providerId, credentialJson);
      }
    },
  };
  return { rows, persistence };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("settings credential store", () => {
  it("a read miss resolves undefined", async () => {
    const { persistence } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    expect(await store.read("zai")).toBeUndefined();
  });

  it("modify upserts: fn sees the current value, the write lands, read returns it", async () => {
    const { persistence, rows } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });

    const seenCurrent: unknown[] = [];
    const result = await store.modify("zai", async (current) => {
      seenCurrent.push(current);
      return { type: "api_key", key: "fake-first-key" };
    });
    expect(seenCurrent).toEqual([undefined]);
    expect(result).toEqual({ type: "api_key", key: "fake-first-key" });
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-first-key",
    });

    // A second modify sees the stored credential and replaces it.
    const replaced = await store.modify("zai", async (current) => {
      seenCurrent.push(current);
      return { type: "api_key", key: "fake-second-key" };
    });
    expect(replaced).toEqual({ type: "api_key", key: "fake-second-key" });
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-second-key",
    });
    expect(rows.get("zai")).toBe(
      JSON.stringify({ type: "api_key", key: "fake-second-key" }),
    );
  });

  it("modify returning undefined leaves the entry unchanged and answers it", async () => {
    const { persistence } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    await store.modify("zai", async () => ({
      type: "api_key",
      key: "fake-keep-key",
    }));
    const result = await store.modify("zai", async () => undefined);
    expect(result).toEqual({ type: "api_key", key: "fake-keep-key" });
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-keep-key",
    });
  });

  it("invalid stored JSON reads as absent but the row is not deleted", async () => {
    const { persistence, rows } = fakePersistence();
    rows.set("zai", "not json at all");
    const store = createSettingsCredentialStore({ persistence });
    expect(await store.read("zai")).toBeUndefined();
    expect(rows.has("zai")).toBe(true);
    // A later modify overwrites the broken row instead of tripping on it.
    await store.modify("zai", async () => ({
      type: "api_key",
      key: "fake-fixed-key",
    }));
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-fixed-key",
    });
  });

  it("delete removes the row; deleting an absent id is harmless", async () => {
    const { persistence, rows } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    await store.modify("zai", async () => ({
      type: "api_key",
      key: "fake-gone-key",
    }));
    await store.delete("zai");
    expect(rows.has("zai")).toBe(false);
    expect(await store.read("zai")).toBeUndefined();
    await store.delete("zai");
  });

  it("list carries ids and type only — no key material ever", async () => {
    const { persistence } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    await store.modify("zai", async () => ({
      type: "api_key",
      key: "fake-zai-list-key",
    }));
    await store.modify("anthropic", async () => ({
      type: "api_key",
      key: "fake-anthropic-list-key",
    }));
    const listed = await store.list();
    expect(listed).toEqual([
      { providerId: "anthropic", type: "api_key" },
      { providerId: "zai", type: "api_key" },
    ]);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain("fake-zai-list-key");
    expect(serialized).not.toContain("fake-anthropic-list-key");
  });

  it("concurrent modifies on one provider serialize: no interleaved halves", async () => {
    const { persistence } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    const order: string[] = [];
    const firstWriteGate = deferred();

    const first: Promise<Credential | undefined> = store.modify(
      "zai",
      async (current) => {
        order.push("first-read");
        expect(current).toBeUndefined();
        await firstWriteGate.promise;
        order.push("first-write");
        return { type: "api_key", key: "fake-serial-first" };
      },
    );
    const second: Promise<Credential | undefined> = store.modify(
      "zai",
      async (current) => {
        // The second modify's fn must not run before the first one wrote:
        // it sees the first credential, proving no interleave happened.
        order.push("second-read");
        expect(current).toEqual({ type: "api_key", key: "fake-serial-first" });
        return { type: "api_key", key: "fake-serial-second" };
      },
    );

    // Give the event loop a chance to start `second` while `first` waits
    // (a bounded microtask drain — the chain starts within a few ticks).
    for (let i = 0; i < 10 && order.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(order).toEqual(["first-read"]);

    firstWriteGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ type: "api_key", key: "fake-serial-first" });
    expect(secondResult).toEqual({
      type: "api_key",
      key: "fake-serial-second",
    });
    expect(order).toEqual(["first-read", "first-write", "second-read"]);
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-serial-second",
    });
  });

  it("one modify's rejection does not poison the chain for the next", async () => {
    const { persistence } = fakePersistence();
    const store = createSettingsCredentialStore({ persistence });
    await expect(
      store.modify("zai", async () => {
        throw new Error("fake storage failure");
      }),
    ).rejects.toThrow("fake storage failure");
    const result = await store.modify("zai", async () => ({
      type: "api_key",
      key: "fake-after-failure",
    }));
    expect(result).toEqual({ type: "api_key", key: "fake-after-failure" });
    expect(await store.read("zai")).toEqual({
      type: "api_key",
      key: "fake-after-failure",
    });
  });
});
