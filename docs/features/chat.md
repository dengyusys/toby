# Chat Domain

English | [简体中文](chat.zh.md)

> Live contract: the conversation model, the routing pipeline, and the failure
> semantics. Implementation details live in code and tests; the write rule is
> one sentence: validation plus one transaction, no confirmation gates.

## What this is

The app's only input. The user says one sentence in plain language; the server
decides what it means and answers. Business intents go to the domain that owns
them; everything else goes to a read-only agent. A reply is an ordered list of
items — transcript messages, write cards, preview links, notices — and every
write is a validated draft executed by the owning domain as one transaction.
The chat box never writes directly.

## Responsibilities and boundaries

Chat is the router, not the business logic. It owns the conversation store
(`data/chat.db`, MySQL `toby_chat`) and the turn/item protocol, and reaches
every other domain through the registered capabilities the composition root
hands it (docs/decisions/chat-domain-capabilities.md) — never through domain
imports. It does not own those domains'
rules, AI transport and credentials, or the previews
themselves. No domain file imports another business domain.

## The conversation model

A **session** is a conversation. A **turn** is one exchange — the user's message
plus the reply items produced by one send. An **item** is one entry of that
reply.

The product surface is one ongoing conversation. The API keeps the multi-session
model (create, list, delete); today both webs restore the newest session and
expose no switcher.

### What a send guarantees

Each send settles exactly one turn. In order:

1. **Accept** — the envelope is `{ text }`; blank text is rejected
   (`400 INVALID_TEXT`) and the sender is rate-limited (`429 RATE_LIMITED`). A
   rejected send stores nothing.
2. **Persist first** — once accepted, the user's message is stored before any
   AI call. A later AI failure cannot lose it.
3. **Decide** — the sentence is classified into one intent plus a
   self-contained sentence, then routed (see Routing).
4. **Answer** — the owning domain or the read-only agent produces the reply
   items, which are committed together.
5. **Settle** — the whole turn is returned. An AI failure is a notice item,
   never a 5xx.

There is no partial turn on the wire: a client receives the whole reply or an
error.

### What a turn contains

- The item union is closed (`packages/contract/src/chat-client.ts`): pi-ai
  transcript messages carried verbatim, plus `proposal_card`, `inspect_link`,
  and `notice`. Adding a kind is an explicit contract change in the package and
  both webs.
- Pairing is structural: an assistant `toolCall` and its result pair by
  `toolCallId`; a call without a result is honestly "in progress". The run's
  system message and its internal user prompt are never items — the turn
  already shows the user's original words.
- Order is production order: items are stored and returned exactly as produced;
  nothing is reordered or merged. Intent rides as turn metadata
  beside the items; the excerpt is derived on read and never stored.
- The turn stores the user's original sentence; the agent receives the
  classifier's self-contained sentence. The UI reads the former, the model the
  latter.
- Assistant `text` blocks are rendered as GFM Markdown by both webs (tables,
  lists, code); raw HTML is never rendered and images degrade to their alt
  text — AI output is untrusted input. User messages and notices stay plain
  text.

A turn takes one route, so a capability write and a tool loop never share a
turn: a write turn carries the receipt (or one clarifying question), a
none-agent turn carries the tool loop — and closes with memory cards when the
agent remembered or forgot mid-conversation (silent learning,
docs/features/memory.md).

A read-only agent turn — thinking, tool calls, one corrected mistake, one
truncated result, two inspect links:

```text
user            "这个月吃饭花了多少？比上个月多吗？"
assistant       thinking + toolCall(c1, ledger_months, {})
toolResult      c1 → "有记录的月份:2026-11、2026-10、2026-09"
assistant       toolCall(c2, ledger_month_report, {month:"2026-11"})
toolResult      c2 → "2026-11 月:…(仅显示前 30 笔,共 42 笔)"   ← truncated, says so
assistant       toolCall(c3, ledger_month_report, {month:"上个月"})
toolResult      c3 → isError: schema rejected "上个月"          ← the model corrects
assistant       toolCall(c4, ledger_month_report, {month:"2026-10"})
toolResult      c4 → "2026-10 月:…"
assistant       text("这个月餐饮 ¥1,240，比上个月多 ¥360。")
inspect_link    c2 → ledger:2026-11
inspect_link    c4 → ledger:2026-10
```

A ledger write turn — no agent, no tool calls; the capability's write path
lands the receipt:

```text
user            "记一笔午饭 30 元"
assistant       text("已记入 1 笔。")
proposal_card   receipt (what landed)
```

## Routing

| Intent | Answered by               | Reply                                                                                              |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------- |
| ledger | ledger domain (immediate) | a receipt card, or one clarifying question                                                         |
| memory | memory domain (immediate) | a receipt card (one per landed change, or an overview list), or one clarifying question            |
| none   | none agent                | transcript items plus inspect links — and memory cards when the agent remembered or forgot mid-run |

The intent set is **registry-derived** (docs/decisions/chat-domain-capabilities.md):
each registered domain capability contributes its id, one classifier prompt
line, the write path and its read-only tools; unregistered intents are not
advertised — the classifier cannot return what it was never shown. Landing a
new domain is a registration in the composition root, not a chat contract
change. An intent string the registry no longer knows degrades to the
read-only agent path, never an error.

- The classifier sees the last three settled exchanges, so a fragment ("今天呀")
  or a correction ("不对,是打车") is folded into a self-contained sentence
  before routing. A folded correction routed to ledger settles as an edit
  when it names a stored entry — never a duplicate recording
  (docs/features/ledger.md).
- A failed classification or route settles the turn as `none` with a "say that
  again" notice. A failed domain write is a notice, not an exception.
- Structured AI output rides schema-validated channels (Zod tool arguments, or
  the single-shot `json()` entry): invalid output is corrected once, then
  settles as a notice (see [ai-pi-runtime](../decisions/ai-pi-runtime.md)).

## The agent path

- Read-only tools, plus the memory write tools (`remember` / `forget`,
  docs/features/memory.md) — silent learning rides whichever agent is already
  running. The runtime gate still blocks every other write-intent tool;
  prohibited capabilities (shell, file system, database) are absent as tool
  definitions, not merely blocked.
- Memory rides along: each run carries a `<memory>` section (conventions in
  full, plus a people/about index) resolved fresh per run; the classifier's
  prompt carries the conventions the same way.
- Bounded: at most 6 turns and 2,000 reply tokens per run; a run that cannot
  settle settles as a notice.
- Context: today's date and weekday in the server's local timezone; a text-only
  replay of the last four settled exchanges (the user's words plus Toby's final
  text — never tool calls, tool results or cards), each text capped at 500
  characters, and only within the last six hours. A longer gap starts a new
  thread.
- Real data only: answers come from tool results; a truncated result says so
  inside the result.
- Failures are honest: unconfigured, timeout, and provider errors become
  fixed-copy notices.
- The toolset is registry-derived: the registered capabilities' tools,
  concatenated in registration order (each domain's read-only tools, plus the
  memory write tools), with each capability's rule snippets appended to the
  agent's base rules.
- Inspect links are deterministic: a read-only tool call with a known preview
  target becomes an `inspect_link`; the model never writes or annotates them.
  The mapping is the capability's own; today ledger maps `ledger_month_report`
  to `ledger:YYYY-MM`.

## Writes and cards

- Every write is one validated, transactional repository write
  . The
  chat domain calls the owning capability's write path; it never writes. The
  receipt copy is the domain's own (`confirmText`), and the card's receipt
  is an opaque passthrough — each web renders it through its card-renderer
  registry keyed by the card's `domain`; an unknown id renders a neutral
  shell.
- Additive and destructive writes take the same path: validation, one
  transaction, receipt. No confirm or cancel wire calls exist. Edits ride
  the same path too — a correction lands as a before/after receipt card.
- A card embeds the receipt snapshot at creation time; restored cards keep
  their recorded snapshot.
- In-run cards: a `remember` / `forget` executed inside a conversational agent
  becomes its own `proposal_card` after the transcript (the capability's
  `cardFor` maps the tool result); today only memory produces them.

## Sessions and history

- The session list is newest first; each entry carries an excerpt derived from
  its newest turn's user words (60 characters).
- `GET /api/chat/sessions/:id/messages` returns the session's newest turns:
  default 20, at most 100, oldest → newest inside the window. No cursor —
  the window is the window.
- A fresh install starts with no session; the first accepted send creates the
  conversation. Refresh restores the newest session. The UI exposes no session
  switching, creation, or deletion yet; the API does.
- Deleting a session removes its turns and items, then the session itself, all
  in one transaction.
- An existing session may be empty (created through the API) and returns an
  empty page; an unknown session answers `404 SESSION_NOT_FOUND`.

## Interface

All JSON; every route follows the session guard; errors use the server's
standard body.

| Method and path                       | Purpose                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/chat/messages`             | Send one sentence; returns the settled turn (rate-limited 20/60 s/IP) |
| `GET /api/chat/sessions`              | Sessions, newest first, with derived excerpts                         |
| `GET /api/chat/sessions/:id/messages` | The session's newest turns (`limit`)                                  |

| Failure                  | Answer                                      |
| ------------------------ | ------------------------------------------- |
| body not `{ text }`      | `400 BAD_REQUEST`                           |
| empty or blank text      | `400 INVALID_TEXT`                          |
| `limit` outside 1–100    | `400 INVALID_TEXT`                          |
| rate limit exceeded      | `429 RATE_LIMITED`                          |
| unknown session          | `404 SESSION_NOT_FOUND`                     |
| AI unavailable or failed | a `notice` item; the request still succeeds |

## Invariants

1. Once a send is accepted, the user's words persist before any AI call; an
   AI failure never loses them.
2. An AI failure is an item, not a 5xx; the request settles with an honest
   notice.
3. Items are returned in production order; tool calls pair by id; an unpaired
   call is "in progress" — no orphan cleanup.
4. The item union is closed; a new kind is a contract change in
   `@toby/contract` and both webs.
5. Writes are one validated repository transaction each; the chat domain writes
   only `chat.db`;
   cross-domain calls go through the registered capabilities.
6. Intent and excerpt are metadata or derived values, never items.
7. Inspect links are deterministic from tool calls; the model never annotates
   them.
8. A turn is created with the user's item in one transaction, and its reply
   items are appended in one completion transaction; intent is a metadata
   update.

## Out of scope (for now)

- **Attachments**: no upload endpoint, storage, or cleanup exists. The item
  model already tolerates pi-ai image blocks on user messages, but nothing
  produces them.
- **Live streaming and stop**: a send returns the whole turn; there is no chat
  SSE stream and no cancellation.
- **Session switching UI**: there is a single ongoing conversation; the webs
  never switch or manage sessions.
- **Context compaction**: history is bounded by turns and time, not summarized.
