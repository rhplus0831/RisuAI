# Bounded Hydration

Status: implemented foundation.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/chatMessageHydration.test.ts`

## Scope

Preserve bounded or aggregated hydration behavior. Active-chat and
active-character-lorebook hydration keep per-id in-flight dedupe and
stale-response drops; all-chat and all-character-lorebook workflows use the
Phase 3 bulk routes instead of one request per record.

## Done When

- Per-id in-flight dedupe and stale-response drops remain in single-id
  hydration helpers.
- All-chat hydration continues to use the bulk endpoint for unhydrated,
  non-in-flight chats.
- All-character-lorebook hydration continues to use the bulk endpoint for
  unhydrated, non-in-flight character lorebooks when `enableLorebookStubs` is
  on.

## Validation

- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
