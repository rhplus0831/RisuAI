# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-9d - Manual verification, partial** is the latest landed slice.

- Re-ran the 9-9d automated preflight: browser smoke/storage audit,
  server-backed sendChat fixtures, focused memory/generation helpers, focused
  server `.risu` codec/reference tests, focused Fastify
  import/export/bootstrap coverage, and `pnpm check`.
- Manually drove the Fastify-served web path against an isolated server data
  directory for import, chat/message persistence, regenerate replacement,
  message edit, character switch, settings mutation, projection refresh, and
  reload persistence.
- Confirmed the Fastify-served web pass performed no IndexedDB/localForage or
  OPFS writes.
- `pnpm tauribuild` and the focused local backup regression command passed.
- Tauri desktop manual verification is still pending because the Tauri dev
  webview now launches but stays blocked on the local frontend `appVer`
  initialization error from `src/ts/parser/parser.svelte.ts:109`.

## Immediate Pickup

Immediate pickup: **finish 9-9d - Tauri/local manual verification**.

- Fix or work around the local/Tauri frontend `appVer` initialization error,
  then run Tauri and record import, chat send, regenerate, edit, character
  switch, settings mutation, persist, and reload checks.
- The Fastify-served web half of 9-9d is already recorded in
  [`../phases-completed/phase-9-client-thinning-9-9d.md`](../phases-completed/phase-9-client-thinning-9-9d.md).
- Do not advance to 9-9e until Tauri/local manual verification is recorded.
- Do not add compatibility migrations for intermediate Fastify shapes; there
  are no actual Fastify users yet.

## Implementation Notes

- Command code lives in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`. The command map remains the source of
  truth for names, payload behavior, events, and plugin bridge policy.
- Browser projection loads through `src/ts/server/bootstrap.ts` and
  refreshes from `src/ts/server/events.ts`. Debounced re-bootstrap is the
  Phase 9 target; per-event patches remain future work.
- The browser-side trusted write helper lives in
  `src/ts/server/projectionWriteGuard.svelte.ts`; keep it as the narrow
  escape hatch for command-owned optimistic writes, rollbacks, and
  bootstrap projection replacement.
- Tauri keeps its local storage path. Phase 9 gates should be
  server-backed web specific.
- Storage and secret gates are already closed: Fastify startup/save,
  backup/restore, asset reads, RISUSAVE caches/remotes, cold-storage
  helpers, Google Search credential storage, and provider secret
  projection are guarded. Runtime-only browser caches remain local
  because they are not authoritative server database state.
- Use `MASKED_PROVIDER_SECRET`, `maskProviderSecrets()`, and
  `resolveMaskedProviderSecretPlaceholders()` from
  `server/fastify/src/providerSecrets.ts` if later server routes need the
  same projection or placeholder semantics.
- Character scalar patches reject child collections. Chat metadata
  patches reject `message`, `localLore`, `scriptstate`, generation /
  runtime fields, and child collections except the 9-4c `modules` field.
  Use message, generation, scriptstate, lorebook, or module commands for
  those fields.
- MCP module import, MCP asset import, and server-backed `.risum` module
  import remain explicitly unsupported until later slices define
  dedicated server-owned paths.

## Later Queue

1. Finish 9-9d - Tauri/local manual verification.
2. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-9d remainder, use the already-green automated preflight as
the baseline, then perform and record the manual Tauri/local checks:

```bash
pnpm smoke:fastify-browser
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm check
```

Manual Tauri/local checks still to record:

- App loads the expected persisted state after startup.
- Import succeeds or shows the expected unsupported message for the mode.
- Chat send, regenerate, message edit, and character switch behave correctly.
- A representative settings change persists after reload.
- Tauri/local keeps using the local storage path.

Fastify-served web manual checks are already recorded in the 9-9d partial
closeout: import, chat/message persistence, regenerate replacement, message
edit, character switch, settings mutation, projection refresh, reload
persistence, and no IndexedDB/localForage or OPFS writes.

Run the full matrix before closing a parent phase or a broad
server-backed behavior surface:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Latest recorded focused baseline, after 9-9d partial:

- `pnpm smoke:fastify-browser`
  - passed; built the SPA and ran the Playwright browser smoke through Fastify
    startup, bootstrap/events, one runtime settings command, server completion,
    memory reads, `.risu` export, bundle export, asset upload/read, projection
    refresh, and the no-local-storage-write audit. Build emitted existing CSS
    `::highlight`, browser externalization, plugin-timing, ineffective dynamic
    import, and chunk-size warnings.
- `pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  - command selected the full client suite: 65 files, 734 tests passed, 4
    skipped.
- `pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  - 5 files and 56 tests passed.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - 2 files and 23 tests passed.
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - command selected the full Fastify API suite: 68 files and 1162 tests
    passed.
- `pnpm check` - clean.
- Fastify-served web manual command flow
  - passed; isolated server data dir, import revision 1, chat `chat-manual-a`,
    edited user message, regenerated assistant message, selected
    `char-manual-b`, `useServerPromptAssembly: true` after reload, and no
    IndexedDB/localForage or OPFS writes observed.
- `pnpm tauribuild`
  - passed with existing CSS `::highlight`, browser externalization,
    plugin-timing, ineffective dynamic import, and chunk-size warnings.
- `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  - passed; command selected the full client suite: 65 files, 734 tests
    passed, 4 skipped.
- Tauri desktop manual launch
  - partially passed; after Cargo and Linux Tauri/WebKit/GTK libraries were
    installed, `pnpm tauri dev` compiled the Rust target and launched
    `target/debug/risuai` under Xvfb. Manual verification remains blocked
    because the app logs `Cannot access 'appVer' before initialization` from
    `src/ts/parser/parser.svelte.ts:109` and stays on the local app loading
    path.

Last recorded broader baselines:

- 9-6c `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  - passed; command selected the full client suite: 730 tests, 4 skipped.
- 9-6c `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
  - passed; command selected the full Fastify API suite: 1119 tests.
- 9-6c `pnpm check` - clean.
- 9-5d `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-9d.md`](../phases-completed/phase-9-client-thinning-9-9d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
