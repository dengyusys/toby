# System Domain: Walking Skeleton and Ops Probe

English | [简体中文](system.zh.md)

> Target contract: lands with the first framework commit and stays forever; implementation details live in code and tests.

## Responsibilities and boundaries

The server's first domain: two minimal read-only endpoints that walk the whole chain (composition root → domain self-assembly → mount → routing → error envelope), plus the operational probes. Business domains grow in its three-file shape.

- **Owns**: the two endpoints `/api/system/health` and `/api/system/info`.
- **Does not own**: any business data, any write, any state storage; never touches `data/`.

## Core concepts

- `health` is the liveness probe: the Docker healthcheck target, always `{"status":"ok"}`.
- `info` is the runtime identity: version, Node version, start time, uptime — the first thing to check when debugging a deployed instance.
- Domain template: `types.ts` (pure) + `router.ts` + `module.ts` (self-assembly), one line in `main.ts`.

## Interface

All JSON, read-only, no parameters; errors follow the server's standard envelope.

| Method and path          | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `GET /api/system/health` | Liveness probe, `200 {"status":"ok"}`                                 |
| `GET /api/system/info`   | Runtime identity: name / version / node / started_at / uptime_seconds |

## Key rules

- Stateless: neither endpoint reads or writes storage; `started_at` is process start time.
- Every response carries `Cache-Control: no-store`.
- 404/405 match the server-wide shape: unknown paths `PAGE_NOT_FOUND`, method mismatches `METHOD_NOT_ALLOWED`.
- The endpoint paths are stable long-term — the Docker healthcheck depends on them.
