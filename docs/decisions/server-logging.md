# Server Logging with Pino

English | [简体中文](server-logging.zh.md)

The server logs one pino stream to stdout — the request lifecycle lines and
the error boundary's 500 report — and nothing else. The process supervisor
(`docker logs`, the systemd journal) keeps the history; the server keeps no
log of its own.

**The reason: the zero-log policy left every unexpected 500 without a request
to blame, and pino was already the resolved transitive dependency of fastify —
adopting it as a direct catalog entry at the same version adds nothing to the
install.**

## What is logged

- **Request lifecycle** — fastify's built-in logger integration (the
  composition root passes the instance to `fastify({ logger })`): an
  "incoming request" and a "request completed" line per request, carrying the
  request id, method, url, status code and response time.
- **The sanitized 500** — the error boundary calls
  `request.log.error({ stack }, "unhandled error")`: the stack as a string
  only, never the error object (driver errors carry SQL text, hosts and users
  in their properties and causes), sharing the request id with the request
  lines so a 500 lines up with the request that caused it.
- `main.ts` bootstrap failures keep their plain stderr lines — no logger
  exists yet at config-resolution time.

## What is deliberately not logged

- **Request content**: bodies, headers and cookies stay out (the default
  serializers log method, url and status only); session tokens never appear.
- **Files and rotation**: stdout only. Retention belongs to the supervisor,
  not the application.
- **AI transcripts and prompts**: model call content never enters the log;
  the trace bus keeps its zero-storage console semantics
  (docs/features/traces.md).

## Minimal for now

The level is fixed at `info`. Pretty dev output, a `TOBY_LOG_LEVEL` knob and
AI run summary lines are future iterations; each revisits this record.
