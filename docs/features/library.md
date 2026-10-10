# Library Domain

English | [简体中文](library.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: the document-extraction runtime is in the "Python runtime for document processing" ADR; the proposal state machine and 30-second auto-write are in the shared kernel and the [chat domain doc](chat.md).

## Responsibilities and boundaries

On the PC library page the user uploads a novel (txt / md / docx / pdf / epub / mobi); the server splits it into chapters via the Python package and produces a pending proposal card "import 《title》, N chapters in all"; on confirmation (or the 30-second auto-write), the whole book lands in `data/library/` — one directory per book, manifest.json + one Markdown per chapter. Afterwards the book list and chapter text are browsable.

- This is phase two of the four-phase novel sleep-aid plan (user decision, 2026-10-05): ① Python document kernel and chat switchover → **② library domain (this phase)** → ③ sleep-aid rewriting (AI pipeline) → ④ voice (TTS, infrastructure positioning).
- Chapter splitting happens on the Python side (epub prefers spine file boundaries with regex only for in-file subdivision; txt goes through chapter-title regex; when no structure is recognized the whole book becomes one "full text" chapter — import always succeeds, and split quality is honestly visible in the card and the chapter list).
- Uploading produces a proposal only — nothing lands; before confirmation not one byte enters `data/library/`.
- Reading happens on the PC library page (chapter list + text); mobile gets no entrance this phase (dual-app split: upload-import is a complex operation belonging to PC; mobile browsing and playback come in later phases).

**Owns**: upload-and-split proposals, confirm/cancel, and book/chapter read surfaces under `/api/v1/library*`; writing and reading the `data/library/` directory; the `TOBY_LIBRARY_DIR` path setting.

**Does not own**: deleting or editing books (evaluated later as needed); sleep-aid rewriting (phase three); voice (phase four); conversation intent routing does not plug into the library (import is a file-upload flow, not a one-sentence affair).

## Behavior contract

### Storage

`data/library/` (overridable via `TOBY_LIBRARY_DIR`), one directory per book:

```text
data/library/lib_<24hex>/
├─ manifest.json   # id, title, source_name, format, created_at,
│                  # char_count, chapters[{index, file, title, chars}]
└─ raw/0001.md…    # chapter text (# title line + body, self-contained and readable)
```

- Import atomicity: write the full content into `lib_<id>.staging/` first, then rename into place — an interruption never leaves half a book; reads treat manifest.json as the sole validity record.
- Book ids accept only `lib_` + 24 hex characters, validated before path joining (no path traversal).
- Chapter filenames start at `0001.md`, zero-padded to four digits.

### Endpoints

| Method and path | Request | Response | Errors |
| --- | --- | --- | --- |
| `POST /api/v1/library/books` | multipart/form-data single file (txt/md/docx/pdf/epub/mobi ≤100MB) | `200 { proposal_id, expires_at, reply, book: { title, source_name, format, chapter_count, char_count }, preview: [first 8 chapter titles] }` (the import proposal after Python splitting; nothing lands) | `400 INVALID_REQUEST` (missing file); `415 UNSUPPORTED_MEDIA_TYPE` (outside the allowlist / not multipart); `413 PAYLOAD_TOO_LARGE`; `422 BOOK_UNREADABLE` (no text layer / corrupt / DRM / interpreter missing), `TOO_MANY_CHAPTERS` (>3000 chapters) |
| `POST /api/v1/library/proposals/{id}/commit` | empty body (URL only) | `200 { status: "committed", id: book id }` (idempotent) | `404/410/409` (not found / expired / cancelled); `409 PROPOSAL_ALREADY_COMMITTED` when cancelled |
| `POST /api/v1/library/proposals/{id}/cancel` | empty body | `200 { status: "canceled" }` | same |
| `GET /api/v1/library/books` | — | `200 { books: [{ id, title, source_name, format, chapter_count, char_count, created_at }] }` (ascending by import time) | — |
| `GET /api/v1/library/books/{id}` | — | `200 { book: { …book-list fields, chapters: [{ index, title, chars }] } }` | `404 BOOK_NOT_FOUND` |
| `GET /api/v1/library/books/{id}/chapters/{index}` | index from 1 | `200 { chapter: { index, title, text } }` (text without the title line) | `404 BOOK_NOT_FOUND / CHAPTER_NOT_FOUND` |

- The proposal lifecycle matches the other write domains (in-memory proposals, 10-minute TTL, 30-second auto-write unless cancelled, cancellation the only refusal); confirm/cancel submit the `proposal_id` only — the client never sends chapter content or file paths.
- Title priority: the epub's dc:title → the uploaded filename sans extension.
- Splitting gets a 60-second timeout (looser than the chat attachment's 30 seconds: whole-book parsing occasionally approaches half a minute); failures uniformly report `BOOK_UNREADABLE` honestly — no half-finished uploads.

## Security boundaries

- Required: only the library domain writes `data/library/`; upload → split → proposal → confirm never bypasses the proposal flow (the iron law "all additions go through proposals" holds for file domains too).
- Required: `POST /api/v1/library/books` is one of the multipart exception endpoints (same origin as attachment upload, per the ADR precedent); proposal confirm/cancel bodies are empty.
- Forbidden: clients submitting storage paths beyond the book id; the splitting subprocess receives only the temp-file path left by the uploaded bytes (spawn with array arguments, no shell, read-only, no network — per the "Python runtime for document processing" ADR).
- Privacy: library content is personal data, landing in `data/library/` (git-ignored); splitting happens in a local process — this domain sends nothing to AI providers (rewriting is phase three; its outbound boundary will be evaluated separately then).

## Acceptance

- Automated (passing, `apps/server/test/library-*.test.ts`): atomic landing / book list / chapter reading with title-line stripping / path-traversal rejection; full HTTP chain through a real Python subprocess (upload-split → proposal → confirm → book/book/chapter reads, idempotent commit, bad file 422, allowlist 415, cancel lands nothing, commit-after-cancel 409, short-deadline auto-write); `config.test.ts` asserts the `libraryDir` group. All using mkdtemp temporary directories — the real `data/` untouched.
- Real sample (2026-10-06): an epub novel (5.9MB, 1.62M characters) split into 399 chapters — titles intact ("序章 追捕〔一〕", "第三十三章 说过不让你死〔完〕"), longest single chapter 11k characters, no giant chapters; this result comes from running the Python `split` directly — the HTTP chain is covered by fixtures.
- Awaiting user review: one manual pass on the PC library page (upload a real book → proposal card → confirm → book list → chapter reading; the 30-second auto-write experience).

## Open questions

- Deleting books / renaming: not this phase; add per the proposal-confirmation system when needed.
- Books with anomalous chapter granularity (pseudo-heading lines in the body over-splitting): accept as-is — phase-three rewriting handles chapters independently, and over-fine granularity is harmless.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-10-06 · Library domain (phase two)

**Background**: phase two of the four-phase novel sleep-aid plan — the user wanted "upload a novel, split it into chapters, keep it" as material for phase-three rewriting and phase-four voice; the format surface (txt/epub/pdf/mobi, later docx/md) connects directly to phase one's "static document processing unified in Python" decision.
**Trade-off**: splitting on the Python side (the epub spine's file boundaries are a structural fact — even books whose headings are images keep their chapter boundaries, with regex only for in-file subdivision and the txt main path; the merge-then-regex approach crashed on a real book — a 220k-character giant chapter — and was abandoned); one import, one proposal (reusing the proposal-lifecycle kernel, the payload travels whole, confirmation is a pure file write — Python never runs on the commit path); storage follows the notes domain's "non-SQLite data domain" precedent (one directory per book + manifest, staging-rename atomic landing); the upload entrance opens on PC only (mobile carries no complex operations — dual-app split); conversation intent not plugged in (a file upload is not a one-sentence affair; forcing it into intent routing would only put proposal cards into a message stream unfit to display them). Rejected: direct write on import without a proposal (violates the iron law); chapter data into SQLite (chapters are file-shaped assets — md is self-contained and readable, and phase-three rewrite products land naturally alongside); write-at-upload-then-rollback (complicated cancellation semantics and leftover garbage).
