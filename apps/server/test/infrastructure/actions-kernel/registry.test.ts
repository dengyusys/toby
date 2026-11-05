/**
 * The actions kernel: confirmation-window semantics (30 s auto-write, TTL
 * backstop, single-flight, idempotent commit, cancel rules, retention
 * pruning) plus the immediate tier (execute-then-journal, born-confirmed
 * records, revert window) — domain-agnostic, driven entirely by the
 * injected clock.
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
    revertWindowMs?: number;
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
    expect(error.statusCode).toBe(410);
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
      statusCode: 409,
    });
    registry.add("b", { value: "b" });
    await registry.commit("b", EXECUTE_OK);
    await expect(registry.cancel("b")).rejects.toMatchObject({
      code: "PROPOSAL_COMMITTED",
      statusCode: 409,
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
      statusCode: 404,
    });
  });
});

describe("createActionRegistry · immediate tier", () => {
  it("execute runs at once and journals a born-confirmed record with a revert window", async () => {
    const { registry, time } = makeRegistry();
    expect(await registry.execute("a", { value: "a" }, EXECUTE_OK)).toBe(
      "done:a",
    );
    const record = registry.get("a");
    expect(record?.status).toBe("committed");
    expect(record?.result).toBe("done:a");
    expect(record?.revertUntilMs).toBe(time() + 10 * 60_000);
    // Born confirmed: never pending, so never auto-written by the sweeper.
    expect(registry.dueForAutoWrite()).toEqual([]);
  });

  it("a failing execution leaves no record behind", async () => {
    const { registry } = makeRegistry();
    await expect(
      registry.execute("a", { value: "a" }, async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(registry.get("a")).toBeUndefined();
  });

  it("revert applies the before-snapshot inside the window and flips the record", async () => {
    const { registry } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    const seen: { payload: Probe; result: string }[] = [];
    const outcome = await registry.revert("a", async (payload, result) => {
      seen.push({ payload, result });
    });
    expect(outcome).toEqual({
      id: "a",
      status: "reverted",
      revertedAtMs: expect.any(Number),
    });
    expect(seen).toEqual([{ payload: { value: "a" }, result: "done:a" }]);
    expect(registry.get("a")?.status).toBe("reverted");
  });

  it("revert is idempotent forever: a settled revert echoes its outcome", async () => {
    const { registry } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    let applications = 0;
    const applyBefore = async () => {
      applications += 1;
    };
    const first = await registry.revert("a", applyBefore);
    const second = await registry.revert("a", applyBefore);
    expect(applications).toBe(1);
    expect(second).toEqual(first);
  });

  it("revert is single-flight: concurrent reverts share one transaction", async () => {
    const { registry } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    let applications = 0;
    const applyBefore = async () => {
      applications += 1;
    };
    const [first, second] = await Promise.all([
      registry.revert("a", applyBefore),
      registry.revert("a", applyBefore),
    ]);
    expect(applications).toBe(1);
    expect(second).toEqual(first);
  });

  it("a failing compensating transaction leaves the record committed for retry", async () => {
    const { registry } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    await expect(
      registry.revert("a", async () => {
        throw new Error("conflict");
      }),
    ).rejects.toThrow("conflict");
    expect(registry.get("a")?.status).toBe("committed");
    expect(await registry.revert("a", async () => undefined)).toMatchObject({
      status: "reverted",
    });
  });

  it("revert past the window reports 410 gone", async () => {
    const { registry, advance } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    advance(10 * 60_000 + 1);
    const error = (await registry
      .revert("a", async () => undefined)
      .catch((thrown: unknown) => thrown)) as ActionStateError;
    expect(error).toBeInstanceOf(ActionStateError);
    expect(error.code).toBe("PROPOSAL_EXPIRED");
    expect(error.statusCode).toBe(410);
    // The record survives as a plain receipt until retention prunes it.
    expect(registry.get("a")?.status).toBe("committed");
  });

  it("the window closes at exactly revertUntilMs: 1 ms before is fine", async () => {
    const { registry, advance } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    advance(10 * 60_000 - 1);
    await expect(
      registry.revert("a", async () => undefined),
    ).resolves.toMatchObject({ status: "reverted" });

    await registry.execute("b", { value: "b" }, EXECUTE_OK);
    advance(10 * 60_000);
    await expect(
      registry.revert("b", async () => undefined),
    ).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED", statusCode: 410 });
  });

  it("a reverted record settles commit and cancel attempts", async () => {
    const { registry } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    await registry.revert("a", async () => undefined);
    // Commit stays idempotent forever: it echoes the stored (pre-revert)
    // result instead of re-executing anything.
    expect(await registry.commit("a", EXECUTE_OK)).toBe("done:a");
    // Cancel answers the same "too late" 409 as a committed record.
    await expect(registry.cancel("a")).rejects.toMatchObject({
      code: "PROPOSAL_COMMITTED",
      statusCode: 409,
    });
  });

  it("gated records are not revertible: 409 both while pending and after commit", async () => {
    const { registry } = makeRegistry();
    registry.add("a", { value: "a" });
    await expect(
      registry.revert("a", async () => undefined),
    ).rejects.toMatchObject({
      code: "PROPOSAL_NOT_REVERTIBLE",
      statusCode: 409,
    });
    await registry.commit("a", EXECUTE_OK);
    await expect(
      registry.revert("a", async () => undefined),
    ).rejects.toMatchObject({
      code: "PROPOSAL_NOT_REVERTIBLE",
      statusCode: 409,
    });
  });

  it("sweep prunes reverted records after retention past the window", async () => {
    const { registry, advance } = makeRegistry();
    await registry.execute("a", { value: "a" }, EXECUTE_OK);
    await registry.revert("a", async () => undefined);
    advance(10 * 60_000 + 60 * 60_000);
    registry.sweep();
    expect(registry.get("a")).toBeUndefined();
  });

  it("revert of an unknown id reports 404", async () => {
    const { registry } = makeRegistry();
    await expect(
      registry.revert("ghost", async () => undefined),
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND", statusCode: 404 });
  });
});
