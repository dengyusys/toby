/**
 * Settings routes: a thin HTTP shell, one service call per handler. The
 * PUT envelope — and the POST /test body, which accepts the exact same
 * shape — is checked here against schema.ts and answers the domain's own
 * SETTINGS_BODY_INVALID (clients match codes, never framework ones).
 * Every route follows the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { SettingsRequestError } from "./errors.ts";
import { AI_SETTINGS_BODY_SCHEMA, type AiSettingsBody } from "./schema.ts";
import type { SettingsService } from "./service.ts";

export interface SettingsRoutesOptions {
  service: SettingsService;
}

/** `path: message` per issue, one string per body — never an array. */
function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  return issue.path.length > 0
    ? `${issue.path.map(String).join(".")}: ${issue.message}`
    : issue.message;
}

/** Parses a PUT body; a bad shape answers SETTINGS_BODY_INVALID, not BAD_REQUEST. */
function parseAiSettingsBody(body: unknown): AiSettingsBody {
  const result = AI_SETTINGS_BODY_SCHEMA.safeParse(body);
  if (!result.success) {
    throw new SettingsRequestError(
      "SETTINGS_BODY_INVALID",
      result.error.issues.map(formatIssue).join("; "),
    );
  }
  return result.data;
}

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  app,
  { service },
) => {
  app.get("/api/settings/ai", () => service.getAiSettings());

  app.put("/api/settings/ai", (request) =>
    service.updateAiSettings(parseAiSettingsBody(request.body)),
  );

  // The outcome is data (a 200 stage), never an HTTP error; the body is
  // validated exactly like PUT, so shape problems answer the same 400s.
  app.post("/api/settings/ai/test", (request) =>
    service.testConfiguration(parseAiSettingsBody(request.body)),
  );

  app.get("/api/settings/ai/catalog", () => service.getCatalog());
};
