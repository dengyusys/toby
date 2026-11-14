/**
 * The memory chat capability: the explicit-sentence write path (the
 * memory agent), the two conversational memory tools (remember / forget)
 * for the none agent, the in-run receipt cards (silent learning), and the
 * inspect-link mapping (docs/decisions/personal-agent-memory.md,
 * docs/decisions/chat-domain-capabilities.md). Built from the memory
 * service plus the shared tool instance set — the same objects the ledger
 * extractor and the memory agent close over, so the off-record gate and
 * the receipts stay consistent everywhere. The capability contract
 * (src/chat-capability.ts) is satisfied structurally, never imported
 * beyond its types.
 */

import type { TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import type { ChatDomainCapability } from "../../chat-capability.ts";
import { AI_UNCONFIGURED_MESSAGE } from "../../infrastructure/model/errors.ts";
import { createMemoryAgent } from "./agent.ts";
import type { MemoryTools } from "./tools.ts";
import type { MemoryReceipt, MemoryService } from "./types.ts";

/**
 * The in-run card copy: one line per landed receipt, quoting the file —
 * the same words the tool itself answers with.
 */
function receiptConfirmText(receipt: MemoryReceipt): string {
  if (receipt.action === "remembered") {
    return `已记住：${receipt.after}`;
  }
  return receipt.action === "updated"
    ? `已更新：${receipt.after}`
    : `已清理：${receipt.before}`;
}

export function createMemoryChatCapability(deps: {
  service: MemoryService;
  /**
   * The full shared tool set; the capability exposes exactly the two
   * conversational tools — off_record stays on the memory agent only (the
   * none agent never needs it).
   */
  tools: MemoryTools;
  /** Test seam / absent when AI is unconfigured. */
  agentFactory?: TobyAgentFactory;
}): ChatDomainCapability {
  const { service, tools } = deps;
  const agent = deps.agentFactory
    ? createMemoryAgent({ agentFactory: deps.agentFactory, service })
    : undefined;

  return {
    intent: "memory",
    label: "记忆",
    intentDescription:
      "- memory(记忆):记住、更新或忘掉某条记忆;问「你记得我什么」;说「这通别记」或「恢复记忆」。",
    async handleWrite(sentence) {
      if (!agent) {
        // Absent factory (test/standalone seams): the same honest copy the
        // runtime unconfigured error maps to in production.
        return { kind: "notice", text: AI_UNCONFIGURED_MESSAGE };
      }
      const { outcome } = await agent.run(sentence);
      return outcome;
    },
    tools: [tools.remember, tools.forget],
    /**
     * Memory has no preview panel: the webs' target vocabulary only knows
     * "ledger:YYYY-MM" (preview-context's parser), so nothing here maps —
     * no chip is offered rather than a dead link.
     */
    inspectTarget: () => undefined,
    /**
     * In-run receipt cards: a remember/forget the none agent (or another
     * agent carrying the shared tools) executed mid-conversation becomes
     * its own silent-learning card, receipt quoted verbatim.
     */
    cardFor(toolName, details) {
      if (toolName !== "remember" && toolName !== "forget") {
        return undefined;
      }
      const record = details as { receipt?: unknown } | null;
      if (
        record === null ||
        typeof record !== "object" ||
        record.receipt === undefined ||
        record.receipt === null
      ) {
        return undefined;
      }
      const receipt = record.receipt as MemoryReceipt;
      return { confirmText: receiptConfirmText(receipt), receipt };
    },
  };
}
