# Client Resource Ownership Next Steps

Date: 2026-08-31

## Current Best Task

Advance the next Workstream 1 character/chat contract family. Prefer selected
character detail plus order/selection metadata before chat transcripts or
mutation bodies, then open exactly one matching owner-consumer slice.

## Released Character-Summary Scope

- Workstream 1 released the summary payload at `159b6eccf`.
- Workstream 2 released singular character/chat/message/Hypa row ownership at
  `7cb62afa8`; embedded copies are pre-extraction recovery only.
- The mobile renderer needs summary fields only. Preserve stable-id navigation,
  search/sort/trash filtering, relative time, shell rows, and selection revision
  fencing.
- Keep character/chat bridges, the aggregate facade, detail/transcript
  hydration, commands, drafts, and generation paths unchanged.
- The mobile renderer completed this bounded migration at `3b74261c1`.

## Released Dependency

- `lorebookPageOwner` is complete at `e751edc69`.
- The standalone read is released at `33d1643ae`, durable command at
  `3f275e9dc`, and route relation at `6a6d0ac1f`.
- The page pointer is an already-singular settings row. Broader lorebook bodies,
  prompt/model/translator owners, and bridge removal remain held.
- Page consumers migrated at `aaf66b75d`; the plugin/database replica and cold
  prompt fallback are explicit compatibility holds, not normal owner reads.

## Not First

- Do not replace `getDatabase()` with a common snapshot or common epoch.
- Do not migrate a production consumer before its complete owner contract and
  Workstream 1/2 cursors exist.
- Do not remove trusted writes, write guards, bridges, or lifecycle flushes.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

Release the next character/chat contract family in Workstream 1 before
migrating another production consumer. Leave all bridges unchanged until
end-to-end continuity and rollback proof exists.
