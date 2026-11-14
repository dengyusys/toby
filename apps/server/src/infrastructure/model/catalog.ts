/**
 * Shared pi-ai catalog access: parse the configured "provider/model" pair
 * against a models collection. Used per request by both the single-shot
 * client and the agent runtime — the model is re-resolved on every call so
 * a runtime settings change lands immediately. A pair outside the catalog
 * is a typed AiError (a stale database row must degrade like any other
 * AI failure, never crash a route).
 */

import type { Model, Models } from "@earendil-works/pi-ai";
import { AiError } from "./errors.ts";

export function resolveCatalogModel(
  catalog: Models,
  model: string,
): Model<string> {
  const [providerId, ...rest] = model.split("/");
  const modelId = rest.join("/");
  const resolved =
    providerId && modelId ? catalog.getModel(providerId, modelId) : undefined;
  if (!resolved) {
    throw new AiError(
      "request-failed",
      `AI model "${model}" is not a known provider/model pair in the pi-ai catalog`,
    );
  }
  return resolved;
}
