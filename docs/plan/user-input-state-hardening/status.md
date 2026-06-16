# User Input State Hardening Status

Date: 2026-06-17

This workstream is active. Phase 0 is complete as a docs/contract baseline, and
Phase 1 is complete as the shared-helper and first rollback-adopter slice. The
plan consolidates the input persistence inventory under
`../../user-input-layer-audit/` and stale-state risk review under
`../../user-stale-state-audit/`.

## Snapshot

- Plan state: active, Phase 0 contract decisions complete, Phase 1 complete, and
  Phase 2 dirty draft projection next. Phase 1 settings, character, and chat row
  metadata rollback adoption landed; message-target freshness is explicitly
  deferred to Phase 4.
- Code changes: `src/ts/server/staleStateGuards.ts` and
  `src/ts/server/staleStateGuards.test.ts` add shared stale-state primitives
  and focused helper coverage. `src/ts/server/settingsBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`, `src/ts/characterCommands.ts`,
  and `src/ts/chatCommands.ts` now use `applyAttemptedFieldRollback` for
  attempted settings/profile/row/chat metadata rollback.
- Verification state: Phase 1 closeout validation is recorded in
  `latest-verification.md`.
- Highest issue density:
  - Character editor: 52 issue rows, mostly dirty projection and unguarded
    upload callbacks.
  - Chat/messages: composer, file-post, reroll, partial edit, dynamic trigger,
    suggestion, and generation finalization paths.
  - Lorebooks/scripts/modules/plugins: broad rollback and replacement
    collection paths.
  - Presets/personas/loadouts/prompts: dirty projection plus broad collection
    rollback.
  - Sidebar/chat lists: selection, ordering, create/delete/import rollback, and
    character open/select races.
- Healthier baseline:
  - Shared server command transport is revision-gated.
  - Settings bridge scalar writes generally use attempted-value rollback.
  - Raw asset helpers mostly return ids/data; call sites own stale callback
    guards.

## Phase Router

- [Phase 0](phases/phase-0-contract-and-baseline.md): complete. Helper
  contracts, source-row corrections, and first regression fixtures are locked.
- [Phase 1](phases/phase-1-shared-primitives-and-rollback.md): complete. Shared
  helper primitives exist with focused coverage; settings, character, and chat
  row metadata rollback adopters have landed. `restoreChatScopedState` and
  message update/delete/truncate/replace freshness are explicitly deferred to
  Phase 4. Collection rollback domains stay owned by Phase 5. No known code gap
  blocks Phase 1 completion.
- [Phase 2](phases/phase-2-dirty-draft-projection.md): next. Dirty draft
  projection merge behavior.
- [Phase 3](phases/phase-3-upload-import-fetch-callbacks.md): pending. Upload,
  file, import, decode, and remote-fetch callback tokens.
- [Phase 4](phases/phase-4-chat-messages-generation.md): pending. Chat,
  message, reroll, trigger, suggestion, and generation target freshness.
- [Phase 5](phases/phase-5-collection-domains.md): pending. Presets,
  personas, loadouts, lorebooks, scripts, modules, plugins, sidebars, and list
  ordering.
- [Phase 6](phases/phase-6-resync-memory-navigation.md): pending. Full resync,
  backups/imports, memory jobs, and navigation/selection refresh.
- [Phase 7](phases/phase-7-verification.md): pending. Closeout regression,
  browser smoke, and TypeScript proof.

## Implementation Notes

- Treat `Issue` rows in `../../user-input-layer-audit/` as source-row drift
  unless the stale-state audit also marks the path risky. Phase 0 normalized the
  known drift in
  `phases/phase-0-contract-and-baseline.md#baseline-corrections`.
- Phase 1 shared pure helpers now exist in
  `src/ts/server/staleStateGuards.ts`, covered by
  `src/ts/server/staleStateGuards.test.ts`: `createLatestOperationGuard`,
  `isLatestOperation`, `applyAttemptedFieldRollback`,
  `applyAttemptedKeyedListRollback`, `mergeProjectionIntoDirtyDraft`, and
  `createDestructiveRefreshToken`.
- Settings, character, and chat row metadata rollback adopters now use
  `applyAttemptedFieldRollback` for attempted rollback without broadening Phase
  1 into message-body freshness or collection-domain rollback.
- Remaining broad rollback families to track by phase:
  - Phase 4: `restoreChatScopedState` and message
    update/delete/truncate/replace freshness.
  - Phase 5: presets, personas, loadouts, lorebooks, scripts, modules,
    plugins, sidebar chat/folder lists, and character list ordering.
  - Phase 6: full restore/import/resync, memory jobs, route hydration, and
    navigation refresh fences.
- Phase docs that mention `src/ts/process/rerollNavigation.ts` should be read
  as `src/ts/process/rerollNavigation.svelte.ts`.
- First P0 fixture targets are dirty character projection merge,
  composer/file callback active-chat freshness, reroll active-chat guard,
  character asset upload target freshness, and durable generation finalization
  freshness.
- Prefer shared helpers for operation tokens, attempted rollback, and dirty
  projection merge. Use local component tokens only when the lifetime is truly
  local.
- Complete each phase with focused tests or record the exact residual gap here
  before moving on.
- Run Prettier before committing any implementation patch.
