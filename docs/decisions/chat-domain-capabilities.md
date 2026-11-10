# Chat Routes by Registered Domain Capabilities

English | [简体中文](chat-domain-capabilities.zh.md)

## Why

**Landing a domain edits five chat files plus a hand-written adapter in
`composition-root.ts`.** Concretely, adding `schedule` means:

- `chat/types.ts` — extend the `ChatIntent` union, add a
  `ChatScheduleReceipt`;
- `chat/intent.ts` — add the enum entry and a classifier prompt line;
- `chat/service.ts` — add a `route()` branch, delete an `ON_THE_WAY`
  entry, add a port dependency;
- `chat/agent.ts` — add three read-only tools, a rules snippet, an
  `inspectTargetOf` case;
- `composition-root.ts` — hand-write the adapter that fits the schedule service into
  the port.

Chat holds the set of domain names; it should only hold the shape of a
routable domain.

**The "fixed once at full breadth" intent set was a day-one tradeoff.
With real domains landing, it inverts into a liability:**

- every landing becomes a chat contract change;
- the classifier advertises intents whose domains do not exist;
- the on-the-way notices promise the user features that are not there.

## The model

A domain that wants chat routing exports a **capability** — one object,
built from its own service, in its own directory. The composition root
collects capabilities and passes the registry to `chatPlugin`. Chat knows
the registry's shape, never its contents.

```ts
// src/chat-capability.ts — composition-root layer, type-only leaf
import type { ToolDefinition } from "./infrastructure/model/agent.ts";

/** What a write produced: exactly one of these, never a throw for
 *  domain-level outcomes (validation problems are a notice, not an error). */
export type ChatWriteOutcome =
  | {
      kind: "receipt";
      confirmText: string;
      receipt: Readonly<Record<string, unknown>>;
    } // opaque passthrough
  | { kind: "question"; text: string } // one clarifying question
  | { kind: "notice"; text: string }; // honest decline / failure copy

export interface ChatDomainCapability {
  readonly intent: string; // "ledger"
  readonly label: string; // "记账"
  /** One classifier-prompt line, verbatim: "- ledger(记账):记一笔钱、查账、问花了多少。" */
  readonly intentDescription: string;
  /** The write path. Calls the domain service — one validated,
   *  transactional write. */
  handleWrite(sentence: string): Promise<ChatWriteOutcome>;
  /** Read-only tools for the none-agent; kind-gated by the shared factory. */
  readonly tools: readonly ToolDefinition[];
  /** Rule snippets concatenated into the none-agent's rules. */
  readonly agentRules?: readonly string[];
  /** toolCall → preview-panel target ("ledger:2026-11"); undefined = no chip. */
  inspectTarget(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): { target: string; label: string } | undefined;
}
```

Decisions embedded there, stated plainly:

- **The receipt copy belongs to the domain.** `已记入 2 笔` references
  ledger's own receipt fields; today it sits in chat's `route()`. Under the
  capability it travels inside the `receipt` outcome as `confirmText`, so
  chat never phrases a domain's write for it.
- **The receipt is opaque to chat** — the same stance chat already takes
  toward pi-ai transcript items: the server never interprets content,
  rendering is the webs' job. Chat copies it into the card item verbatim.
- **`handleWrite` may not throw to signal a domain outcome.** Rejections
  (validation failure, unexpected failure) propagate to chat's existing catch
  and settle as the generic "查询出了点问题" notice — the current
  semantics, now written down.

## What each touch point becomes

| File                  | Before                                                                         | After                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat/types.ts`       | `ChatIntent` union, `ChatLedgerReceipt`, month/day summaries, `ChatLedgerPort` | all deleted; `ChatIntent` = `string`, items unchanged                                                                                                                              |
| `chat/intent.ts`      | `INTENTS` array, hand-written prompt section                                   | enum and intent lines derived from the registry at plugin assembly; the frame, `none` line, and folding rules stay                                                                 |
| `chat/service.ts`     | `route()` if-chain, `ON_THE_WAY` map, port dependency                          | `route()` looks up `capabilities.get(intent)`; absent → none-agent (a stale/unregistered intent string degrades to `none`, never 404); `ON_THE_WAY` deleted                        |
| `chat/agent.ts`       | three ledger tools, `inspectTargetOf`, format helpers                          | a generic none-agent: toolset = registry's concatenated tools, rules = base rules + each capability's snippets; ledger's tools/helpers move to `domains/ledger/chat-capability.ts` |
| `composition-root.ts` | hand-written `chatLedgerPort` adapter                                          | `capabilities: [ledgerChatCapability(ledgerDomain.service)]` — one line per domain                                                                                                 |
| `domains/ledger/`     | nothing chat-related                                                           | `chat-capability.ts`: the write outcome, the three tools, `inspectTarget`, using ledger's own types                                                                                |

Assembly-time validation, fail-fast at boot: duplicate `intent` ids or an
empty tools-plus-rules signature throw inside `chatPlugin` before the first
message, not at the first user sentence.

## Where the contract type lives

`src/chat-capability.ts`, beside `DomainMount`'s layer. It imports only
`infrastructure/model/agent.ts` types; domains import it type-only; the
boundary tests gain one rule — it stays a leaf (no domain, no chat
import). This preserves the red lines:

1. Domains never import each other, and now never import chat — the
   capability is a shape satisfied structurally; the domain's
   `chat-capability.ts` compiles against the leaf contract and its own
   service.
2. Infrastructure stays business-agnostic — `intentDescription` is
   business vocabulary, so the contract sits at the composition layer,
   not in `infrastructure/`.
3. Cross-domain wiring still happens only in `composition-root.ts`, shrunk to the
   registry list.

## Contract changes (`packages/contract`, both webs)

- `ChatIntent` becomes `string` on the wire; the valid set is
  server-internal (registry-derived). The classifier's zod enum is built
  from registered ids at runtime.
- `ProposalCardItem.domain` becomes `string`; `receipt` becomes opaque
  (`unknown`) in `chat-client.ts` — which therefore **stops changing when
  domains land**. Each domain's receipt view stays typed in its own
  client file (`ledger-client.ts` keeps `LedgerReceiptView`).
- Each web replaces its `item.receipt as LedgerReceiptView` cast with a
  card-renderer registry keyed by domain id; the ledger renderer narrows
  the receipt via `ledger-client` types. An unknown domain id renders a
  neutral "不支持的卡片" shell — old clients against newer servers degrade
  instead of crashing.
- `ON_THE_WAY` disappears: the classifier only knows registered intents.
  memory/notes/todo/schedule stop being advertised until they land — an
  honest UX change, deliberate.

## What does not change

- The write path stays one validated transaction per write;
  `handleWrite` → domain service → repository
  transaction, no intermediary machinery.
- The closed item union stays closed — capabilities produce `ChatWriteOutcome`
  shapes that map onto existing item types; a new item type remains an
  explicit chat decision.
- Zero-translation replay, `card_outcome`/`reportOutcome`, rate limiting,
  per-domain wire error codes (each domain's `errors.ts`), and the trace
  bus wiring are all untouched.

## Known limits

The registry removes mechanical complexity, not classification
difficulty: eight intents in one prompt may still confuse the model.
Remedies (hierarchical classification, per-domain classifiers) get their
own ADR if lived use demands one — not built speculatively.

## Rollout

One wave, ledger as the reference capability (it is the only live routed
domain — the smallest migration):

1. `src/chat-capability.ts` + boundary-test leaf rule;
2. chat's five files convert to registry-driven, `ChatLedgerPort` deleted;
3. `domains/ledger/chat-capability.ts` (write outcome, tools, inspect)
   replaces the `composition-root.ts` adapter;
4. contract: `ChatIntent`/`ProposalCardItem` open up; both webs switch to
   renderer registries;
5. tests: ledger capability tested in the ledger domain; chat tests mount
   a fake capability instead of a fake port; classifier-prompt tests assert
   the derived enum and prompt lines;
6. `docs/features/chat.md` rewritten: "adding an intent is a contract
   change" becomes "adding an intent is a domain registration".

Schedule adopts the pattern when it lands.
