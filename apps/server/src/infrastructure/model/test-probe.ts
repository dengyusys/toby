/**
 * One-off AI probe behind the settings domain's test endpoint: sends ONE
 * minimal real completion against "what WOULD be effective after saving
 * this body". Nothing here touches the settings database — the body's
 * credential changes live only in an in-memory overlay store, and the
 * probe's Models collection carries the domain's providers over that
 * overlay instead of the stored credentials. The outcome is structured
 * data, never an exception; the settings service maps it onto the wire
 * shape (types.ts stays free of this file). Failure classification
 * mirrors the single-shot client's mapFailure (client.ts), with catalog
 * misses answered as their own stage and the auth-flavored branch kept
 * as "auth" instead of "unconfigured".
 */

import { createModels } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Context,
  Credential,
  CredentialInfo,
  CredentialStore,
  Models,
} from "@earendil-works/pi-ai";
import { textOf } from "./client.ts";
import type { SettingsCredentialStore } from "./credential-store.ts";

/** The closed stage union the probe itself can answer. */
export type AiProbeStage =
  "ok" | "invalid-model" | "auth" | "timeout" | "request-failed";

/** The probe's structured outcome — infrastructure's copy of the wire data. */
export interface AiProbeOutcome {
  readonly stage: AiProbeStage;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly reply: string | null;
  readonly message: string | null;
}

/** One credential overlay the probe must apply in memory. */
export interface AiProbeCredentialOverlay {
  readonly provider: string;
  readonly apiKey?: string;
  readonly clear?: boolean;
}

export interface AiProbeInput {
  /** The effective "provider/model" spec (already spec-validated upstream). */
  readonly model: string;
  /** The effective request timeout (environment → built-in default). */
  readonly timeoutMs: number;
  /** The body's credential changes, in-memory only. */
  readonly credentials: readonly AiProbeCredentialOverlay[];
}

/** What the settings plugin wires in; structurally the domain's probe port. */
export interface AiTestProbe {
  probe(input: AiProbeInput): Promise<AiProbeOutcome>;
}

/**
 * The in-memory credential overlay: a typed key wins outright, `clear`
 * skips to the environment (the stored row is invisible), anything else
 * reads through to the underlying store. Writes never persist — `modify`
 * runs against the overlay view and its answer (e.g. an OAuth refresh)
 * stays in memory, serialized per provider like the real store requires.
 */
function overlayCredentialStore(
  underlying: SettingsCredentialStore,
  overlays: Map<string, AiProbeCredentialOverlay>,
): CredentialStore {
  const chains = new Map<string, Promise<unknown>>();
  const enqueue = <T>(
    providerId: string,
    task: () => Promise<T>,
  ): Promise<T> => {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  };

  const readOne = (providerId: string): Promise<Credential | undefined> => {
    const overlay = overlays.get(providerId);
    if (overlay?.clear === true) {
      return Promise.resolve(undefined);
    }
    if (overlay?.apiKey !== undefined) {
      return Promise.resolve({ type: "api_key", key: overlay.apiKey });
    }
    return underlying.read(providerId);
  };

  return {
    read: (providerId) => readOne(providerId),

    // Metadata only, like the underlying store; overlay overrides apply.
    async list(): Promise<readonly CredentialInfo[]> {
      const merged = new Map<string, CredentialInfo>(
        (await underlying.list()).map((info) => [info.providerId, info]),
      );
      for (const [providerId, overlay] of overlays) {
        if (overlay.clear === true) {
          merged.delete(providerId);
        } else if (overlay.apiKey !== undefined) {
          merged.set(providerId, { providerId, type: "api_key" });
        }
      }
      return [...merged.values()];
    },

    modify: (providerId, fn) =>
      enqueue(providerId, async () => fn(await readOne(providerId))),

    delete: (providerId) =>
      enqueue(providerId, async () => {
        overlays.set(providerId, { provider: providerId, clear: true });
      }),
  };
}

const PROBE_PROMPT = "Reply with exactly: OK";
// A fixed one-word answer needs no generation budget to speak of; the
// smallest sane window keeps the probe cheap on metered providers.
const PROBE_MAX_TOKENS = 32;
/** Server-side reply cap: the UI shows a snippet, not the model's essay. */
const PROBE_REPLY_MAX_CHARS = 120;

export function createAiTestProbe(deps: {
  /** The settings domain's shared Models collection (providers to copy). */
  models: Models;
  /** The underlying credential store the overlay wraps. */
  credentialStore: SettingsCredentialStore;
}): AiTestProbe {
  const { models, credentialStore } = deps;

  return {
    async probe(input) {
      const overlays = new Map<string, AiProbeCredentialOverlay>();
      for (const change of input.credentials) {
        overlays.set(change.provider, change);
      }

      // Catalog membership first: a spec-shaped model outside the catalog
      // is the invalid-model stage, before any network work. Mirrors the
      // per-request catalog resolution of the single-shot client.
      const [providerId = "", ...rest] = input.model.split("/");
      const modelId = rest.join("/");
      const resolved =
        providerId && modelId
          ? models.getModel(providerId, modelId)
          : undefined;
      if (!resolved) {
        return {
          stage: "invalid-model",
          model: input.model,
          latencyMs: null,
          reply: null,
          message: `AI model "${input.model}" is not a known provider/model pair in the pi-ai catalog`,
        };
      }

      // The one-off catalog view: the shared providers over the overlay
      // store — the same model catalog the domain serves, with the body's
      // credentials in force and the stored rows untouched.
      const probeModels = createModels({
        credentials: overlayCredentialStore(credentialStore, overlays),
      });
      for (const provider of models.getProviders()) {
        probeModels.setProvider(provider);
      }

      const context: Context = {
        messages: [
          { role: "user", content: PROBE_PROMPT, timestamp: Date.now() },
        ],
      };
      const signal = AbortSignal.timeout(input.timeoutMs);
      const startedAt = Date.now();
      let reply: AssistantMessage;
      try {
        reply = await probeModels.completeSimple(resolved, context, {
          maxTokens: PROBE_MAX_TOKENS,
          temperature: 0,
          signal,
        });
      } catch (error) {
        // pi-ai settles provider failures into the message; a throw here is
        // infrastructure-level (never expected) — still answered as data.
        return {
          stage: "request-failed",
          model: input.model,
          latencyMs: null,
          reply: null,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const latencyMs = Date.now() - startedAt;

      // Failure classification mirroring client.ts mapFailure, with the
      // auth-flavored branch as its own stage (the endpoint's outcome is
      // data, so "unconfigured" stays reserved for the no-model case).
      if (reply.stopReason === "aborted" || signal.aborted) {
        return {
          stage: "timeout",
          model: input.model,
          latencyMs,
          reply: null,
          message: "AI request timed out",
        };
      }
      if (reply.stopReason === "error") {
        const configured = await probeModels
          .checkAuth(providerId)
          .catch(() => undefined);
        if (!configured) {
          return {
            stage: "auth",
            model: input.model,
            latencyMs,
            reply: null,
            message: `AI provider "${providerId}" is not configured: add its API key on the settings page or set its environment variable (see .env.example)`,
          };
        }
        return {
          stage: "request-failed",
          model: input.model,
          latencyMs,
          reply: null,
          message:
            reply.errorMessage ?? `AI provider error (${reply.stopReason})`,
        };
      }
      const text = textOf(reply);
      if (text.length === 0) {
        return {
          stage: "request-failed",
          model: input.model,
          latencyMs,
          reply: null,
          message: "AI provider returned no message content",
        };
      }
      return {
        stage: "ok",
        model: input.model,
        latencyMs,
        reply: text.trim().slice(0, PROBE_REPLY_MAX_CHARS),
        message: null,
      };
    },
  };
}
