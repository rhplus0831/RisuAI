# Lorebook Resource Split

Status: implemented (`c3fff925`). The broad `lorebook` resource is split by
write range: global-lorebook commands (create/patch/delete/reorder/select/
entries) emit `globalLorebook` (`['loreBook','loreBookPage']`); character
globalLore edits emit the per-character `characterLorebook` resource (client
parses the `character-lorebook` mode in `fetchServerProjectionResource` and
applies it via `hydrateServerCharacterLorebook`); chat localLore emits `chat`;
module lorebook emits `moduleUpdated`. The legacy `lorebook` resource is kept
broad only as a replay/recovery path (no live command emits it). Proven by
`projection.test.ts` (globalLorebook + characterLorebook narrowing) and
`bootstrap.test.ts` (character-lorebook apply).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  the `lorebook` resource (the broadest) and the resource-split note.
- `server/fastify/src/routes/projection.ts` - `lorebook` →
  `['characters','modules','loreBook','loreBookPage']`.

## Scope

`lorebook` is the broadest projection resource and is shared by two distinct
event families: the global-lorebook commands (Phase 4 `lore_books` table, which
logically change only `loreBook`/`loreBookPage`) and the character/chat/module
`globalLore`/`localLore`/`lorebook` entry-replace commands (Phase 3 single
character/chat row). It cannot be retargeted without splitting it.

Split into:

- `globalLorebook → ['loreBook','loreBookPage']` for the Phase 4 global-lorebook
  commands (create/patch/delete/reorder/entries, lorebooks/:id/select).
- The character/chat/module lorebook events keep (or move to) a per-row resource
  (`characterLorebook` already exists as a template) shipping only the changed
  character or chat row.

## Implementation Scope

- Source files: `server/fastify/src/routes/projection.ts` (new `globalLorebook`
  resource + bespoke branch), the command routes that emit `lorebook` events
  (`server/fastify/src/routes/commands.ts`) to set the correct resource per event,
  client apply in `src/ts/server/projection.ts` if needed.
- Non-scope: the `lore_books` write narrowing (Phase 4 lorebooks slice) and the
  character/chat lorebook writes (Phase 3).

## Protocol Behavior

- After the split, a global-lorebook command refresh ships only
  `['loreBook','loreBookPage']`, never every character and module.
- A character/chat lorebook command refresh ships only the changed row.
- Land the split alongside (not before) the Phase 4 lorebooks write narrowing, so
  the resource and the write agree.

## Done When

- `globalLorebook` resource exists and is emitted by the global-lorebook
  commands; `lorebook` no longer re-ships characters + modules for a global edit.
- Character/chat lorebook events use a per-row resource.
- A projection test asserts a global-lorebook refresh ships only loreBook fields
  and a character-lorebook refresh ships only the changed character.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
