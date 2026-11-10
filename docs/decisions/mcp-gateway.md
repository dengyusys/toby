# The MCP Gateway: Another Client, the Same Rules

English | [简体中文](mcp-gateway.zh.md)

Toby becomes an MCP (Model Context Protocol) server: external agents — Claude
Desktop, Cursor, a pi agent, a self-built app — connect over the standard
protocol and operate Toby through the same machinery the web apps and the
internal agents use.

## Why

- **One protocol instead of per-client wrappers.** Any MCP client can drive
  Toby; Toby ships no bespoke integration per client.
- **The architecture is already shaped for it.** Tools are registered with
  schemas and safety kinds, every write is one validated transaction, and
  the trust boundary is deterministic server-side validation that treats every
  caller as untrusted. The gateway adds one transport into that machinery and
  grants no new capability: "say one sentence, get a landed write" holds
  no matter which client utters the sentence.
- **One process.** The endpoint mounts on the existing Fastify server; no
  second deployment, no second database handle.

## The model

1. **Transport and authentication.** Streamable HTTP at `/mcp` on the single
   server process (`@modelcontextprotocol/sdk`). A static bearer token
   (`TOBY_MCP_TOKEN`); unset keeps the route unmounted — unavailable, not
   broken — the same "unconfigured means unavailable" convention as
   `TOBY_AI_MODEL`. The route deliberately does not sit under `/api` (session
   cookies do not apply to MCP clients) and does not use the public-route
   bypass: a missing or wrong token answers 401. OAuth 2.1, the spec's
   recommendation for HTTP transports, is deferred as disproportionate to a
   single-user self-hosted deployment.
2. **Writes: structured tools — the caller's model fills the form.** The
   ledger's draft schema (already Zod, already JSON-Schema-shaped for pi)
   becomes the MCP tool contract; the call binds to the structured intake the
   HTTP route already offers (`entry` → `normalizeEntry` → repository
   transaction → receipt). No Toby AI run is spent;
   malformed arguments return as tool errors and the correction loop runs in
   the caller — the same bounce-and-retry the pi loop performs internally,
   executed by the caller's model. The sentence channel (`handleWrite`) is
   deliberately not exposed: it would spend a Toby AI run per write and drag
   the clarifying-question loop across two agents.
3. **Reads: a curated allowlist, not automatic exposure.** v1 exposes the
   ledger's three queries and system info. Every exposed schema is a public,
   versioned contract; a domain joins by deliberate listing, so landing a new
   domain never makes it visible to the world for free.
4. **Write semantics are inherited unchanged.** Writes execute directly
   after validation — no confirmation tiers, no tacit windows, nothing to
   inherit differently. An MCP write
   lands exactly as a chat write lands; the caller relays the receipt in its
   own conversation. A sentence the caller cannot resolve gets its own
   clarifying question — the same never-guess policy the internal agents
   follow.
5. **No confirm, cancel, or revert tool — none exists to expose.** Direct
   writes removed them from the
   product entirely; the MCP surface cannot offer what the server does not
   have. The write tool's result carries the receipt (written rows, entry
   values) so the caller can relay it in its own conversation.
6. **Prohibited capabilities remain absent by construction.** The gateway
   maps existing registry entries to MCP tools; no shell, file, or database
   tool appears because none exists to map. Safety kinds stay an
   internal-agent concept — for MCP callers the allowlist is the policy and
   validation is the gate.

## Placement

Two layers, mirroring the AI runtime's split: `infrastructure/mcp/` holds the
protocol glue (SDK wiring, token check, tool-to-MCP schema mapping) and
imports no domain; the tool-set interface is satisfied structurally at the
composition-root level, wired exactly as
[chat-domain-capabilities.md](chat-domain-capabilities.md) wires chat. The
boundary tests keep watching.

## Deliberately not in v1

- **Sentence channel** — reopened when a caller demonstrably lacks its own
  model.
- **Gated hold flag** — obsolete: direct writes removed gated tiers and
  tacit windows entirely.
- **Elicitation** — MCP's server→client user-input request could render a
  clarifying question in the client's own UI, but it cannot verify a human is
  present and client support is optional.
- **OAuth 2.1** — reopened if the server is ever exposed beyond the personal
  machine.

## Testing

The same regime as everything else: `app.inject` drives the mounted endpoint
with scripted tokens; automated tests use no real MCP client and no real AI.
A live-client smoke run (Claude Desktop or a pi agent) is a manual step with
explicit authorization, reported separately.
