# Library Domain

English | [简体中文](library.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Upload a novel on the PC library page; the server splits it into chapters and produces an "import 《title》, N chapters" proposal card; after confirmation the whole book lands under `data/library/`, then booklist and chapters are browsable. This is phase two of the sleep-reading plan (document kernel → **library** → sleep rewrite → voice).

- Uploading only produces a proposal — nothing lands on disk; not one byte enters `data/library/` before confirmation.
- Splitting happens in a local Python subprocess: when no chapter structure is detected the whole book becomes a single "full text" chapter — import always succeeds, and split quality is honestly visible on the card and in the chapter list.
- No mobile entry this phase (upload/import is a complex operation, PC's job).
- **Does not own**: deleting/renaming books, the sleep rewrite (phase three), voice (phase four); intent routing never reaches the library (import is a file-upload flow, not a one-sentence transaction).

## Core concepts

- One directory per book: `manifest.json` (book and chapter list) + per-chapter Markdown, self-contained and readable.
- Atomic import: write the full staging directory first, then rename into place — an interruption never leaves half a book; the manifest is the sole validity marker.
- Book ids have a strict format, validated before path joining — no path traversal.

## Interface

Upload is multipart (one of the exceptions to "JSON only"); the rest JSON; errors follow the server's standard envelope.

| Method and path                              | Purpose                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/library/books`                    | Upload one file, split, return the import proposal (with chapter-name preview) |
| `POST /api/library/proposals/:id/commit`     | Confirm: the book lands on disk (idempotent)                                   |
| `POST /api/library/proposals/:id/cancel`     | Cancel: nothing lands                                                          |
| `GET /api/library/books`                     | Booklist                                                                       |
| `GET /api/library/books/:id`                 | Book + chapter list                                                            |
| `GET /api/library/books/:id/chapters/:index` | Chapter text                                                                   |

## Key rules

- The splitting subprocess receives only a temp-file path: array arguments, no shell, read-only, no network.
- This domain sends nothing to AI providers; library data never leaves the machine.
- Title priority: the epub's built-in title → the uploaded filename without extension.
- Non-whitelisted formats 415, oversized 413, unreadable files (no text layer/corrupt/DRM/interpreter missing) 422 — no half-uploads.
- The proposal lifecycle matches the other write domains (10-minute TTL, 30-second auto-write, cancel as the only refusal); confirmation carries only the `proposal_id`.
