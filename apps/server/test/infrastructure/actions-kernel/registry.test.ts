/**
 * The actions kernel: confirmation-window semantics (30 s auto-write, TTL
 * backstop, single-flight, idempotent commit, cancel rules, retention
 * pruning) — domain-agnostic, driven entirely by the injected clock.
 */

import { describe, expect, it } from "vitest";
import {
  ActionStateError,
  createActionRegistry,
} from "../../../src/infrastructure/actions-kernel/registry.ts";

interface Probe {
  readonly value: string;
}

function makeRegistry(
  overrides: {
    now?: () => number;
    autoWriteDelayMs?: number;
    ttlMs?: number;
    retentionMs?: number;
  } = {},
) {
  let currentMs = 1_000_000;
  const now = overrides.now ?? (() => currentMs);
  const registry = createActionRegistry<Probe, string>({
    now,
    ...overrides,
  });
  return {
    registry,
    now,
    advance(ms: number) {
      currentMs += ms;
    },
    time: () => currentMs,
  };
}

const EXECUTE_OK = async (probe: Probe) => `done:${probe.value}`;

describe("createActionRegistry", () => {
  it("auto-writes only inside the window: due after the delay, gone after the TTL", () => {
    const { registry, advance } = makeRegistry();
    registry.add("a", { value: "a" });
    advance(29_999);
    expect(registry.dueForAutoWrite()).toEqual([]);
    advance(1);
    expect(registry.dueForAutoWrite()).toEqual(["a"]);
    advance(10 * 60_000 - 30_000); // reach the TTL
    expect(registry.dueForAutoWrite()).toEqual([]);
  });

  it("commit is single-flight: concurrent commits share one execution", async () => {
    const { registry } = makeRegistry();
    registry.add("a", { value: "a" });
    let executions = 0;
    const execute = async (probe: Probe) => {
      executions += 1;
      return `done:${probe.value}`;
    };
    const [first, second] = await Promise.all([
      registry.commit("a", execute),
      registry.commit("a", execute),
    ]);
    expect(executions).toBe(1);
    expect(first).toBe("done:a");
    expect(second).toBe("done:a");
  });

  it("commit is idempotent forever after success", async () => {
    const { registry } = makeRegistry();
    registry.add("a", { value: "a" });
    expect(await registry.commit("a", EXECUTE_OK)).toBe("done:a");
    expect(await registry.commit("a", EXECUTE_OK)).toBe("done:a");
  });

  it("a failing execution leaves the record pending for sweeper retries", async () => {
    const { registry } = makeRegistry();
    registry.add("a", { value: "a" });
    await expect(
      registry.commit("a", async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(registry.get("a")?.status).toBe("pending");
    expect(await registry.commit("a", EXECUTE_OK)).toBe("done:a");
  });

  it("commit after the TTL reports 410 gone", async () => {
    const { registry, advance } = makeRegistry();
    registry.add("a", { value: "a" });
    advance(10 * 60_000 + 1);
    const error = (await registry
      .commit("a", EXECUTE_OK)
      .catch((thrown: unknown) => thrown)) as ActionStateError;
    expect(error).toBeInstanceOf(ActionStateError);
    expect(error.code).toBe("PROPOSAL_EXPIRED");
    expect(error.getStatus()).toBe(410);
  });

  it("cancel works while pending and is rejected after commit", async () => {
    const { registry } = makeRegistry();
    registry.add("a", { value: "a" });
    expect(await registry.cancel("a")).toEqual({
      id: "a",
      status: "cancelled",
    });
    await expect(registry.commit("a", EXECUTE_OK)).rejects.toMatchObject({
      code: "PROPOSAL_CANCELLED",
      status: 409,
    });
    registry.add("b", { value: "b" });
    await registry.commit("b", EXECUTE_OK);
    await expect(registry.cancel("b")).rejects.toMatchObject({
      code: "PROPOSAL_COMMITTED",
      status: 409,
    });
  });

  it("sweep expires past-TTL records and prunes after retention", () => {
    const { registry, advance } = makeRegistry();
    registry.add("a", { value: "a" });
    advance(10 * 60_000 + 1);
    registry.sweep();
    expect(registry.get("a")?.status).toBe("expired");
    advance(60 * 60_000);
    registry.sweep();
    expect(registry.get("a")).toBeUndefined();
  });

  it("unknown ids report 404", async () => {
    const { registry } = makeRegistry();
    await expect(registry.commit("ghost", EXECUTE_OK)).rejects.toMatchObject({
      code: "PROPOSAL_NOT_FOUND",
      status: 404,
    });
  });
});
