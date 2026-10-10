# Chat Domain: The Unified Conversational Interface

English | [简体中文](chat.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: in-domain decision history (unified conversational interface, read-only tool agent, companion attachments, contextual preview entrance) is in the Decision Records at the end; the todo intent boundary is in the [todo domain doc](todo.md).

## Responsibilities and boundaries

The whole web app has exactly one chat box. The user types any sentence; the system judges the intent automatically (schedule / ledger / memory / notes / todo / none) and produces the matching proposal, follow-up question, explanatory reply (e.g. the memory domain's no-action case renders the AI's explanation as the body, 2026-10-06), or companion-style response — all fully multi-turn.

- Conversation history persists server-side and restores after page refresh.
- The companion has exactly one ongoing conversation — the interface restores the latest session; no session switching/creating/deleting is offered (the server session API remains only to find this one conversation).
- Every domain's browsing capability stays: on-demand preview panels (the five panels — schedule / ledger / memory / notes / todo) + the fullscreen viewer (reusing each domain's views, including month-view keyboard navigation; the board and memory include direct operations on PC — see their feature docs).
- Mobile additionally has a left navigation drawer (2026-10-05, revision of the "contextual preview entrance" decision) and a three-page swipe pager (notes | chat | board): the former is the unified six-domain entrance (the preview trio summons a bottom drawer), the latter two are the resident pages for notes/board.

**Owns**:

- Message sending under `/api/v1/chat/*` (intent-routing dispatch), session management, message queries, card-outcome recording.
- Session and message persistence in `data/chat.db`.
- Attachments (decision "companion attachments"): `/api/v1/attachments*` upload and retrieval, file bodies in `data/attachments/` with metadata in chat.db.

**Does not own**:

- Server-side conversation TTL cleanup policy.
- The ledger structured-entry web form (the endpoint remains for programmatic calls and tests).
- Record editing/deletion, budgets and reports, multi-user.
- Outside-world queries (weather, exchange rates; new tools register later — see the long-term items of the "companion read-only tool agent" decision).

**Unchanged**: the existing proposal pipelines (generate/confirm/cancel) — paths, actions, status codes, and response structures see zero changes; the chat domain only does intent routing and message retention.

## Behavior contract

### Interfaces

All JSON except attachment upload (multipart/form-data — the sole exception to "JSON bodies only", per the "companion attachments" decision); session cookie required when auth is enabled; error envelope `{ error: { code, message } }`:

| Method and path | Request | Success | Failure |
| --- | --- | --- | --- |
| `POST /api/v1/chat/messages` | `{ text, captured_at, timezone, session_id?, attachments? }` (key allowlist; extra keys 400; `attachments` is 1–3 attachment ids; with attachments, `text` may be empty) | `200 { session_id, message: unified envelope }` | `400 INVALID_REQUEST/INVALID_TEXT/TEXT_TOO_LONG/INVALID_CAPTURED_AT/INVALID_TIMEZONE/INVALID_ATTACHMENTS` (over limit / duplicate / not found / already referenced); `404 SESSION_NOT_FOUND`; AI failures `503 AI_NOT_CONFIGURED/AI_UNAVAILABLE/AI_RATE_LIMITED`, `504 AI_TIMEOUT`, `422 INVALID_PARSER_OUTPUT`; `429 RATE_LIMITED` (with `Retry-After`) |
| `POST /api/v1/attachments` | multipart/form-data single file (jpeg/png/webp/gif ≤10MB; pdf/docx/txt/md/epub/mobi ≤20MB) | `200 { attachment: { id, kind: "image" \| "document", name, mime, size_bytes, url } }` (documents synchronously extract and cache text) | `400 INVALID_REQUEST` (multipart missing file); `415 UNSUPPORTED_MEDIA_TYPE` (outside allowlist / not multipart); `413 PAYLOAD_TOO_LARGE` |
| `GET /api/v1/attachments/:id` | — | `200` raw bytes (images inline, documents `Content-Disposition: attachment` with the original name; `Cache-Control: immutable` — the no-store exception for content-addressed ids) | `404 ATTACHMENT_NOT_FOUND` |
| `GET /api/v1/chat/sessions` | — | `200 { sessions: [{ id, title, updated_at, message_count }] }` descending | — |
| `POST /api/v1/chat/sessions` | empty object | `200 { session: { id, title, created_at, updated_at } }` | — |
| `GET /api/v1/chat/sessions/:id/messages?limit=&before=` | limit optional (1–500, default 100); `before` optional cursor (the oldest loaded message id; fetch the earlier page before it for "load earlier" upward paging; an unknown id returns an empty page) | `200 { session_id, messages: ChatMessage[] }` ascending (within the page), `has_more: boolean` marking whether earlier messages exist | `400 INVALID_LIMIT`; `400 INVALID_BEFORE` (empty string); `404 SESSION_NOT_FOUND` |
| `DELETE /api/v1/chat/sessions/:id` | — | `200 { status: "deleted", session_id }` | `404 SESSION_NOT_FOUND` |
| `POST /api/v1/chat/messages/:id/outcome` | `{ status: "committed" \| "canceled" }` | `200 { status: "ok", message_id }` | `400 INVALID_REQUEST`; `404 MESSAGE_NOT_FOUND`; message without a proposal `409 MESSAGE_HAS_NO_PROPOSAL` |

`POST /api/v1/chat/messages` is rate-limited to 20 per 60 seconds per IP (same window as commands/text); session-management endpoints are not limited.

The unified message envelope (the `message` field of successful responses):

```jsonc
{
  "id": "msg_…", "role": "assistant", "content": "reply text",
  "intent": "schedule | ledger | memory | notes | todo | none",
  "questions": ["…"],            // optional: schedule questions[] / ledger question, normalized
  "proposal": {                   // optional
    "kind": "schedule | ledger | memory | notes | todo",
    "proposal_id": "…", "expires_at": "ISO-8601",
    "payload": { /* the domain's own response payload: schedule {summary, changes, requires_month_create}; ledger {transactions}; memory {actions}; notes {entry, append_to, rewrite, remove, merge, new_topic, topic_append} (after no-title, entry is {date, body} with targets named by body excerpts — see the notes "operation framework" revision record; new_topic/topic_append are {name, body} — opening/named-continuation of topic notebooks, see the notes "dual-track storage" decision; absent operation fields are null); todo {action, todo|todos} */ }
  },
  "outcome": null,
  "attachments": [                 // optional ("companion attachments"): attachment references carried by the user message
    { "id": "att_…", "kind": "image | document", "name": "…", "mime": "…", "size_bytes": 0, "url": "/api/v1/attachments/att_…" }
  ],
  "inspect": [                     // optional ("contextual preview entrance"): inspect chips on companion replies
    { "panel": "calendar | ledger | memory | notes | todo", "month": "YYYY-MM | null" }
  ],
  "created_at": "ISO-8601"
}
```

### Key rules

**Intent classification**:

- Input is the user text + recent context; output is `{ intent, self_contained_text }` (folding follow-up fragments into a self-contained sentence).
- Mechanism (decision "self-managed AI JSON protocol"): classification output goes through json_object text + local enum and length validation, never depending on endpoint-native tool-call parsing; one automatic retry on parse failure, and if it still fails, an **honest resend prompt** is stored ("我刚才没听清你这句话，麻烦再说一遍。" — no 5xx, no silently dropped writes; user decision, 2026-10-05); transport errors (timeout / rate limit / unconfigured) report the error envelope as usual.
- Intents `schedule` / `ledger` / `memory` / `notes` / `todo` dispatch to the matching proposal service (reusing the existing generation pipelines and deterministic validation).
- Intent `none` goes to the companion agent (decision "companion read-only tool agent": an agent with read-only tools) — the AI autonomously decides tool calls (at most 3 rounds, each round one JSON: batch data requests `{"calls":[…]}` or a direct answer `{"answer":…}`, per the "self-managed AI JSON protocol" decision), answering from real ledger / routine / memory / notes / todo data — real data only, never fabricated, over-long lists honestly truncated; small talk and knowledge questions get zero-tool direct answers; failures fall back to fixed copy without erroring the user.
- The five-domain boundary precedents live in the intent classifier's prompt (the todo-vs-schedule/memory boundary is in the [todo domain doc](todo.md)).

**Write triggers** (the 2026-09-16 "unified conversational interface" decision established explicit confirmation and tacit approval; the 2026-10-05 addition brought the 30-second auto-write):

- **Explicit confirmation**: the "confirm write" button calls the domain's existing commit endpoint (`proposal_id` only).
- **Tacit approval by next message**: sending the next message counts as accepting all pending proposals. The web submits each pending proposal (oldest to newest) to the matching domain's commit endpoint before sending; any failure (expired/conflict) does not block the new message — a notice only.
- **30-second auto-write**: a proposal shown 30 seconds without cancellation is auto-committed by the server at the deadline — the same commit path as manual confirmation, idempotent; already-cancelled / already-expired / conflicting cases are ruled by each domain's state machine, leaving only a server log, never disturbing the process. The frontend is unaware: an auto-written card still shows buttons — confirming again succeeds idempotently, cancelling reports "already committed"; refresh shows the latest data.
- "Cancel" is the only refusal path and must be clicked before the auto-write (30 seconds). The server never perceives tacit approval (no new endpoints, no contract changes); the 30-second timer lives in the server (the `proposal-lifecycle` kernel and the schedule proposal service).

**Messages and fault tolerance**:

- `outcome` is display metadata: it only affects the final-state rendering of historical cards, never business data; the client reports it after calling the existing commit/cancel successfully.
- The user message persists before the classifier is called. On AI failure, the turn's user message is already stored, no assistant message is produced, no proposal is produced, and the client keeps the input text for retry.
- AI structured output carries three layers of protection: JSON mode, tolerant extraction (fence-stripping + outermost-object fallback), and one automatic retry on parse failure (hardening after the 2026-09-28 "AI returned non-valid JSON" incident; only final failure is 422 with unchanged outward error semantics; after the "self-managed AI JSON protocol" decision, notes/board/ledger/intent-classification/schedule-command parsing all go through the kernel's single `json()` entry).
- The web optimistically renders the user bubble on send and clears the input; a thinking state shows while waiting; the assistant message appends on arrival; on failure the bubble is withdrawn and the original text refilled.

**Proposal card presentation** (revision 2026-09-28, user decision: bare text rows became card containers):

- Schedule: grouped field rows "field old → new" (preserving unrecorded / yes·no / numeric distinctions) with the TTL.
- Ledger: one row per entry; multiple entries carry a total row.
- Memory: action rows.
- Notes: type/title/landing rows (continuations state which entry they extend; rewrites show "old → new" diff rows, [notes domain, "operation framework"](notes.md)).
- Todo: item/due rows. Due dates and landing pages read as in-card data; small inline buttons confirm/cancel.

**Attachments** (decision "companion attachments"):

- Two-stage: first `POST /api/v1/attachments` lands the file and returns an id; sending the message references it in JSON.
- Messages with attachments **skip intent classification** and always go to the companion agent (attachments joining proposals is a long-term item).
- Understanding forks by kind: documents are text-extracted by the server (cached at upload, no re-extraction on reuse) and injected into the existing text model; images go through the vision model via the `TOBY_AI_VISION_MODEL` role override (ADR "unified Responses API") — the original image is injected for the current turn only, later turns keep only the text reply. Unconfigured or unavailable → degrade: the image is still stored, the reply honestly says it cannot see it, no user-facing error.
- Extracted document text shares a 30k-character budget, truncated with a note when over.
- Attachments are one-shot (one id travels with exactly one message); orphan attachments (uploaded but unsent for 24 hours) are cleaned at server startup.

**Inspect chips** (decision "contextual preview entrance"):

- The read-only tools actually called while the companion answers map deterministically to `inspect` chips (all five domains covered; month-type tools carry the month; the AI never annotates — the panel keeps its last month). The web clicks a chip to jump straight to the matching preview panel, positioned to the month.
- The contextual summoning of preview panels is unchanged: inspect chips and the "view" control of confirmed proposals go directly to the panel. The drawer is a **single-panel form** (revision 2026-09-28: the tab bar retired, the title follows the panel, wanting another means saying so in the conversation).
- Mobile takes the **left navigation drawer + three-page swipe pager** form (revision 2026-10-05; paging itself decided 2026-09-28): the top-left hamburger summons the left-swipe navigation, six items matching the desktop activity rail — the "pages" group (notes/chat/board) switches resident pager pages (native scroll-snap, three pages kept alive), the "preview" group (schedule/ledger/memory) summons the bottom drawer, doubling as those three domains' first resident entrance. Notes/board chips and "view" directs switch pages instead (the notes chip still carries month positioning); schedule/ledger/memory chips behave unchanged; the desktop form is unchanged.
- PC at **narrow width (<768px, opening `/` on a phone) is a supplementary form** (revision 2026-10-05, decision "desktop activity rail shell"): the activity rail does not stay; the top bar's hamburger summons a left-slide overlay navigation (z-50 over the main area, six items with the same list and highlight), the main area fills the width; the desktop form (≥768px) is unchanged.

### Exceptions and edges

- **Follow-up fragments**: the user's answers to follow-ups are folded by the classifier into self-contained sentences before dispatch; the folded result still passes the target domain's deterministic validation — no exemptions. **Correction instructions** for the previous turn ("this should be a todo, not a memory") likewise go through the classifier, classifying to the corrected domain and folding the referenced content (precedent 2e, 2026-10-06); when the referenced content is unclear, fall back to none and let the companion respond.
- **Proposal expiry/conflict**: when the in-message card's countdown hits zero, confirm disables; `410/409` errors prompt "please regenerate" in place on the card, the conversation stream keeping the original card as a final-state snapshot. Tacit approval only handles still-valid pending proposals. A card after the server's 30-second auto-write may still show buttons (re-clicking succeeds idempotently — see Write triggers).
- **Process restart**: the in-memory proposal store is lost; historical messages still render cards from `proposal_snapshot` (read-only final state, no confirm button); `data/chat.db` is unaffected.
- **Deleting a session**: a SQLite transaction cascades message deletion; in-flight pending proposals are unaffected (the proposal domain is independent) — only the conversation record disappears.
- **Privacy**: conversation content is personal data, landing in `data/chat.db` (git-ignored); with auth enabled every endpoint sits in the auth scope. The memory domain's sensitive-content policy does not apply to conversation retention — the conversation verbatim is the user's input; the right to delete is deleting the session. Attachments share the boundary: files land in `data/attachments/` (git-ignored), the retrieval endpoint sits in the auth scope; logs never contain attachment content or extracted text.
- **Scanned/encrypted documents**: empty extraction (no text layer) is not a failure — the attachment is stored and the companion honestly says "no readable text layer"; truly reading scans needs the vision model (the image route), not a dedicated OCR.
- **Endpoint leakage incident** (decision "self-managed AI JSON protocol"): if historical messages contain endpoint-leaked internal markers (the DSML family), they are replaced with placeholders before feeding the AI; the companion's exit check intercepts replies containing leak markers (falling back to fixed copy); the chat.db originals are never rewritten.
- Sessions and messages carry no user dimension (single-user local data, matching the memory/ledger convention).

## Security boundaries

- Required: the chat domain writes no business data directly — only its own chat.db; its calls into the proposal pipelines all go through port injection (declared in `domains/chat/ports.ts`, wrapped at assembly); chat domain files import no other business domain.
- Required: the companion agent's (none-path) tools are all read-only — deterministic read functions over ledger / routine / memory, structurally incapable of writing; write intent is diverted into proposal pipelines at intent classification and can never reach the agent.
- Limits (values from the "companion read-only tool agent" decision; the "self-managed AI JSON protocol" changed the mechanism, values unchanged): tool loop ≤3 rounds (the final round's instruction forces an answer); batch calls 1–4 per round; a single tool result refills ≤6000 characters, ≤12000 per round combined; list-type tools ≤50 entries, truncating with `truncated`/`total` markers; output validation (non-empty, ≤800 characters, no leak markers) — invalid output or AI unavailability falls back to fixed copy, never 5xx; before feeding the AI, history messages carrying leak markers are replaced with placeholders (chat.db originals untouched).
- Forbidden: proposal endpoint contract changes — the chat domain changes nothing about the existing generate/confirm/cancel endpoints; clients submit no operations, no file paths, nothing beyond the contract.
- Attachments (decision "companion attachments"): the exception to "JSON bodies only" is limited to `POST /api/v1/attachments` (multipart streaming parsing, size hard-limited at the endpoint layer); storage filenames are server-generated (extension allowlist mapping), clients submit no paths; only the server writes `data/attachments/`; anything outside the format allowlist jpeg/png/webp/gif and pdf/docx/txt/md/epub/mobi is 415; document extraction goes through a one-shot Python subprocess (packages/text-extraction, ADR "Python runtime for document processing"), degrading on failure to no-text-layer without blocking the upload.

## Acceptance

- Automated (passing; see domain and unit tests in `apps/server/test/`, root HTTP integration tests, and rendering tests in `apps/web/test/`): intent dispatch and companion-agent replies (tool-set output budgets and truncation markers, loop-final-round tool collection, capturedAt/timezone pass-through, failure fallback), session management, message validation, six-endpoint HTTP contracts, rate limiting 429 on the 21st, tacit approval before new messages, legacy-hash redirects, three proposal kinds rendered compactly, mounting restores the latest session — all using temporary data directories, never calling real AI.
- Existing proposal endpoint contracts unchanged: the root HTTP integration tests pass verbatim.
- Attachments (decision "companion attachments", passing): full two-stage chain integration (upload → reference → companion reply → history shaping → authenticated retrieval, attachment one-shot-ness), upload edges (415/413/missing file), message-side validation; document extraction through a real Python subprocess (txt/md direct reads, GBK encoding detection, hand-built valid pdf, stored-zip docx and epub fixtures, mobi and bad-file tolerance, interpreter-missing degradation, per the ADR "Python runtime for document processing"); attachment storage registration/claiming/TTL cleanup; web composer paste-upload, pending preview, send-with-id, bubble thumbnails and file cards.
- Inspect chips (decision "contextual preview entrance", passing): agent tool calls → deterministic inspect mapping (with month and multi-panel), message persistence and history read-back, web chip rendering and click-through (panel selection + month positioning), negative assertions that resident entrances (top-bar button / mobile floating button) do not exist.
- Mobile three-page pager and left navigation drawer (revision of "contextual preview entrance", passing): drawer six items with current-page highlight (pages group aria-current, preview group without), "pages" group page switching (notes region active, chat inert), chip-direct pager routing (notes/board switch pages without opening the drawer; other panels still open it and the drawer has no tabs), page-switch round trips without losing drafts or history, navigation "preview" group summoning the bottom drawer (the resident entrance for schedule/ledger/memory).
- PC narrow-width supplementary form (revision of "desktop activity rail shell", 2026-10-05, passing): narrow-screen top bar (hamburger + current view title + exit) mutually exclusive with the activity rail, negative assertion that the rail's six tiles do not stay, hamburger summoning a modal overlay (six items with the same list, current view holding aria-current), Esc collapsing and selection switching whole-page views, no hamburger on the desktop form.
- Awaiting user review (see Git history): manual browser acceptance (real AI, refresh restoring history, one record in each of three domains, follow-up supplementation answered, companion-style small talk and the real classification and reply quality of mood/diary/memo paths, read-only tool Q&A with over-long list truncation notes, decision "companion read-only tool agent"); mobile real-device keyboard: composer and latest message visible, three-page pager swipe feel and chip page-switch positioning, left drawer slide feel and top-left entrance reachability.

## Open questions

- Conversation-history TTL cleanup and auto-archival policy: a candidate awaiting evaluation, see Git history.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-09-16 · The unified conversational interface

**Background**: the original interaction was "three tabs + three form suites" — forms doing AI processing of sentences, not the conversational feel of "instructing the companion"; three entrances forced choosing a domain before expressing; the server side had no session concept, and the three proposal pipelines were single request/response with no multi-turn context or history retention.
**Trade-off**: intent routing on the server (only AI can reliably judge which domain a sentence belongs to, and only the server can carry recent context to fold follow-up fragments into self-contained sentences); a new chat domain rather than folding into proposals (the session/message/intent model is orthogonal to the proposal model; cross-domain calls go through port injection, preserving one-way dependency); an independent `chat.db` (a conversation's lifecycle and protection level differ from fact data); proposal display snapshots stored with messages (proposals are in-memory objects; historical messages must carry their own rendering snapshot); browsing capabilities not deleted but demoted to on-demand panels + the fullscreen layer (the iron law "the read-only month view must not break"). Rejected: pure frontend orchestration (unreliable intent judgment, no multi-turn context), localStorage history (device-bound), layering session onto existing proposal endpoints (polluting a frozen contract). Same-day revision: confirmation semantics widened to two paths — explicit confirmation or **implicit confirmation by sending the next message** — with "cancel" the only refusal; the next day the none path upgraded to companion-style replies (small-talk fallback, fixed-copy fallback on failure).

### 2026-09-18 · The companion read-only tool agent

**Background**: after the unified chat page landed, the companion could "record" but not "answer" — the none path was small talk only; "how much did I spend this month" got no factual answer; the three domains' data sat in databases with deterministic read functions ready, merely unreachable from the conversation path.
**Trade-off**: an agent, not a workflow — the brain is the AI, the hands are tools; a new capability is one registration in the tool list, never a fixed flow (guarding against workflow relapse); riding the none path with no new query intent (zero contract change; write-gating lives at the classifier, the answering brain in the agent — a two-level separation); the permission model deliberately opposite to bash-style agents — tools are read-only by construction, write intent is diverted into proposal pipelines at classification and physically cannot reach the agent; the loop and output disciplines (≤3 rounds with final-round forced answer, tool failures returning data shapes instead of throwing, lists ≤50 with truncation markers, single refill ≤6000 characters, output ≤800 characters) borrow the engineering practice of pi — its cost and termination discipline taken, its universal tool surface left.

### 2026-09-27 · Companion attachments (images and documents)

**Background**: the user wanted to "hand materials to the companion offhandedly — glance at a photo, read a document, keep everything"; the starting point was zero (JSON-only bodies, no attachment storage, no upload entrance); DeepSeek 4.1-series models supported vision, so seeing images needed no new provider.
**Trade-off**: two-stage upload — the multipart exception is limited to the attachment endpoint; sending messages remains JSON referencing ids (paste uploads immediately, resends don't re-upload, the message contract unchanged); the rejected mixed-multipart message endpoint has partial-success retry semantics that are hard to handle. Metadata into `chat.db` (attachments live and die with messages, tiny volume, one less database to maintain); understanding forks — documents text-extracted by the server into the text model, images by role override into the vision model, two lines landing without blocking each other; original images injected for the current turn only (vision tokens are expensive; the companion's text reply already carries the memory of the image); scanned/encrypted files honestly reported as "no readable text layer" — no dedicated OCR (truly reading scans belongs to the image route).

### 2026-09-27 · Contextual preview entrance (inspect chips)

**Background**: preview panels as "popups opened by buttons" had low information value — high opening cost, little gained; the companion agent could already answer "how much this month" with read-only tools.
**Trade-off**: preview bound to context — whichever read-only tools the companion actually called, clickable inspect chips appear on the reply message; the resident button entrance was deleted outright; chips are **deterministically derived** from tool calls (the AI never annotates: chips are interaction entrances — a missing or wrong chip directly harms trust, while tool-call records are system facts with zero hallucination); keeping both resident and contextual entrances would return to the old habit of "popups openable anytime" — the user chose a single mental model. Rejected: AI self-annotation (misses/mislabels), keeping a resident button as fallback, client-side keyword recognition (fragile and misplaced). Entrance forms evolved later: the preview drawer converged to single-panel (09-28), mobile three-page pager (09-28), the desktop activity rail shell (09-30, see that ADR), the mobile left navigation drawer (10-05).

### 2026-10-05 · Self-managed AI JSON protocol (tool-call mechanism switch)

**Background**: in real use the companion replied to the user with endpoint-leaked internal call markers (DSML) as body text — the endpoint's server-side parser failed to turn the model's tool calls into structured data, and inside the leaked block the model had also hallucinated a nonexistent tool name; intent classification rode the same parser, and a leak landing there would leave the user without any reply.
**Trade-off**: see the ADR "self-managed AI JSON protocol" (a cross-cutting decision touching five domains' AI clients and the transport kernel). Chat-domain essentials: the companion tool loop abandoned endpoint-native function_call for one JSON per round (`calls` batch 1–4 / `answer`, mutually exclusive) parsed and executed locally, with the final round's instruction forcing answer; intent classification abandoned the strict envelope for json_object text, and a parse failure (after one retry) stores an honest resend prompt (user decision: no 5xx, no silently dropped writes); the exit triple-check intercepts leak markers, and history carrying markers is cleaned before feeding the AI (in-database originals untouched). Rejected: leak detection as the fix (treating symptoms), retreating to chat.completions (still betting on the server-side parser — kept only as the fallback if blind testing failed), parsing DSML (bound to a provider's internal format).

### 2026-10-05 · The 30-second auto-write (three write triggers)

**Background**: the tacit-approval window was "until the next message" — when the user sent a sentence and left the screen, pending proposals hung until the 10-minute TTL expired void; the things meant to be recorded were precisely the ones not recorded; the user proposed treating silence itself as consent.
**Trade-off**: write triggers became three paths — explicit confirmation, tacit approval by next message (both reusing existing endpoints and frontend behavior), and **auto-commit by the server 30 seconds after display unless cancelled**; the timer lives in the server (the `proposal-lifecycle` kernel's `armAutoCommit` hook + the same timing as the schedule proposal service, `unref` so it never holds process exit, failures leaving only a warn) rather than the frontend — closing the page still writes honestly, and proposals generated via the commands API directly are covered equally; auto-commit rides exactly the same commit path as manual confirmation (idempotence, conflict detection, transactional rollback — no exemptions), with cancelled/expired cases ruled by the state machine, not special-cased by the timer. The cancellation window correspondingly shrank from "before the next message" to within 30 seconds. Rejected: a frontend countdown (dies on page close, two logic sets across apps), voiding at 30 seconds (the opposite direction — replacing tacit approval with timeout rejection, contrary to the need).

### 2026-10-06 · Attachment document extraction moves to the Python runtime

**Background**: Node extraction (mammoth/unpdf) couldn't decode GBK-encoded Chinese txt (mojibake) nor handle the epub/mobi the upcoming novel feature needed (Node has no decent mobi library); the user decided static document processing would unify into the Python package invoked as a server subprocess, chat attachments included.
**Trade-off**: mechanism replaced, contract untouched — `POST /api/v1/attachments` request/response/error codes verbatim unchanged, with the allowlist incidentally extended to epub/mobi (the 20MB document cap unchanged); the extractor went from an in-domain pure module (`attachment-extraction.ts` retired) to an assembly-injected infrastructure kernel (`infrastructure/text-extraction/`), the failure semantics carry over — "return null without throwing, the attachment is stored, the companion honestly reports no text layer", with the new failure shapes (subprocess timeout/crash/missing venv) folded into the same degradation path. Full trade-offs in the ADR "Python runtime for document processing". Rejected: all-Node (no mobi library), a resident Python worker (single user, low frequency — simplicity first).
