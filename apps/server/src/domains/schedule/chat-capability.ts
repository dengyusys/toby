/**
 * The schedule chat capability: the write path (one-sentence direct
 * writes through the service's extraction flow) and the none-agent's
 * read-only schedule tools, mirroring the ledger capability's shape
 * (docs/decisions/chat-domain-capabilities.md). Built from the schedule
 * service; the capability contract (src/chat-capability.ts) is
 * satisfied structurally, never imported beyond its types. The write
 * tools (put / clear) ride the schedule extraction agent only — they
 * are deliberately absent here, because the none agent's toolset is
 * exactly this array, and business writes stay with their own intents.
 */

import type {
  ChatDomainCapability,
  ChatWriteOutcome,
} from "../../chat-capability.ts";
import {
  createScheduleReadTools,
  type ScheduleExtractionReads,
} from "./extraction.ts";
import type { ScheduleService } from "./service.ts";
import type { ScheduleWriteReceipt } from "./types.ts";

/** The receipt copy, referencing only the schedule's own fields. */
function receiptConfirmText(receipt: ScheduleWriteReceipt): string {
  const cleared = receipt.cleared.length;
  if (receipt.written > 0 && cleared > 0) {
    return `已记录 ${receipt.written} 项、清除 ${cleared} 项。`;
  }
  if (receipt.written > 0) {
    return `已记录 ${receipt.written} 项。`;
  }
  if (cleared > 0) {
    return `已清除 ${cleared} 项。`;
  }
  // Every op resolved to a no-op (clears of absent records): the turn
  // landed nothing, and the copy says so.
  return "没有产生改动。";
}

export function createScheduleChatCapability(
  service: ScheduleService,
): ChatDomainCapability {
  // The read tools answer from the service, so the none agent gets the
  // same validation (real dates, ordered window, span cap) the HTTP
  // list enforces.
  const reads: ScheduleExtractionReads = {
    listItems: async () => (await service.listItems()).items,
    listEntries: async (from, to) =>
      (await service.listEntries(from, to)).entries,
  };
  return {
    intent: "schedule",
    label: "日程",
    intentDescription:
      "- schedule(日程):记录某天某事项的状态(吃了没、做没做完)、修改或清除某天的记录、查某段时间各项的记录。",
    async handleWrite(sentence) {
      const result = await service.write({ text: sentence });
      if ("question" in result) {
        return { kind: "question", text: result.question };
      }
      const outcome: ChatWriteOutcome = {
        kind: "receipt",
        confirmText: receiptConfirmText(result),
        receipt: result,
      };
      return outcome;
    },
    tools: createScheduleReadTools(reads),
    /**
     * Schedule has no preview panel: the webs' target vocabulary only
     * knows "ledger:YYYY-MM" (preview-context's parser), so nothing here
     * maps — no chip is offered rather than a dead link. The mapping
     * lands together with the schedule UI.
     */
    inspectTarget: () => undefined,
  };
}
