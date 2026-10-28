/**
 * The tool contract the model sees is JSON Schema produced from Zod. These
 * tests pin the parts that would otherwise drift silently: the draft, the
 * strictness, and the input-side requiredness.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LEDGER_ENTRIES_TOOL_SCHEMA } from "../../../src/domains/ledger/schema.ts";
import { toolSchema } from "../../../src/infrastructure/model/tool-schema.ts";

describe("toolSchema", () => {
  it("emits the pinned draft", () => {
    const schema = toolSchema(z.object({ a: z.string() }));
    expect(schema["$schema"]).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("keeps a strict object closed", () => {
    const schema = toolSchema(z.object({ a: z.string() }).strict());
    expect(schema.additionalProperties).toBe(false);
  });

  it("marks a defaulted field optional on the input side", () => {
    const schema = toolSchema(z.object({ a: z.string().default("x") }));
    expect(schema.required).toBeUndefined();
  });

  it("describes the ledger entries tool exactly once, as a batch of drafts", () => {
    const schema = toolSchema(LEDGER_ENTRIES_TOOL_SCHEMA);
    const entries = (
      schema.properties as Record<
        string,
        { type: string; minItems: number; maxItems: number }
      >
    ).entries;
    expect(entries?.type).toBe("array");
    expect(entries?.minItems).toBe(1);
    expect(entries?.maxItems).toBe(10);
    expect(schema.required).toEqual(["entries"]);
  });
});
