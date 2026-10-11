/**
 * Response writer: unified JSON headers with a no-store policy so refreshes
 * always read the latest data. Takes a pre-serialized string and owns the
 * Content-Type, keeping response bytes identical to the contract.
 */

import type { FastifyReply } from "fastify";

export function sendJsonReply(
  reply: FastifyReply,
  status: number,
  body: unknown,
): void {
  reply
    .status(status)
    .header("Content-Type", "application/json; charset=utf-8")
    .header("Cache-Control", "no-store")
    .send(JSON.stringify(body));
}
