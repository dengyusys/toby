/**
 * POST /api/ledger/proposals body: one of the two intake paths. Only the
 * envelope is checked here — `validation.ts` checks an entry against the same
 * schema the tool hands the model.
 */

import { z } from "zod";

/** A value that must be present; the domain decides what it may be. */
const present = z.custom<unknown>((value) => value !== undefined);

export const PROPOSAL_BODY_SCHEMA = z.union(
  [
    z.object({ text: z.string() }).strict(),
    z.object({ entry: present }).strict(),
  ],
  { error: 'body must carry exactly one of "text" or "entry"' },
);

export type ProposalBody = z.infer<typeof PROPOSAL_BODY_SCHEMA>;
