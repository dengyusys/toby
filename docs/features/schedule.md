# Schedule Domain: Daily Status Board

English | [简体中文](schedule.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Answers "what status is each thing today". Items are registered first, each with an ordered status vocabulary; each (item, date) carries at most one status.

- **Owns**: item registry (title + ordered vocabulary), one entry per item per date, inclusive date-range queries, saved view configs (filter/sort/group), cascade deletion.
- **Does not own**: times or timezones, recurrence, reminders or any time-triggered action, calendar sync, custom fields, notifications, multi-user.

## Core concepts

- A vocabulary is closed: a write must use a status currently in the item's vocabulary; the order runs best→worst by convention (clients may color-grade; the text stays authoritative).
- `(item, date)` is the natural key: the write endpoint is an idempotent create-or-update — last write wins, no versioning.
- Views are saved queries — filter/sort/group config only, never a copy of records; the server validates and stores the config, never interprets it.
- Dates are plain local calendar dates (`YYYY-MM-DD`); the domain performs no timezone conversion anywhere.
- Deleting an item removes its entries and prunes its id from every saved view's filter in the same transaction.

## Interface

All JSON behind the default session guard; errors follow the server's standard error body with `errorCode` from this domain's closed union.

| Method and path                                   | Purpose                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/schedule/items`                         | Items in creation order, each with `entryCount` across all dates |
| `POST /api/schedule/items`                        | Register `{title, statuses}`; duplicate title 409                |
| `PATCH /api/schedule/items/:id`                   | Rename and/or revise the vocabulary; at least one field required |
| `DELETE /api/schedule/items/:id`                  | One-transaction cascade; answers `{deletedEntries}`              |
| `PUT /api/schedule/entries`                       | Idempotent set `{itemId, date, status}`; answers the full row    |
| `DELETE /api/schedule/entries/:id`                | Clear one record; missing id 404                                 |
| `GET /api/schedule?from&to`                       | Inclusive range, complete result, sorted date then id            |
| `GET/POST/PATCH/DELETE /api/schedule/views[/:id]` | Saved-view CRUD                                                  |

## Key rules

- Every create/update/delete is one validated transactional repository write — the cascade and the view-filter prune ride the same transaction.
- Title: 1–50 characters after trim, unique by exact match; statuses: 1–8 entries, each 1–30 characters after trim, unique within the item.
- A status still used by any entry cannot be removed or renamed (409 `SCHEDULE_STATUS_IN_USE`).
- Range queries: `from`/`to` both required, inclusive, `from` ≤ `to`, span at most 366 days; no pagination — the response is complete within the range.
- View config: `itemIds`/`statuses` omitted or empty means no filter; OR within each list, AND across the two; `sort: date|title`, `group: none|item|status`; unknown fields are rejected.
- Error codes live in the closed union — `SCHEDULE_ITEM_NOT_FOUND`, `SCHEDULE_ENTRY_NOT_FOUND`, `SCHEDULE_VIEW_NOT_FOUND`, `SCHEDULE_ITEM_DUPLICATE`, `SCHEDULE_STATUS_IN_USE`, `SCHEDULE_INVALID_ITEM`, `SCHEDULE_INVALID_DATE`, `SCHEDULE_INVALID_STATUS`, `SCHEDULE_INVALID_VIEW_CONFIG` — and in the web clients; nowhere else.
