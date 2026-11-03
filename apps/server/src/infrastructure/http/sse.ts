/**
 * Minimal SSE plumbing for the trace stream. A hijacked reply skips the
 * global onSend hook, so no-store is set here with the stream headers. The
 * immediate ": connected" comment frame tells clients (and integration
 * tests) the stream is live without waiting for the first event or
 * heartbeat.
 */

import type { FastifyReply } from "fastify";

/** Idle keep-alive; also surfaces dead connections through write errors. */
const HEARTBEAT_MS = 15_000;

export interface SseStream {
  /** Write one named event with a JSON payload. */
  send(eventName: string, data: unknown): void;
  /** Run when the connection closes (client or server side). */
  onClose(callback: () => void): void;
}

export function openEventStream(reply: FastifyReply): SseStream {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // Reverse proxies (nginx and friends) must not buffer the stream.
    "x-accel-buffering": "no",
  });
  raw.write(": connected\n\n");

  const closeCallbacks: (() => void)[] = [];
  const heartbeat = setInterval(() => {
    raw.write(": ping\n\n");
  }, HEARTBEAT_MS);

  raw.on("close", () => {
    clearInterval(heartbeat);
    for (const callback of closeCallbacks) {
      callback();
    }
  });

  return {
    send(eventName, data) {
      raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(callback) {
      closeCallbacks.push(callback);
    },
  };
}
