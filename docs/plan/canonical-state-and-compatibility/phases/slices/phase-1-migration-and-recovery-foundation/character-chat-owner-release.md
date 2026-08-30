# Character And Chat Owner Release

Status: released at `7cb62afa8`.

Parent: [Phase 1](../../phase-1-migration-and-recovery-foundation.md)

Depends on: transactional migration foundation at `1e758cd22` and the
character-summary contract at Workstream 1 cursor `159b6eccf`.

## Objective

Release the existing singular character, chat, transcript, and Hypa owners for
resource-specific Workstream 3 consumers without claiming that every
character/chat contract or repair boundary is complete.

## Normal Owner Contract

- `characters` owns character payload and position.
- `chats` owns chat metadata and position under a character.
- `messages` owns transcript rows by stable chat id.
- `chat_hypa_v3` owns the optional per-chat Hypa payload.
- Browser resource state and the aggregate database facade are projections and
  caches; they are not additional persisted owners.
- Character summary/detail, transcript range/bulk, and message-aware repository
  reads reconstruct these rows without writing or repairing ordinary state.

## Import And Recovery Boundaries

- Legacy `db.json` import repairs missing or duplicate chat ids before writing
  character/chat rows or extracting transcript and Hypa rows.
- Repeating startup after a completed import is a no-op and returns the same
  reconstructed state.
- Embedded character/chat/message/Hypa data remains an explicit pre-extraction
  import/recovery fallback. Once SQLite rows exist, normal row owners win; an
  empty transcript is authoritative rather than being repopulated from an
  embedded copy.
- Existing orphan rows, invalid positions, and stale embedded/table divergence
  are not silently repaired by this release. They remain explicit Phase 5/6
  repair/interchange dispositions.

## Validation

- `server/fastify/__tests__/legacyDatabaseImport.test.ts` proves atomic import,
  missing/duplicate chat-id repair, transcript/Hypa preservation, and second
  boot equality.
- `server/fastify/__tests__/messageStore.test.ts` proves split/rejoin behavior,
  SQLite-owned empty transcripts, no-op startup without `db.json`, and stale-row
  reclamation on authoritative writes.
- Resource-read, character-shell, and chat-message hydration suites retain the
  existing lazy and revision-fenced projections.

## Release Scope

This releases the persisted-owner dependency for the existing character-summary
contract. Workstream 3 may migrate summary-only consumers. Character detail,
chat metadata, transcript/message mutation, draft, and generation consumers
remain blocked until their matching Workstream 1 contracts and owner APIs are
released.
