/**
 * Settings domain client: the effective AI settings view, its one
 * transactional write, and the model catalog. Mirrors the server's
 * response shapes. Every failure throws ApiError whose `code` is one of
 * SettingsErrorCode.
 */

import { endpoint, requestJson } from "./request-json.ts";

/** The closed error-code union, mirroring the server domain's. */
export type SettingsErrorCode =
  | "SETTINGS_INVALID_MODEL"
  | "SETTINGS_UNKNOWN_PROVIDER"
  | "SETTINGS_INVALID_CREDENTIAL"
  | "SETTINGS_BODY_INVALID";

/** Where an effective value came from: a database row, or the environment. */
export type AiSettingsSource = "db" | "env";

/** One provider's credential status — never key material. */
export interface ProviderStatus {
  id: string;
  source: "stored" | "env";
  /** Masked preview, or null when there is no stored key to preview. */
  maskedKey: string | null;
}

/** GET/PUT /api/settings/ai — the effective AI settings view. */
export interface AiSettingsView {
  model: { value: string | null; source: AiSettingsSource | null };
  providers: ProviderStatus[];
}

/** One provider's slice of the model catalog. */
export interface AiCatalogProvider {
  id: string;
  models: string[];
}

/** GET /api/settings/ai/catalog. */
export interface AiCatalog {
  providers: AiCatalogProvider[];
}

/** PUT /api/settings/ai body. Omitted fields stay unchanged. */
export interface AiSettingsUpdate {
  model?: string | null;
  credentials?: { provider: string; apiKey?: string; clear?: boolean }[];
}

export interface SettingsClient {
  getAiSettings(): Promise<AiSettingsView>;
  /** One transactional write; the answer is the new effective view. */
  saveAiSettings(body: AiSettingsUpdate): Promise<AiSettingsView>;
  getCatalog(): Promise<AiCatalog>;
}

export function createSettingsClient(baseUrl: string): SettingsClient {
  return {
    getAiSettings: () =>
      requestJson<AiSettingsView>(endpoint(baseUrl, "/api/settings/ai")),
    saveAiSettings: (body) =>
      requestJson<AiSettingsView>(endpoint(baseUrl, "/api/settings/ai"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    getCatalog: () =>
      requestJson<AiCatalog>(endpoint(baseUrl, "/api/settings/ai/catalog")),
  };
}
