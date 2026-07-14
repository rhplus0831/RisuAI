# Phase 4: Composed Generation Settings UI

Status: complete.

Goal: keep existing lower-layer generation-settings coverage, then add only the
missing visible composed workflows.

## Existing Coverage To Preserve

- `src/ts/activeChatGenerationSettings.test.ts`
- `src/ts/chatGenerationSettings.test.ts`
- `src/lib/SideBars/chatGenerationSettingsControls.test.ts`
- `src/lib/Setting/pickerGenerationSettings.test.ts`
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/chatCommands.test.ts`
- `src/ts/characters.importChat.test.ts`
- `src/ts/characterCards.pngImport.test.ts`
- `server/fastify/__tests__/commands.test.ts`
- `server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts`
- `server/fastify/__tests__/realmImport.test.ts`

## Missing Composed Contracts

These are current UI-state coverage gaps only. Do not reopen the archived
chat-scoped generation-settings workstream or expand server/state behavior unless
the composed visible proof exposes a current defect.

- Real sidebar path with `Toggles` plus `CustomSidebar` opens preset/persona
  pickers, selects rows, writes active-chat settings, and does not mutate global
  preset/persona state.
- Imported or incomplete chat remains visible, shows incomplete labels/prefill,
  blocks send without clearing the composer, then becomes ready after explicit
  configuration.
- Deleting a referenced preset/persona leaves the chat-owned id intact but
  reports readiness as missing instead of retargeting to a global/default row.
- A chat-row projection update while controls are mounted updates labels and
  toggles without requiring a remount.
- Save failure rollback visibly restores generation-settings labels or controls,
  or the phase records why lower-layer rollback proof plus visible success proof
  is sufficient.

## Anchors

- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/CustomSidebar.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/ts/activeChatGenerationSettings.ts`
- `src/ts/chatGenerationSettings.ts`
- `server/fastify/src/routes/commands.ts`

## Invariants

- Keep these tests few and contract-oriented.
- Do not duplicate server command validation that already exists.
- Avoid snapshot-style assertions over all sidebar text.
- Prefer the selectors from Phase 2.

## Done Criteria

- At least one composed sidebar-to-picker-to-ready DOM test exists.
- At least one imported/incomplete visible remediation path exists.
- Delete invalidation is pinned with server or helper coverage plus a visible
  readiness assertion.
- Projection-update-while-mounted behavior is covered if implementation proves
  feasible without brittle mocks. If skipped, record the reason in
  `latest-verification.md`.

## Slices

- Composed sidebar-to-picker ready path:
  [`slices/phase-4-composed-generation-settings-ui/composed-sidebar-picker-ready.md`](slices/phase-4-composed-generation-settings-ui/composed-sidebar-picker-ready.md).
- Imported/incomplete remediation and send guard:
  [`slices/phase-4-composed-generation-settings-ui/incomplete-remediation-send-guard.md`](slices/phase-4-composed-generation-settings-ui/incomplete-remediation-send-guard.md).
- Delete invalidation readiness:
  [`slices/phase-4-composed-generation-settings-ui/delete-invalidation-readiness.md`](slices/phase-4-composed-generation-settings-ui/delete-invalidation-readiness.md).
- Mounted projection update:
  [`slices/phase-4-composed-generation-settings-ui/mounted-projection-update.md`](slices/phase-4-composed-generation-settings-ui/mounted-projection-update.md).
- Save rollback visibility:
  [`slices/phase-4-composed-generation-settings-ui/generation-settings-rollback.md`](slices/phase-4-composed-generation-settings-ui/generation-settings-rollback.md).
- Proof refresh:
  [`slices/phase-4-composed-generation-settings-ui/phase-4-verification-refresh.md`](slices/phase-4-composed-generation-settings-ui/phase-4-verification-refresh.md).

## Validation

```bash
pnpm exec vitest run \
  src/ts/chatGenerationSettings.test.ts \
  src/ts/activeChatGenerationSettings.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/ts/process/__tests__/sendChat.serverPreview.test.ts \
  src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts
```
