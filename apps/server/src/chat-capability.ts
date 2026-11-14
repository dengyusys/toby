/**
 * The chat capability contract: what a routable domain hands the chat
 * domain, satisfied structurally — the domain builds its capability from
 * its own service and types, the composition root collects them into
 * `chatPlugin` (docs/decisions/chat-domain-capabilities.md). This module
 * is a composition-root-level leaf: it imports infrastructure type surface
 * only, never a domain and never chat itself; the boundary tests enforce
 * that. A domain's `chat-capability.ts` imports this file type-only.
 */

import type { TobyTool } from "./infrastructure/model/agent.ts";

/**
 * What a capability's write produced: exactly one of these. Domain-level
 * outcomes — a clarifying question, an honest refusal — are values here,
 * never throws; a rejection means infrastructure failed, and chat answers
 * with its generic fallback notice.
 */
export type ChatWriteOutcome =
  | {
      readonly kind: "receipt";
      /** The receipt copy; it references the domain's own fields. */
      readonly confirmText: string;
      /**
       * Opaque passthrough: chat copies it verbatim into the card item.
       * Typed `unknown`, not an index-signature record, because named
       * interfaces (the domain's own view types) do not carry index
       * signatures — opacity is the contract, structure is none of
       * chat's business.
       */
      readonly receipt: unknown;
    }
  | { readonly kind: "question"; readonly text: string }
  | { readonly kind: "notice"; readonly text: string };

/** One routable domain as chat sees it: identity, write path, read tools. */
export interface ChatDomainCapability {
  /** The routing intent id, e.g. "ledger"; "none" is chat's own. */
  readonly intent: string;
  /** Human label, e.g. "记账". */
  readonly label: string;
  /** One classifier-prompt intent line, used verbatim. */
  readonly intentDescription: string;
  /**
   * The write path. Calls the domain's service — one validated,
   * transactional write.
   */
  handleWrite(sentence: string): Promise<ChatWriteOutcome>;
  /** Read-only tools for the none-agent; kind-gated by the shared factory. */
  readonly tools: readonly TobyTool[];
  /** A toolCall → preview-panel target ("ledger:2026-11"); none = no chip. */
  inspectTarget(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): { readonly target: string; readonly label: string } | undefined;
  /**
   * A mid-run tool result → its silent-learning card, or undefined when
   * the tool produced nothing cardable. Called by chat for every
   * toolResult the none agent produced, first capability that answers
   * wins (tool names are the capability's own namespace). The receipt is
   * opaque passthrough, like every card receipt.
   */
  cardFor?(
    toolName: string,
    details: unknown,
  ): { readonly confirmText: string; readonly receipt: unknown } | undefined;
}
