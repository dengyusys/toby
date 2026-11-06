# Chat Domain

English | [简体中文](chat.zh.md)

> Live contract: the conversation model, the routing pipeline, and the failure
> semantics. Implementation details live in code and tests; the write tiers are
> in [write-confirmation-tiers](../decisions/write-confirmation-tiers.md).

## What this is

The app's only input. The user says one sentence in plain language; the server
decides what it means and answers. Business intents go to the domain that owns
them; everything else goes to a read-only agent. A reply is an ordered list of
items — transcript messages, write cards, preview links, notices — and every
write is drafted and executed through the actions kernel. The chat box never
writes directly.

## Responsibilities and boundaries

Chat is the router, not the business logic. It owns the conversation store
(`data/chat.db`, MySQL `toby_chat`) and the turn/item protocol, and reaches
every other domain through injected ports. It does not own those domains'
rules, the actions kernel, AI transport and credentials, or the previews
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
  nothing is reordered or merged. Intent and card outcome ride as turn metadata
  beside the items; the excerpt is derived on read and never stored.
- The turn stores the user's original sentence; the agent receives the
  classifier's self-contained sentence. The UI reads the former, the model the
  latter.

A turn takes one route, so a card and a tool loop never share a turn. The two
live routes: a write turn carries the receipt (or one clarifying question), a
read-only turn carries the tool loop.

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

A ledger write turn — no agent, no tool calls; the ledger port writes and
returns the receipt:

```text
user            "记一笔午饭 30 元"
assistant       text("已记入 1 笔,短时间内在卡片上可撤销。")
proposal_card   born-confirmed receipt + revert_until
```

## Routing

| Intent                           | Answered by               | Reply                                      |
| -------------------------------- | ------------------------- | ------------------------------------------ |
| ledger                           | ledger domain (immediate) | a receipt card, or one clarifying question |
| schedule / memory / notes / todo | not landed                | an on-the-way notice                       |
| none                             | read-only agent           | transcript items plus inspect links        |

The intent set is closed (`ChatIntent`); adding one is a contract change.

- The classifier sees the last three settled exchanges, so a fragment ("今天呀")
  or a correction ("不对,是打车") is folded into a self-contained sentence
  before routing.
- A failed classification or route settles the turn as `none` with a "say that
  again" notice. A failed ledger write is a notice, not an exception.
- Structured AI output rides schema-validated channels (Zod tool arguments, or
  the single-shot `json()` entry): invalid output is corrected once, then
  settles as a notice (see [ai-pi-runtime](../decisions/ai-pi-runtime.md)).

## The agent path

- Read-only tools only. The runtime gate blocks write-intent tools; prohibited
  capabilities (shell, file system, database) are absent as tool definitions,
  not merely blocked.
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
- Inspect links are deterministic: a read-only tool call with a known preview
  target becomes an `inspect_link`; the model never writes or annotates them.
  Today only `ledger_month_report` maps to `ledger:YYYY-MM`.

## Writes and cards

- Every write goes through the actions kernel
  ([write-confirmation-tiers](../decisions/write-confirmation-tiers.md)). The
  chat domain calls a domain port; it never writes.
- **Immediate tier** (ledger today): the write lands at once; the card is a
  born-confirmed receipt with a ten-minute revert window. Revert is the user's
  click and applies the before-snapshot.
- **Gated tier** (future domains): a pending card, 30-second tacit approval,
  explicit confirm, and cancel as the only refusal. The card carries the
  kernel's state machine.
- A card embeds the receipt snapshot at creation time. Restored cards keep their
  recorded status; the revert window is wall-clock, so a restored immediate
  card stays revertible until the window closes.
- `card_outcome` is display metadata the client reports (for example
  `reverted`); it never changes the transcript.

## Sessions and history

- The session list is newest first; each entry carries an excerpt derived from
  its newest turn's user words (60 characters).
- `GET /api/chat/sessions/:id/messages` returns one window: default 20 turns,
  at most 100, oldest → newest inside the window. `before` is a turn id from
  that session; `next_before` appears only when older turns remain, and is
  absent at the beginning.
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
| `POST /api/chat/sessions`             | Create an empty session                                               |
| `GET /api/chat/sessions/:id/messages` | One page of turns (`limit` + `before`)                                |
| `DELETE /api/chat/sessions/:id`       | Delete a session and its transcript                                   |
| `POST /api/chat/messages/:id/outcome` | Record a card's final state (display metadata only)                   |

| Failure                     | Answer                                      |
| --------------------------- | ------------------------------------------- |
| body not `{ text }`         | `400 BAD_REQUEST`                           |
| empty or blank text         | `400 INVALID_TEXT`                          |
| `limit` outside 1–100       | `400 INVALID_TEXT`                          |
| rate limit exceeded         | `429 RATE_LIMITED`                          |
| unknown session             | `404 SESSION_NOT_FOUND`                     |
| unknown turn for an outcome | `404 TURN_NOT_FOUND`                        |
| AI unavailable or failed    | a `notice` item; the request still succeeds |

## Invariants

1. Once a send is accepted, the user's words persist before any AI call; an
   AI failure never loses them.
2. An AI failure is an item, not a 5xx; the request settles with an honest
   notice.
3. Items are returned in production order; tool calls pair by id; an unpaired
   call is "in progress" — no orphan cleanup.
4. The item union is closed; a new kind is a contract change in
   `@toby/contract` and both webs.
5. Writes only through the kernel; the chat domain writes only `chat.db`;
   cross-domain calls go through ports.
6. Intent, card outcome and excerpt are metadata or derived values, never items.
7. Inspect links are deterministic from tool calls; the model never annotates
   them.
8. A turn is created with the user's item in one transaction, and its reply
   items are appended in one completion transaction; intent and outcome are
   metadata updates; deletion is the only removal.

## Out of scope (for now)

- **Attachments**: no upload endpoint, storage, or cleanup exists. The item
  model already tolerates pi-ai image blocks on user messages, but nothing
  produces them.
- **Live streaming and stop**: a send returns the whole turn; there is no chat
  SSE stream and no cancellation.
- **Session switching UI**: the API supports it; the webs do not.
- **Context compaction**: history is bounded by turns and time, not summarized.
