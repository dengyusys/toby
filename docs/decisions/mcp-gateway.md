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
  schemas and safety kinds, every write passes the actions kernel, and the
  trust boundary is deterministic server-side validation that treats every
  caller as untrusted. The gateway adds one transport into that machinery and
  grants no new capability: "say one sentence, get a confirmed action" holds
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
   HTTP route already offers (`entry` → `normalizeEntry` → kernel →
   born-confirmed receipt with `revert_until`). No Toby AI run is spent;
   malformed arguments return as tool errors and the correction loop runs in
   the caller — the same bounce-and-retry the pi loop performs internally,
   executed by the caller's model. The sentence channel (`handleWrite`) is
   deliberately not exposed: it would spend a Toby AI run per write and drag
   the clarifying-question loop across two agents.
3. **Reads: a curated allowlist, not automatic exposure.** v1 exposes the
   ledger's three queries and system info. Every exposed schema is a public,
   versioned contract; a domain joins by deliberate listing, so landing a new
   domain never makes it visible to the world for free.
4. **Confirmation semantics are inherited unchanged.** The immediate tier is
   born confirmed with its revert window; the gated tier keeps the 30-second
   tacit approval — no per-origin hold flag. Allowing writes already prices
   the token holder as the user; "silence means go" stays uniform across
   doors. Ledger has no gated operation today; the first gated-tier domain to
   join MCP reopens this line before it ships.
5. **No confirm, cancel, or revert tool — for any caller.** The protocol
   cannot prove a human sits at the far end, so every MCP client is treated
   as an agent, and the red line stands: agents never confirm and never
   revert on the user's behalf. The write tool's result carries the receipt
   (proposal_id, confirm text, revert_until) so the caller can relay the card
   in its own conversation; the user's hands stay on the Toby web UI.
6. **Prohibited capabilities remain absent by construction.** The gateway
   maps existing registry entries to MCP tools; no shell, file, or database
   tool appears because none exists to map. Safety kinds stay an
   internal-agent concept — for MCP callers the allowlist is the policy and
   the kernel is the gate.

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
- **Gated hold flag** — reopened before the first gated-tier domain joins MCP
  (see model §4).
- **Elicitation** — MCP's server→client user-input request could render a
  confirmation in the client's own UI, but it cannot verify a human is
  present and client support is optional.
- **OAuth 2.1** — reopened if the server is ever exposed beyond the personal
  machine.

## Testing

The same regime as everything else: `app.inject` drives the mounted endpoint
with scripted tokens; automated tests use no real MCP client and no real AI.
A live-client smoke run (Claude Desktop or a pi agent) is a manual step with
explicit authorization, reported separately.

## Reference

Adds a second class of client door beside the two web apps. The rules both
doors share: [actions-kernel.md](actions-kernel.md) (the write gate),
[write-confirmation-tiers.md](write-confirmation-tiers.md) (the tiers an MCP
write inherits), [ai-pi-runtime.md](ai-pi-runtime.md) (the trust boundary and
tool kinds). The endpoint contract lands in `docs/features/` together with
the implementation.
