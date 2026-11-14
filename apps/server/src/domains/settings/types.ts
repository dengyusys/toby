/**
 * Settings domain types: the pure vocabulary shared by the repository, the
 * service and the routes. Plain data only — this file stays import-free
 * (the boundary tests enforce it). Response shapes are mirrored by hand in
 * packages/contract/src/settings-client.ts — change both sides together.
 */

/** Where an effective AI value came from. */
export type AiSettingsSource = "db" | "env";

/** The effective model: what is in force and where it came from. */
export interface AiModelField {
  readonly value: string | null;
  /** null when neither the database nor the environment configures a model. */
  readonly source: AiSettingsSource | null;
}

/**
 * The model + timeout an AI request resolves to, without provider
 * statuses. The model resolves database → environment; the timeout is an
 * ops concern: environment → built-in default (no settings surface).
 */
export interface AiRuntimeValues {
  readonly model: string | null;
  readonly timeoutMs: number;
}

/**
 * One credential-configured provider as the UI sees it. Key material never
 * appears here — only a masked preview, or null when there is no stored
 * key to preview.
 */
export interface ProviderStatus {
  readonly id: string;
  /** "stored" = a credential row in the settings db; "env" = ambient config. */
  readonly source: "stored" | "env";
  readonly maskedKey: string | null;
}

/** GET /api/settings/ai — the effective AI settings view. */
export interface AiSettingsView {
  readonly model: AiModelField;
  readonly providers: readonly ProviderStatus[];
}

/** One provider's slice of the model catalog. */
export interface AiCatalogProvider {
  readonly id: string;
  readonly models: readonly string[];
}

/** GET /api/settings/ai/catalog. */
export interface AiCatalog {
  readonly providers: readonly AiCatalogProvider[];
}

/** One credential change inside a PUT body. */
export interface AiCredentialChange {
  readonly provider: string;
  readonly apiKey?: string;
  readonly clear?: boolean;
}

/** PUT /api/settings/ai body. Omitted fields stay unchanged. */
export interface AiSettingsUpdate {
  readonly model?: string | null;
  readonly credentials?: readonly AiCredentialChange[];
}

/**
 * Stages the probe itself answers; the service owns "unconfigured" (the
 * no-model case never reaches the probe). Mirrored by infrastructure's
 * AiProbeStage in test-probe.ts — change both sides together.
 */
export type AiTestProbeStage =
  "ok" | "invalid-model" | "auth" | "timeout" | "request-failed";

/** The probe port's structured outcome — plain data, never an exception. */
export interface AiTestProbeOutcome {
  readonly stage: AiTestProbeStage;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly reply: string | null;
  readonly message: string | null;
}

/**
 * The probe port behind POST /api/settings/ai/test: one minimal real
 * completion against the effective-after-save configuration, with the
 * body's credentials applied in memory only. Satisfied by
 * infrastructure/model/test-probe.ts; tests inject fakes. Declared here so
 * the domain never imports infrastructure types.
 */
export interface AiTestProbe {
  probe(input: {
    readonly model: string;
    readonly timeoutMs: number;
    readonly credentials: readonly AiCredentialChange[];
  }): Promise<AiTestProbeOutcome>;
}

/** POST /api/settings/ai/test — the closed stage union. */
export type AiTestStage = "unconfigured" | AiTestProbeStage;

/**
 * POST /api/settings/ai/test result. The test outcome is data, not an
 * HTTP error — only request-shape problems answer 400.
 */
export interface AiTestResult {
  readonly stage: AiTestStage;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly reply: string | null;
  readonly message: string | null;
}

/** DB keys under which the AI settings rows live. */
export const AI_MODEL_KEY = "ai.model";
// The request timeout is no longer settings-configurable (an ops concern
// via TOBY_AI_TIMEOUT_MS). A stale "ai.timeoutMs" row in an existing
// database is simply never read again — harmless, no migration.
