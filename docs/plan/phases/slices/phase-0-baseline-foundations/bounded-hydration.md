# Bounded Hydration

Status: implemented foundation.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/chatMessageHydration.test.ts`

## Scope

Preserve bounded or aggregated hydration behavior. Active-chat and
character-lorebook hydration keep per-id in-flight dedupe and stale-response
drops; all-chat hydration now uses the Phase 3 bulk route instead of one
request per chat. Optional lorebook bulk reduction remains a Phase 3 follow-up.

## Done When

- `BULK_HYDRATION_CONCURRENCY` remains the cap for any remaining per-id fanout,
  currently character lorebook hydration.
- Per-id in-flight dedupe and stale-response drops remain in single-id
  hydration helpers.
- All-chat hydration continues to use the bulk endpoint for unhydrated,
  non-in-flight chats.

## Validation

- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
