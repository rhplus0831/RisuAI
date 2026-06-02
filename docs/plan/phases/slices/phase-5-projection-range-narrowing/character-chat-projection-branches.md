# Character And Chat Projection Branches

Status: planned. Co-scheduled with Phase 3.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  "Projection-range mismatches" broad resources for `character`, `chat`,
  `chatFolder`, `message`, `generation`.
- `server/fastify/src/routes/projection.ts` - `RESOURCE_PROJECTION_FIELDS` (~34),
  `characterSelection` (~36), `loadCharacterSelectionProjection` (~7, ~282) — the
  bespoke-branch template.
- `src/ts/server/projection.ts`, `src/ts/bootstrap.ts` - client apply.

## Scope

Add narrow per-row branches for the character/chat events the Phase 3 writes
narrow, so a foreign or recovery refresh re-ships only the changed row instead of
the whole stubbed array.

- `character → ['characters','characterOrder','currentChar']` re-ships every
  character on create/update/reorder/modules-reorder. Add a per-character branch
  (template: `characterSelection` / `characterLorebook`).
- `chat`, `chatFolder`, `message`, `generation → ['characters']` re-ship the
  entire stubbed `characters` array on every chat/folder/message change.
  `generation.persisted` is the one that actually fires foreign (server-owned
  post-generation), so it is the most worth a narrow per-chat branch — do it
  first.

## Implementation Scope

- Source files: `server/fastify/src/routes/projection.ts` (new bespoke branches +
  resource entries), the matching loader in `repository.ts` if a new
  `load*Projection` is needed, and the client apply in `src/ts/server/projection.ts`
  if the narrow shape needs handling.
- Each branch ships exactly the fields its Phase 3 write changed.
- Non-scope: changing the write (Phase 3) or the full-bootstrap fallback.

## Protocol Behavior

- A narrow branch only fires for foreign/recovery refresh; the single-writer
  invariant keeps these rare. The branch must reflect every field the narrowed
  write changed, or it desyncs.
- Falling back to the broad resource remains valid where a narrow branch is not
  yet built.

## Done When

- `generation.persisted` has a narrow per-chat projection branch.
- Per-character and per-chat/folder branches exist for the Phase 3 routes.
- A projection test asserts a foreign refresh after each narrowed write reflects
  exactly the changed row.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
