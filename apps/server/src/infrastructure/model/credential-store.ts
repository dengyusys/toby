/**
 * pi-ai's CredentialStore over the settings repository (the settings domain
 * owns the table). The persistence port is declared here and satisfied
 * structurally by the repository — infrastructure never imports business
 * domains; the settings plugin binds the two. Writes are serialized per
 * provider through a promise chain: pi-ai's contract makes `modify` the
 * only write path and requires mutual exclusion per provider id, because
 * correct writes (token refresh, login-during-refresh) depend on seeing
 * the current credential.
 */

import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

/** The credential slice of the settings persistence, as this adapter sees it. */
export interface CredentialPersistence {
  readCredential(providerId: string): Promise<string | null>;
  listCredentialIds(): Promise<readonly string[]>;
  apply(changes: {
    setCredentials?: readonly { providerId: string; credentialJson: string }[];
    deleteCredentials?: readonly string[];
  }): Promise<void>;
}

/** The adapter's product: pi-ai's store interface, nothing added. */
export type SettingsCredentialStore = CredentialStore;

/**
 * Parse one stored credential. v1 persists only api-key credentials, but
 * an oauth row is returned as-is if one is ever present. Invalid JSON is
 * treated as absent — reported, never deleted (the row is user data; the
 * next valid write overwrites it).
 */
function parseCredential(raw: string): Credential | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const type =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { type?: unknown }).type
        : undefined;
    if (type === "api_key" || type === "oauth") {
      return parsed as Credential;
    }
  } catch {
    // Invalid JSON: absent below.
  }
  return undefined;
}

export function createSettingsCredentialStore(deps: {
  persistence: CredentialPersistence;
}): SettingsCredentialStore {
  const { persistence } = deps;

  // One promise chain per provider id: every modify and remove queues
  // behind the previous one, so two concurrent modifies cannot interleave
  // their read and write halves (pi-ai's serialization contract).
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    // One failure must not poison the chain for the tasks behind it.
    chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  }

  async function readOne(providerId: string): Promise<Credential | undefined> {
    const raw = await persistence.readCredential(providerId);
    return raw === null ? undefined : parseCredential(raw);
  }

  return {
    read: (providerId) => readOne(providerId),

    // Metadata only: ids plus the one type v1 persists. Key material never
    // leaves the store through list().
    async list(): Promise<readonly CredentialInfo[]> {
      const ids = await persistence.listCredentialIds();
      return ids.map((providerId) => ({
        providerId,
        type: "api_key" as const,
      }));
    },

    modify: (providerId, fn) =>
      enqueue(providerId, async () => {
        const current = await readOne(providerId);
        const next = await fn(current);
        // undefined from fn = leave the entry unchanged; the answer is the
        // post-write credential (still the current one, maybe undefined).
        if (next === undefined) {
          return current;
        }
        await persistence.apply({
          setCredentials: [
            { providerId, credentialJson: JSON.stringify(next) },
          ],
        });
        return next;
      }),

    delete: (providerId) =>
      enqueue(providerId, async () => {
        await persistence.apply({ deleteCredentials: [providerId] });
      }),
  };
}
