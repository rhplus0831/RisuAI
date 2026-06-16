# Asset, Media, Import, And Playground Updates Audit

Date: 2026-06-16

Status: bad

## Scope

Verified custom background uploads, chat media/composer state, asset reference
persistence, Realm/import/export paths, and playground tools that transform or
persist user input.

## Result

Server-side import/export and bundled asset persistence are covered and working,
but several UI-side input updates still fail or can leave stale visible state.

## Findings

- `src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte:15` writes
  `customBackground = '-'` before upload. `server/fastify/src/commands/assets.ts:6`
  allows `'-'` as a persisted clearable asset value, and there is no local
  catch/rollback if `saveImage()` rejects.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:360` clears attached files and
  `:389` clears `messageInput` before append/generation success is known.
  Append rollback removes the optimistic row, not the composer text or files.
- Two-phase bundle asset persistence is normal:
  `server/fastify/src/routes/save.ts:141` registers assets before DB refs and
  `:477` reports persisted refs.
- Realm/import/export is normal in the tested route set:
  `server/fastify/src/routes/realmImport.ts:371` stores Realm id outside stripped
  `risuai`, with coverage in `server/fastify/__tests__/realmImport.test.ts:710`.
- `src/lib/Playground/PlaygroundSubtitle.svelte:253` uses `sourceLang`, but the
  selector at `:428` passes a derived `value` without binding or change
  assignment, so user source-language changes do not apply.
- `src/lib/Playground/ToolConversion.svelte:41` has a visible Delete button with
  no handler.
- `src/lib/Playground/PlaygroundImageTrans.svelte:257` parses edited JSON with
  bare `JSON.parse(output)`, so invalid intermediate edits can throw and leave
  stale canvas output.

## Verification

Targeted tests passed:

- `pnpm exec vitest run src/ts/characterCards.pngImport.test.ts src/lib/Playground/PlaygroundSubtitle.test.ts src/ts/chatCommands.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/realmImport.test.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveBundleImportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts -t "asset reference commands"`
- Main broader plugin/assets/playground run: 11 files, 100 tests passed.

The passing tests mostly cover server persistence and cleanup, not the UI input
failure cases listed above.
