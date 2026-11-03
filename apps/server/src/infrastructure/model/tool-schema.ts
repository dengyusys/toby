/**
 * pi-ai's tool-parameter boundary: our schemas are Zod, pi validates JSON
 * Schema with pi-schema (since pi 1.5.0 the parameter type is any JSON Schema
 * object, so the emitted document fits `AgentTool` directly). `io: "input"`
 * keeps defaulted fields optional in a tool call, and `unrepresentable:
 * throw` makes an unconvertible schema fail at boot instead of silently
 * becoming `{}`. The pi-schema compile below is the second half of that
 * fail-fast: a document pi could not compile surfaces at assembly, not in the
 * middle of a production run. It is a self-check only — run-time argument
 * validation stays pi's job, Toby does not add a second layer.
 */

import { z } from "zod";
import { compile } from "@earendil-works/pi-schema";

/** A JSON Schema document, as pi-ai compiles it for tool parameters. */
export type ToolParameterSchema = Record<string, unknown>;

/**
 * A Zod schema as the JSON Schema pi-ai expects for tool parameters. The draft
 * target is pinned so a Zod default cannot silently change the contract.
 */
export function toolSchema(schema: z.ZodType): ToolParameterSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
  }) as ToolParameterSchema;
  // pi compiles this exact document when validating tool arguments; compiling
  // once here makes an uncompilable schema fail at boot. Default draft is
  // 2020-12, matching the Zod target above.
  compile(json);
  return json;
}
