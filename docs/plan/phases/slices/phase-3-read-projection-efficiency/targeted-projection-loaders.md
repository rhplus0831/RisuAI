# Targeted Projection Loaders

Status: implemented.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/__tests__/projection.test.ts`
- `src/ts/bootstrap.ts`
- `src/ts/bootstrap.test.ts`

## Scope

Avoid `loadStubProjection()` for command-event resources that can be served by
narrow field selectors or that intentionally have no projected fields.

## Current Behavior

- Empty resources such as `asset` return `mode: "fields"` with `{}` and do not
  read `db.json`; the client only advances its revision cursor.
- Small resources (`preset`, `prompt`, `promptItem`, `persona`,
  `translatorPreset`, `loadout`) read requested persisted fields and preserve
  provider secret masking.
- Character-family resources (`character`, `chat`, `chatFolder`, `message`,
  `generation`) read requested persisted fields, then preserve chat message
  stubs, Hypa V3 removal, optional lorebook stubs, and provider secret masking.
- Mixed broad resources (`scriptDefinition`, `triggerDefinition`, `lorebook`,
  `module`) use the same stubbed field selector. `module` includes
  `characters` for `module.deleted` reference cleanup, and `lorebook` includes
  `loreBookPage` for page/select/delete/reorder events.
- `plugin` uses the persisted field selector with provider secret masking.
- Unknown or sprawling resources such as `settings`, `state`, and
  `pluginStorage` still return `mode: "full"` and use the existing bootstrap
  fallback.

## Protocol Behavior

- Preserve the existing targeted projection response contract:
  `{ revision, resource, mode: "fields", fields }` or `mode: "full"`.
- Any narrowed response containing `characters` still triggers client hydration
  reset and open chat/lorebook rehydration.
- Add future field selectors only when they preserve masking, stubbing, and
  revision-cursor behavior.

## Done When

- Empty, small, character-family, mixed broad, and plugin resources avoid full
  stub projection work.
- Unknown and sprawling resources still self-heal through full bootstrap.
- Tests cover narrow selectors and fallback paths.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
