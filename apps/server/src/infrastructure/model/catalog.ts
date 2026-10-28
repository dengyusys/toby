/**
 * Shared pi-ai catalog access: parse TOBY_AI_MODEL's "provider/model"
 * pair against a models collection, failing with one consistent message.
 * Used by both the single-shot client and the agent factory.
 */

import type { Model, Models } from "@earendil-works/pi-ai";

export function resolveCatalogModel(
  catalog: Models,
  model: string,
): Model<string> {
  const [providerId, ...rest] = model.split("/");
  const modelId = rest.join("/");
  const resolved =
    providerId && modelId ? catalog.getModel(providerId, modelId) : undefined;
  if (!resolved) {
    throw new Error(
      `TOBY_AI_MODEL "${model}" is not a known provider/model pair in the pi-ai catalog`,
    );
  }
  return resolved;
}
