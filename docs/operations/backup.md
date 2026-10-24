# Backup and Restore

English | [简体中文](backup.zh.md)

## What the backup does

`pnpm run backup` snapshots every domain database in the data root into a
timestamped folder under `backups/`:

```
backups/2026-10-24T12-30-05-000Z/
├── ledger.db        # consistent SQLite snapshot (VACUUM INTO)
├── notes.db
├── domain-file.txt  # non-database files travel as byte copies
└── manifest.json    # file list, sizes, SHA-256 checksums
```

- **Safe while the server runs.** The snapshot is taken with SQLite's
  `VACUUM INTO` — it reads a consistent image of the database (committed
  WAL content included) instead of copying files that may be mid-write.
  The source databases are never written to.
- **`-wal` / `-shm` sidecars are not copied** — the VACUUM snapshot
  already contains their committed content.
- **A backup never overwrites**: the target folder must be empty or
  absent, so every run creates a new timestamped folder.
- **What is not in the backup:** unconfirmed proposals live in server
  memory and are not persisted; a backup only contains data that has been
  written to the database files (see [the actions kernel ADR](../decisions/actions-kernel.md)).

## Run it

```bash
pnpm run backup
```

Defaults: data root `data/` (or `TOBY_DATA_ROOT`), output to
`backups/<timestamp>/`. Overrides:

```bash
pnpm --filter @toby/server run backup -- --data-root <dir> --out <dir>
```

The manifest records each file's SHA-256 checksum — per the AGENTS.md
data rule, compare checksums before and after moving or restoring a
backup.

## Restore

1. Stop the server (`Ctrl+C` / stop the container).
2. Replace the domain database file: copy
   `backups/<timestamp>/ledger.db` over `data/ledger.db` (per domain).
3. Delete stale sidecars `data/ledger.db-wal` and `data/ledger.db-shm`
   if present.
4. Verify the checksum: `sha256sum data/ledger.db` must match the
   manifest entry for the restored file.
5. Restart the server; spot-check the data in the UI.

## Retention

Backups are plain files — archive them anywhere. Old folders are removed
manually (`backups/` is git-ignored); there is no automatic pruning.
