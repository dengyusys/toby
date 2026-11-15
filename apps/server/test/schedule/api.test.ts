/**
 * Schedule domain HTTP contract, driven through fastify inject against
 * the fully assembled domain (real sqlite in a fresh temporary directory
 * per case, injected clock). Pins the public shapes: tracked items with
 * their vocabularies, the (itemId, date) natural key with idempotent
 * PUT, the inclusive range list, the cascade delete, saved views, and
 * every closed error code plus the default session guard.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { productionDomains } from "../../src/composition-root.ts";
import { hashPassword } from "../../src/domains/auth/password.ts";
import { createScheduleDomain } from "../../src/domains/schedule/plugin.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-schedule-api-"));
const PASSWORD_HASH = hashPassword("correct horse battery staple");

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-15T08:00:00.000Z");
const UPDATED_AT = "2026-11-15T08:00:00.000Z";

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;

async function buildApp(
  domains: "schedule" | "production" = "schedule",
  env: Record<string, string> = {},
): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: {
      TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`),
      ...env,
    },
  });
  const mounts =
    domains === "production"
      ? productionDomains({ config, clock: () => nowMs })
      : [
          (instance: FastifyInstance) =>
            instance.register(
              createScheduleDomain({ config, clock: () => nowMs }).plugin,
            ),
        ];
  app = await createTestApp({ config, domains: mounts });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

async function createItem(overrides: Record<string, unknown> = {}) {
  const response = await inject("POST", "/api/schedule/items", {
    title: "吃饭",
    statuses: ["是", "否"],
    ...overrides,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    id: number;
    title: string;
    statuses: string[];
    entryCount: number;
  };
}

async function putEntry(
  itemId: number,
  date: string,
  status: string,
): Promise<{
  id: number;
  itemId: number;
  title: string;
  date: string;
  status: string;
  updatedAt: string;
  created: boolean;
}> {
  const response = await inject("PUT", "/api/schedule/entries", {
    itemId,
    date,
    status,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe("schedule api: items", () => {
  it("registers items, lists them in creation order, and preserves status order", async () => {
    const first = await createItem();
    expect(first).toEqual({
      id: first.id,
      title: "吃饭",
      statuses: ["是", "否"],
      entryCount: 0,
    });
    const second = await createItem({
      title: "锻炼",
      statuses: ["完成", "部分", "没做"],
    });
    expect(second.statuses).toEqual(["完成", "部分", "没做"]);

    const list = await inject("GET", "/api/schedule/items");
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      items: [first, second],
    });

    // entryCount spans ALL dates, not the queried window.
    await putEntry(first.id, "2026-11-14", "是");
    await putEntry(first.id, "2026-11-15", "否");
    const counted = await inject("GET", "/api/schedule/items");
    expect(counted.json().items[0].entryCount).toBe(2);
    expect(counted.json().items[1].entryCount).toBe(0);
  });

  it("a duplicate title answers 409 SCHEDULE_ITEM_DUPLICATE", async () => {
    await createItem();
    const response = await inject("POST", "/api/schedule/items", {
      title: "吃饭",
      statuses: ["甲", "乙"],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe("SCHEDULE_ITEM_DUPLICATE");
  });

  it("rejects bad vocabularies and titles with SCHEDULE_INVALID_ITEM", async () => {
    for (const body of [
      { title: "   ", statuses: ["是"] },
      { title: "吃饭", statuses: [] },
      { title: "吃饭", statuses: ["是", " 是"] },
      { title: "吃饭", statuses: ["是", 5] },
      { title: "吃饭", statuses: [] },
      { title: "x".repeat(121), statuses: ["是"] },
      { statuses: ["是"] }, // title missing
      { title: "吃饭" }, // statuses missing
    ]) {
      const response = await inject(
        "POST",
        "/api/schedule/items",
        body as Record<string, unknown>,
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("SCHEDULE_INVALID_ITEM");
    }
    // A non-object body is the route's call: BAD_REQUEST.
    const arrayBody = await inject("POST", "/api/schedule/items", [
      "吃饭",
    ] as unknown as Record<string, unknown>);
    expect(arrayBody.statusCode).toBe(400);
    expect(arrayBody.json().errorCode).toBe("BAD_REQUEST");
    // An unknown envelope key is the route's call: BAD_REQUEST.
    const unknown = await inject("POST", "/api/schedule/items", {
      title: "吃饭",
      statuses: ["是"],
      color: "red",
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().errorCode).toBe("BAD_REQUEST");
    // Zero writes happened.
    expect((await inject("GET", "/api/schedule/items")).json()).toEqual({
      items: [],
    });
  });

  it("patches title and/or statuses; unknown and malformed ids answer", async () => {
    const item = await createItem();

    const patched = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      title: " 三餐 ",
      statuses: ["完成", "部分", "没做"],
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({
      id: item.id,
      title: "三餐",
      statuses: ["完成", "部分", "没做"],
      entryCount: 0,
    });

    const titleOnly = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      title: "吃饭",
    });
    expect(titleOnly.json()).toEqual({
      id: item.id,
      title: "吃饭",
      statuses: ["完成", "部分", "没做"],
      entryCount: 0,
    });

    const missing = await inject("PATCH", "/api/schedule/items/999", {
      title: "锻炼",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("SCHEDULE_ITEM_NOT_FOUND");

    for (const id of ["0", "-1", "abc"]) {
      const response = await inject("PATCH", `/api/schedule/items/${id}`, {
        title: "锻炼",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("SCHEDULE_INVALID_ITEM");
    }

    const emptyPatch = await inject(
      "PATCH",
      `/api/schedule/items/${item.id}`,
      {},
    );
    expect(emptyPatch.statusCode).toBe(400);
    expect(emptyPatch.json().errorCode).toBe("SCHEDULE_INVALID_ITEM");
  });

  it("removing a status still in use is rejected; removing an unused one lands", async () => {
    const item = await createItem();
    await putEntry(item.id, "2026-11-15", "否");

    const inUse = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      statuses: ["是"],
    });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().errorCode).toBe("SCHEDULE_STATUS_IN_USE");

    // The vocabulary is untouched after the rejection.
    const unchanged = await inject("GET", "/api/schedule/items");
    expect(unchanged.json().items[0].statuses).toEqual(["是", "否"]);

    const widened = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      statuses: ["是", "否", "没吃"],
    });
    expect(widened.statusCode).toBe(200);
    // "否" is still on today's entry, so it stays; the unused "是" goes.
    const replaced = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      statuses: ["否", "没吃"],
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().statuses).toEqual(["否", "没吃"]);
  });
});

describe("schedule api: entries", () => {
  it("PUT is create-or-update on (itemId, date) and idempotent", async () => {
    const item = await createItem();

    const first = await putEntry(item.id, "2026-11-15", "是");
    expect(first).toEqual({
      id: first.id,
      itemId: item.id,
      title: "吃饭",
      date: "2026-11-15",
      status: "是",
      updatedAt: UPDATED_AT,
      created: true,
    });

    // The exact same payload twice: still exactly one row, latest status.
    const second = await putEntry(item.id, "2026-11-15", "是");
    expect(second).toEqual({ ...first, created: false });

    const changed = await putEntry(item.id, "2026-11-15", "否");
    expect(changed).toEqual({
      id: first.id,
      itemId: item.id,
      title: "吃饭",
      date: "2026-11-15",
      status: "否",
      updatedAt: UPDATED_AT,
      created: false,
    });

    const list = await inject(
      "GET",
      "/api/schedule?from=2026-11-15&to=2026-11-15",
    );
    expect(list.json().entries).toEqual([
      {
        id: first.id,
        itemId: item.id,
        title: "吃饭",
        date: "2026-11-15",
        status: "否",
        updatedAt: UPDATED_AT,
      },
    ]);
  });

  it("the same item on different dates is different entries", async () => {
    const item = await createItem();
    const monday = await putEntry(item.id, "2026-11-09", "是");
    const tuesday = await putEntry(item.id, "2026-11-10", "否");
    expect(tuesday.id).not.toBe(monday.id);
    const list = await inject(
      "GET",
      "/api/schedule?from=2026-11-09&to=2026-11-10",
    );
    expect(
      list.json().entries.map((entry: { date: string }) => entry.date),
    ).toEqual(["2026-11-09", "2026-11-10"]);
  });

  it("rejects unknown items, stale statuses and malformed bodies", async () => {
    const item = await createItem();

    const unknownItem = await inject("PUT", "/api/schedule/entries", {
      itemId: 999,
      date: "2026-11-15",
      status: "是",
    });
    expect(unknownItem.statusCode).toBe(404);
    expect(unknownItem.json().errorCode).toBe("SCHEDULE_ITEM_NOT_FOUND");

    const staleStatus = await inject("PUT", "/api/schedule/entries", {
      itemId: item.id,
      date: "2026-11-15",
      status: "没做",
    });
    expect(staleStatus.statusCode).toBe(400);
    expect(staleStatus.json().errorCode).toBe("SCHEDULE_INVALID_STATUS");

    for (const body of [
      { itemId: item.id, date: "2026-02-30", status: "是" },
      { itemId: item.id, date: "11-15", status: "是" },
      { itemId: item.id, date: "2026-11-15", status: "" },
      { itemId: item.id, date: "2026-11-15", status: 5 },
      { itemId: "abc", date: "2026-11-15", status: "是" },
      { date: "2026-11-15", status: "是" }, // itemId missing
    ]) {
      const response = await inject("PUT", "/api/schedule/entries", body);
      expect(response.statusCode).toBe(400);
      expect([
        "SCHEDULE_INVALID_ITEM",
        "SCHEDULE_INVALID_DATE",
        "SCHEDULE_INVALID_STATUS",
      ]).toContain(response.json().errorCode);
    }

    // An unknown envelope key is BAD_REQUEST.
    const extra = await inject("PUT", "/api/schedule/entries", {
      itemId: item.id,
      date: "2026-11-15",
      status: "是",
      note: "extra",
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().errorCode).toBe("BAD_REQUEST");

    expect(
      (
        await inject("GET", "/api/schedule?from=2026-11-01&to=2026-11-30")
      ).json().entries,
    ).toEqual([]);
  });

  it("deletes one entry; unknown and malformed ids answer not-found", async () => {
    const item = await createItem();
    const entry = await putEntry(item.id, "2026-11-15", "是");

    const deleted = await inject("DELETE", `/api/schedule/entries/${entry.id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({
      id: entry.id,
      action: "deleted",
      deletedAt: UPDATED_AT,
    });

    const list = await inject(
      "GET",
      "/api/schedule?from=2026-11-15&to=2026-11-15",
    );
    expect(list.json().entries).toEqual([]);

    const missing = await inject("DELETE", `/api/schedule/entries/${entry.id}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("SCHEDULE_ENTRY_NOT_FOUND");

    for (const id of ["abc"]) {
      const response = await inject("DELETE", `/api/schedule/entries/${id}`);
      expect(response.statusCode).toBe(404);
      expect(response.json().errorCode).toBe("SCHEDULE_ENTRY_NOT_FOUND");
    }
  });

  it("a status removed from the vocabulary stops being writable at once", async () => {
    const item = await createItem();
    const patched = await inject("PATCH", `/api/schedule/items/${item.id}`, {
      statuses: ["是"],
    });
    expect(patched.statusCode).toBe(200);
    const stale = await inject("PUT", "/api/schedule/entries", {
      itemId: item.id,
      date: "2026-11-15",
      status: "否",
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().errorCode).toBe("SCHEDULE_INVALID_STATUS");
  });
});

describe("schedule api: range list", () => {
  it("the window is inclusive on both ends and joins titles", async () => {
    const item = await createItem();
    const other = await createItem({
      title: "锻炼",
      statuses: ["完成", "没做"],
    });
    await putEntry(item.id, "2026-11-14", "是");
    await putEntry(item.id, "2026-11-15", "否");
    await putEntry(other.id, "2026-11-15", "完成");
    await putEntry(item.id, "2026-11-16", "是");

    const list = await inject(
      "GET",
      "/api/schedule?from=2026-11-15&to=2026-11-15",
    );
    expect(list.json().from).toBe("2026-11-15");
    expect(list.json().to).toBe("2026-11-15");
    expect(
      list.json().entries.map((entry: { title: string }) => entry.title),
    ).toEqual(["吃饭", "锻炼"]);

    const wide = await inject(
      "GET",
      "/api/schedule?from=2026-11-14&to=2026-11-16",
    );
    expect(wide.json().entries).toHaveLength(4);
    expect(
      wide.json().entries.map((entry: { date: string }) => entry.date),
    ).toEqual(["2026-11-14", "2026-11-15", "2026-11-15", "2026-11-16"]);
  });

  it("the range parameters are validated", async () => {
    for (const url of [
      "/api/schedule",
      "/api/schedule?from=2026-11-01",
      "/api/schedule?to=2026-11-30",
      "/api/schedule?from=2026-02-30&to=2026-11-30",
      "/api/schedule?from=today&to=2026-11-30",
      "/api/schedule?from=2026-11-30&to=2026-11-01",
      "/api/schedule?from=2026-11-01&from=2026-11-02&to=2026-11-30",
      // The window may span at most 366 inclusive days.
      "/api/schedule?from=2026-01-01&to=2027-01-02",
      // A leap year makes 2024-01-01..2025-01-01 a 366-day difference.
      "/api/schedule?from=2024-01-01&to=2025-01-01",
    ]) {
      const response = await inject("GET", url);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("SCHEDULE_INVALID_DATE");
    }

    // Exactly 366 days is the cap and still answers.
    const capped = await inject(
      "GET",
      "/api/schedule?from=2026-01-01&to=2027-01-01",
    );
    expect(capped.statusCode).toBe(200);
    expect(capped.json()).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
      entries: [],
    });
  });

  it("an empty window answers an empty list, not an error", async () => {
    const response = await inject(
      "GET",
      "/api/schedule?from=2026-01-01&to=2026-01-02",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      from: "2026-01-01",
      to: "2026-01-02",
      entries: [],
    });
  });
});

describe("schedule api: cascade delete", () => {
  it("deletes an item and its entries in one write, reporting the count", async () => {
    const item = await createItem();
    await putEntry(item.id, "2026-11-14", "是");
    await putEntry(item.id, "2026-11-15", "否");

    const deleted = await inject("DELETE", `/api/schedule/items/${item.id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deletedEntries: 2 });

    expect((await inject("GET", "/api/schedule/items")).json()).toEqual({
      items: [],
    });
    expect(
      (
        await inject("GET", "/api/schedule?from=2026-01-01&to=2026-12-31")
      ).json().entries,
    ).toEqual([]);

    const missing = await inject("DELETE", `/api/schedule/items/${item.id}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("SCHEDULE_ITEM_NOT_FOUND");
  });

  it("the deleted item's id leaves every saved view's itemIds in the same write", async () => {
    const first = await createItem({ title: "吃饭" });
    const second = await createItem({ title: "锻炼" });
    await inject("POST", "/api/schedule/views", {
      name: "两只",
      type: "list",
      config: {
        itemIds: [String(first.id), String(second.id)],
        sort: "date",
        group: "item",
      },
    });
    await inject("POST", "/api/schedule/views", {
      name: "一只",
      type: "list",
      config: {
        itemIds: [String(first.id)],
        statuses: ["是"],
        sort: "title",
        group: "status",
      },
    });

    const deleted = await inject("DELETE", `/api/schedule/items/${first.id}`);
    expect(deleted.json()).toEqual({ deletedEntries: 0 });

    const views = (await inject("GET", "/api/schedule/views")).json().views;
    expect(views).toEqual([
      {
        id: views[0].id,
        name: "两只",
        type: "list",
        config: { itemIds: [String(second.id)], sort: "date", group: "item" },
      },
      {
        id: views[1].id,
        name: "一只",
        type: "list",
        // The last reference went away: itemIds is gone (no filter).
        config: { statuses: ["是"], sort: "title", group: "status" },
      },
    ]);
  });

  it("an item without entries cascades zero", async () => {
    const item = await createItem();
    const deleted = await inject("DELETE", `/api/schedule/items/${item.id}`);
    expect(deleted.json()).toEqual({ deletedEntries: 0 });
  });
});

describe("schedule api: saved views", () => {
  const viewBody = {
    name: "本周",
    type: "calendar",
    config: { sort: "date", group: "none" },
  };

  it("creates, lists, patches and deletes views", async () => {
    const created = await inject("POST", "/api/schedule/views", viewBody);
    expect(created.statusCode).toBe(200);
    const view = created.json();
    expect(view).toEqual({
      id: view.id,
      name: "本周",
      type: "calendar",
      config: { sort: "date", group: "none" },
    });

    const second = await inject("POST", "/api/schedule/views", {
      name: "吃饭",
      type: "list",
      config: {
        itemIds: ["1", "2"],
        statuses: ["是"],
        sort: "title",
        group: "item",
      },
    });
    expect(second.statusCode).toBe(200);

    const list = await inject("GET", "/api/schedule/views");
    expect(list.json().views.map((row: { name: string }) => row.name)).toEqual([
      "本周",
      "吃饭",
    ]);

    const patched = await inject("PATCH", `/api/schedule/views/${view.id}`, {
      name: "改名",
      config: { sort: "title", group: "status", statuses: ["是", "否"] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({
      id: view.id,
      name: "改名",
      type: "calendar",
      config: { sort: "title", group: "status", statuses: ["是", "否"] },
    });

    const nameOnly = await inject("PATCH", `/api/schedule/views/${view.id}`, {
      type: "list",
    });
    expect(nameOnly.statusCode).toBe(200);
    expect(nameOnly.json()).toEqual({
      id: view.id,
      name: "改名",
      type: "list",
      config: { sort: "title", group: "status", statuses: ["是", "否"] },
    });

    const deleted = await inject("DELETE", `/api/schedule/views/${view.id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({
      id: view.id,
      action: "deleted",
      deletedAt: UPDATED_AT,
    });

    const missing = await inject("DELETE", `/api/schedule/views/${view.id}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("SCHEDULE_VIEW_NOT_FOUND");
  });

  it("config is a closed shape: unknown fields and bad values answer SCHEDULE_INVALID_VIEW_CONFIG", async () => {
    for (const config of [
      { sort: "date", group: "none", color: "red" }, // unknown field
      { sort: "date" }, // group required
      { group: "none" }, // sort required
      { sort: "size", group: "none" },
      { sort: "date", group: "tag" },
      { sort: "date", group: "none", itemIds: ["0"] },
      { sort: "date", group: "none", itemIds: [-3] },
      { sort: "date", group: "none", statuses: [" "] },
    ]) {
      const response = await inject("POST", "/api/schedule/views", {
        name: "本周",
        type: "calendar",
        config,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("SCHEDULE_INVALID_VIEW_CONFIG");
    }

    const patchBad = await inject("PATCH", "/api/schedule/views/1", {
      config: { sort: "date", group: "none", extra: true },
    });
    expect(patchBad.statusCode).toBe(400);
    expect(patchBad.json().errorCode).toBe("SCHEDULE_INVALID_VIEW_CONFIG");

    const patchEmpty = await inject("PATCH", "/api/schedule/views/1", {});
    expect(patchEmpty.statusCode).toBe(400);
    expect(patchEmpty.json().errorCode).toBe("SCHEDULE_INVALID_VIEW_CONFIG");

    const patchMissing = await inject("PATCH", "/api/schedule/views/999", {
      name: "x",
    });
    expect(patchMissing.statusCode).toBe(404);
    expect(patchMissing.json().errorCode).toBe("SCHEDULE_VIEW_NOT_FOUND");

    expect((await inject("GET", "/api/schedule/views")).json()).toEqual({
      views: [],
    });
  });

  it("view bodies validate name and type", async () => {
    for (const body of [
      { ...viewBody, name: "  " },
      { ...viewBody, type: "table" },
      { ...viewBody, name: "x".repeat(61) },
      { type: "calendar", config: viewBody.config }, // name missing
      { name: "本周", config: viewBody.config }, // type missing
      { name: "本周", type: "calendar" }, // config missing
    ]) {
      const response = await inject("POST", "/api/schedule/views", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("SCHEDULE_INVALID_VIEW_CONFIG");
    }
    // An unknown envelope key is BAD_REQUEST.
    const extra = await inject("POST", "/api/schedule/views", {
      ...viewBody,
      pinned: true,
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().errorCode).toBe("BAD_REQUEST");
  });
});

describe("schedule api: session guard", () => {
  it("new routes answer 401 AUTH_REQUIRED without a session when auth is on", async () => {
    await app.close();
    await buildApp("production", { TOBY_AUTH_PASSWORD_HASH: PASSWORD_HASH });

    for (const [method, url] of [
      ["GET", "/api/schedule?from=2026-11-01&to=2026-11-30"],
      ["GET", "/api/schedule/items"],
      ["POST", "/api/schedule/items"],
      ["PATCH", "/api/schedule/items/1"],
      ["DELETE", "/api/schedule/items/1"],
      ["PUT", "/api/schedule/entries"],
      ["DELETE", "/api/schedule/entries/1"],
      ["GET", "/api/schedule/views"],
      ["POST", "/api/schedule/views"],
      ["PATCH", "/api/schedule/views/1"],
      ["DELETE", "/api/schedule/views/1"],
    ] as const) {
      const response = await inject(
        method,
        url,
        method === "GET" ? undefined : {},
      );
      expect(response.statusCode).toBe(401);
      expect(response.json().errorCode).toBe("AUTH_REQUIRED");
    }
  });
});
