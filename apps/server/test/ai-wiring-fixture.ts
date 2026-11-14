/**
 * The faux catalog seam behind the root-level production AI wiring
 * regression (test/ai-credential-wiring.integration.test.ts). The stock
 * faux provider's auth resolve discards the stored credential, so this
 * fixture assembles the SAME faux core through `createProvider` with a
 * credential-aware auth resolve — a stored api-key row becomes the
 * request's api key, exactly how the built-in env-key providers treat a
 * stored row. A captured completion call's options.apiKey then proves (or
 * refutes) that the settings domain's credential store reached the
 * runtime transport. Root tests import only this file for pi-ai: the
 * workspace root cannot resolve the package directly.
 */

import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai";
import {
  createFauxCore,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai/providers/faux";
import type { SettingsCredentialStore } from "../src/infrastructure/model/credential-store.ts";

export interface FauxCatalog {
  /** The store-attached catalog factory for the createModels seams. */
  seam: (deps: { credentialStore: SettingsCredentialStore }) => Models;
  /** Script one completion answer (a reply text); captures the api key. */
  script: (text: string) => void;
  /** The api key each completion call received, in call order. */
  readonly receivedApiKeys: readonly unknown[];
  /** Drop scripted-but-unconsumed answers and the captured keys. */
  reset: () => void;
}

export function createFauxCatalog(): FauxCatalog {
  const core = createFauxCore({ models: [{ id: "faux-1" }] });
  const receivedApiKeys: unknown[] = [];

  // Credential-aware auth: whatever the credential store carries for this
  // provider rides as the request's api key; nothing stored → no key.
  const provider = createProvider({
    id: "faux",
    name: "Faux",
    auth: {
      apiKey: {
        name: "Faux",
        resolve: async ({ credential }) => ({
          auth: {
            apiKey: credential?.type === "api_key" ? credential.key : undefined,
          },
        }),
      },
    },
    models: core.models,
    api: {
      [core.api]: { stream: core.stream, streamSimple: core.streamSimple },
    },
  });

  return {
    seam: ({ credentialStore }) => {
      const models = createModels({ credentials: credentialStore });
      models.setProvider(provider);
      return models;
    },

    script: (text) => {
      core.appendResponses([
        (_context, options) => {
          receivedApiKeys.push(options?.apiKey);
          return fauxAssistantMessage(text);
        },
      ]);
    },

    receivedApiKeys,

    reset: () => {
      receivedApiKeys.length = 0;
      core.setResponses([]);
    },
  };
}
