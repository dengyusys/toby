/**
 * Ledger domain Nest module: the store (owning its database) and the
 * service (running the proposal sweeper) as @Injectable classes. AI
 * disabled (no TOBY_AI_MODEL) keeps the extractor provider undefined:
 * the service then answers the one-sentence path with 501.
 */

import { Logger, Module } from "@nestjs/common";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createTobyAgentFactory } from "../../infrastructure/ai/agent.ts";
import { TOBY_CONFIG } from "../../infrastructure/providers/shared-tokens.ts";
import { LedgerStore } from "./store.ts";
import { LedgerService, type LedgerTiming } from "./service.ts";
import { createLedgerExtractor } from "./extraction.ts";
import { LedgerController } from "./ledger.controller.ts";
import { LEDGER_EXTRACTOR, LEDGER_TIMING } from "./tokens.ts";

@Module({
  controllers: [LedgerController],
  providers: [
    LedgerStore,
    LedgerService,
    { provide: LEDGER_TIMING, useValue: {} satisfies LedgerTiming },
    {
      provide: LEDGER_EXTRACTOR,
      useFactory: (config: TobyConfig) =>
        config.ai
          ? createLedgerExtractor({
              agentFactory: createTobyAgentFactory(config.ai, {
                logger: new Logger("AiAgent"),
              }),
            })
          : undefined,
      inject: [TOBY_CONFIG],
    },
  ],
})
export class LedgerModule {}
