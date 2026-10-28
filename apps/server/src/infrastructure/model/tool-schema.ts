/**
 * pi-ai's tool-parameter boundary: our schemas are Zod, pi-ai compiles JSON
 * Schema. `io: "input"` keeps defaulted fields optional in a tool call, and
 * `unrepresentable: throw` makes an unconvertible schema fail at boot instead
 * of silently becoming `{}`.
 */

import { z } from "zod";

/** A JSON Schema document, as pi-ai compiles it for tool parameters. */
export type ToolParameterSchema = Record<string, unknown>;

/**
 * A Zod schema as the JSON Schema pi-ai expects for tool parameters. The draft
 * target is pinned so a Zod default cannot silently change the contract.
 */
export function toolSchema(schema: z.ZodType): ToolParameterSchema {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
  }) as ToolParameterSchema;
}
