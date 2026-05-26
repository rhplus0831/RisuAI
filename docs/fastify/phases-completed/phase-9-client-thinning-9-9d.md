# Phase 9-9d - Manual Verification

Date: 2026-05-26

Status: partial. Automated preflight and Fastify-served web verification
passed. Tauri desktop manual verification is still pending because the Tauri
dev webview now launches but the local app stays blocked on the frontend
`appVer` initialization error.

## Summary

- Re-ran the documented 9-9d automated preflight after 9-9c.
- Started a real Fastify static server against an isolated temporary data
  directory and drove the served browser through import, chat creation,
  message append, generation-result persistence, regeneration replacement,
  message edit, character switch, settings mutation, projection refresh, and
  reload persistence.
- Confirmed the Fastify-served browser stayed in server-backed mode and did
  not write through IndexedDB/localForage or OPFS during the manual command
  flow.
- Verified the Tauri frontend bundle still builds with `pnpm tauribuild`.
- Retried the desktop Tauri manual interaction pass after Cargo and the Linux
  Tauri/WebKit/GTK development libraries were installed. The command now
  compiles the Rust app, starts Vite, and launches `target/debug/risuai` under
  Xvfb.
- The app still cannot complete local manual verification because the webview
  hits `Cannot access 'appVer' before initialization` from
  `src/ts/parser/parser.svelte.ts:109` and remains stuck during app load.

## Fastify Web Checks

- App loaded from Fastify static serving at an isolated local server.
- JSON `.risu` import through `/api/v1/import/risusave` returned revision 1.
- Chat creation and user-message append persisted through command routes.
- Generation-result persistence created an assistant row; a second
  generation-result call with `targetMessageId` replaced that row, covering the
  regenerate persistence path.
- Message edit persisted through `PATCH /api/v1/commands/messages/:messageId`.
- Character selection persisted through
  `POST /api/v1/commands/characters/select`.
- A runtime settings mutation persisted through
  `PATCH /api/v1/commands/settings/runtime`.
- Browser projection refreshed from server events/bootstrap and all checked
  state survived reload.
- Storage audit observed no IndexedDB/localForage or OPFS writes in
  server-backed web mode.

## Tauri / Local Checks

- `pnpm tauribuild` passed, with the existing CSS `::highlight`, browser
  externalization, plugin-timing, ineffective dynamic import, and chunk-size
  warnings.
- `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  passed; as before, the command selected the full client suite with 65 files,
  734 tests passed, and 4 skipped.
- `. "$HOME/.cargo/env"` exposes Cargo successfully:
  `cargo 1.95.0 (f2d3ce0bd 2026-03-21)` and
  `rustc 1.95.0 (59807616e 2026-04-14)`.
- pkg-config now sees the needed Linux Tauri/WebKit/GTK chain, including
  `glib-2.0 2.80.0`, `gobject-2.0 2.80.0`, `gtk+-3.0 3.24.41`,
  `webkit2gtk-4.1 2.52.3`, `javascriptcoregtk-4.1 2.52.3`,
  `libsoup-3.0 3.4.4`, `ayatana-appindicator3-0.1 0.5.90`, and
  `librsvg-2.0 2.58.0`.
- `timeout 180s dbus-run-session -- xvfb-run -a env VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm tauri dev`
  passed the former Cargo and pkg-config blockers, compiled the Rust target,
  and launched `target/debug/risuai`.
- The Tauri dev run was stopped after the app logged
  `Cannot access 'appVer' before initialization` from
  `src/ts/parser/parser.svelte.ts:109`.
- A plain Vite browser-local fallback is not a substitute for the Tauri manual
  pass here: the dev page remained on the loading screen with
  `Cannot access 'appVer' before initialization`.

## Verification

- `pnpm smoke:fastify-browser`
  - passed; browser smoke and no-local-storage-write audit stayed green.
- `pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  - passed; command selected 65 files, 734 tests passed, 4 skipped.
- `pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  - passed; 5 files and 56 tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 2 files and 23 tests.
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - passed; command selected 68 files and 1162 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.
- `pnpm tauribuild`
  - passed with existing build warnings.
- `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  - passed; command selected 65 files, 734 tests passed, 4 skipped.

## Follow-Up

- Fix or work around the local/Tauri frontend `appVer` initialization error,
  then complete the Tauri desktop manual checks: import, chat send,
  regenerate, edit, character switch, settings mutation, persist, and reload.
- After Tauri/local manual verification is recorded, continue to 9-9e for
  Phase 9 docs closeout.
