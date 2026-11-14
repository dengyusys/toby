/**
 * The settings wire shapes, defined once: the PUT body. Shape only —
 * semantic checks (model spec, provider existence, key presence) live in
 * the service.
 */

import { z } from "zod";

/**
 * One credential change: set an api key, or clear the stored one. The key
 * itself is intentionally not min(1)-checked here — an empty key is a
 * semantic failure the service answers with SETTINGS_INVALID_CREDENTIAL.
 */
export const AI_CREDENTIAL_CHANGE_SCHEMA = z
  .object({
    provider: z.string().min(1).describe('pi-ai provider id, e.g. "zai"'),
    apiKey: z
      .string()
      .optional()
      .describe("The provider API key, stored verbatim"),
    clear: z
      .boolean()
      .optional()
      .describe("Remove the stored credential; the environment stays fallback"),
  })
  .strict();

export type AiCredentialChangeBody = z.infer<
  typeof AI_CREDENTIAL_CHANGE_SCHEMA
>;

/** PUT /api/settings/ai body. Every field optional; strict about extras. */
export const AI_SETTINGS_BODY_SCHEMA = z
  .object({
    model: z
      .string()
      .nullable()
      .optional()
      .describe('AI model as "provider/model", or null to clear'),
    credentials: z
      .array(AI_CREDENTIAL_CHANGE_SCHEMA)
      .optional()
      .describe("Provider credential changes"),
  })
  .strict();

export type AiSettingsBody = z.infer<typeof AI_SETTINGS_BODY_SCHEMA>;
