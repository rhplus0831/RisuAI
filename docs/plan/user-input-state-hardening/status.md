# User Input State Hardening Status

Date: 2026-06-17

This workstream is active. Phase 0 is complete as a docs/contract baseline,
Phase 1 is complete as the shared-helper and first rollback-adopter slice, and
Phase 2 is complete as the dirty draft projection slice. The plan consolidates
the input persistence inventory under
`../../user-input-layer-audit/` and stale-state risk review under
`../../user-stale-state-audit/`.

## Snapshot

- Plan state: active, Phase 0 contract decisions complete, Phase 1 complete, and
  Phase 2 dirty draft projection complete. The next active phase is Phase 3
  upload/import/fetch callback freshness. The first Phase 3 slice now guards
  custom background upload/cancel/error callbacks so stale completions cannot
  restore or apply an old custom background after a newer choice. Composer
  paste/menu file actions now guard stale file callbacks by active transcript
  identity and composer mutation version before mutating composer text or
  attachments. Character avatar upload callbacks now guard by latest selected
  file operation, target character id, and avatar snapshot before applying image,
  asset, PNG metadata, or dispatch state. Character additional asset uploads now
  guard editor and chat quick-add completions by latest selected file operation,
  target character id, and additional asset list snapshot before appending to
  live state. Module asset uploads now guard by latest selected file operation,
  target module id, and module asset list snapshot before appending to the open
  module draft. Prompt preset icon uploads now guard by latest selected file
  operation, target preset id, selected-row identity, and image snapshot before
  updating the preset icon. NanoGPT dashboard fetches now guard subscription
  state persistence by a fixed latest-operation token and captured API key before
  writing `nanogptSubscriptionState`. Phase 2 landed character profile draft
  dirty top-level field protection; prompt-template item row dirty projection
  merging; whole-key dirty projection protection for
  `createServerBackedSettingDraft`; selected persona profile dirty projection
  protection; translator preset `name`/`prompt`/`maxResponse` dirty projection
  protection; lorebook entry draft dirty projection merging; and
  selected-character script/trigger live local draft dirty projection merging.
  Phase 1 settings, character, and chat row metadata rollback adoption landed;
  message-target freshness is explicitly deferred to Phase 4.
- Code changes: `src/ts/server/staleStateGuards.ts` and
  `src/ts/server/staleStateGuards.test.ts` add shared stale-state primitives
  and focused helper coverage. `src/ts/server/settingsBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`, `src/ts/characterCommands.ts`,
  and `src/ts/chatCommands.ts` now use `applyAttemptedFieldRollback` for
  attempted settings/profile/row/chat metadata rollback.
  `src/ts/server/characterBridge.svelte.ts` also now tracks dirty top-level
  character draft fields and merges same-character projection reseeds through
  `mergeProjectionIntoDirtyDraft`.
  `src/ts/server/promptTemplateBridge.svelte.ts` now tracks dirty prompt item
  fields per item id from `queuePromptItemProjectionUpdate` and merges same-id
  projection rows so dirty fields are preserved while clean fields and sibling
  rows refresh.
  `src/ts/server/settingsBridge.svelte.ts` now tracks dirty setting draft values
  by helper instance, reasserts dirty values to `DBState.db[key]` after stale
  projection overwrites, clears dirty state when a projection matches the draft,
  and resumes normal clean projection reseeding afterward.
  `src/ts/persona.ts` and `src/lib/Setting/Pages/PersonaSettings.svelte` now
  track dirty selected persona profile fields by persona id, reconcile projection
  epoch changes before the PersonaSettings watcher queues a normal selected
  persona update, and reassert still-dirty selected persona fields through
  trusted projection writes.
  `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte` now tracks
  dirty translator preset fields per preset id, reconciles projection apply
  epochs, reasserts still-dirty values with trusted projection writes, and
  avoids rolling back fields whose dirty state already cleared after projection
  catch-up.
  `src/lib/SideBars/LoreBook/LoreBookData.svelte` and
  `src/ts/server/lorebookBridge.svelte.ts` now merge same-entry projection
  updates into dirty lorebook entry drafts, and `src/lib/SideBars/CharConfig.svelte`
  plus `src/ts/server/scriptDefinitionBridge.svelte.ts` now merge same-row
  selected-character script/trigger projections into dirty local draft rows.
  `src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte` now uses a
  latest-operation token and live placeholder check before async background
  picker/upload continuations apply, restore, or alert.
  `src/lib/ChatScreens/DefaultChatScreen.svelte` now routes menu and paste file
  continuations through a shared guarded apply path that checks latest token,
  active transcript identity, and composer mutation version before appending
  text or inlay asset ids.
  `src/ts/characters.ts` now guards character avatar upload continuations with a
  latest-operation token issued only after a real file selection, target row-id
  checks, and avatar snapshot checks before mutating image, `ccAssets`,
  `extentions.pngExif`, or dispatching character updates.
  `src/ts/server/characterAdditionalAssetUpload.ts` now centralizes additional
  asset upload target capture, latest-operation tracking, snapshot freshness, and
  live-list append behavior for the character editor and chat quick-add paths.
  `src/ts/server/moduleAssetUpload.ts` now centralizes module asset upload target
  capture, latest-operation tracking, snapshot freshness, and live-list append
  behavior for the module asset editor.
  `src/ts/server/promptPresetIconUpload.ts` now centralizes prompt preset icon
  upload target capture, latest-operation tracking, selected row freshness, image
  snapshot checks, and fresh update-index resolution for `BotSettings.svelte`.
  `src/ts/server/nanoGPTDashboardFetch.ts` now centralizes NanoGPT dashboard
  fetch operation tracking with a fixed guard target, captured API key freshness,
  and fresh subscription-state resolution before persistence.
- Verification state: Phase 3 NanoGPT dashboard fetch callback validation is
  recorded in `latest-verification.md`.
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
- [Phase 2](phases/phase-2-dirty-draft-projection.md): complete. Character
  profile draft dirty top-level projection protection, prompt item row
  same-order dirty field merging, generic settings draft whole-key projection
  protection, selected persona profile dirty projection protection, translator
  preset dirty field protection, lorebook entry draft dirty projection merging,
  and selected-character script/trigger live local draft dirty projection
  merging have landed. Remaining create/delete/reorder/import/select,
  module/plugin, callback, chat/message/generation, resync/import/restore,
  navigation, memory, and broad collection behavior is explicitly owned by later
  phases below.
- [Phase 3](phases/phase-3-upload-import-fetch-callbacks.md): active. Upload,
  file, import, decode, and remote-fetch callback tokens. Custom background
  upload/cancel/error callback freshness has landed; composer file callbacks,
  including menu file and pasted image callbacks, now guard stale completions;
  character avatar upload callbacks now guard stale completions; character
  additional asset upload callbacks now guard stale completions; character
  emotion/reference/model assets remain pending; module asset upload callbacks
  now guard stale completions; prompt preset icon uploads now guard stale
  completions; settings media, plugin import/update, import helpers, and
  remaining dashboard/import persistence surfaces remain pending. NanoGPT
  dashboard subscription-state fetch persistence now guards stale completions.
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
- Phase 2 first slice: `createServerBackedCharacterDraft` tracks per-draft
  dirty top-level fields, clears dirty keys on target/full reseed boundaries,
  clears dirty keys when projection matches the local draft value, merges
  same-character projection epochs through `mergeProjectionIntoDirtyDraft`, and
  reasserts still-dirty fields back into the selected character row after a
  projection overwrite.
- Phase 2 prompt-template item row slice: `queuePromptItemProjectionUpdate`
  tracks dirty top-level item fields per prompt item id. `reconcilePromptTemplateDraft`
  clears matching dirty fields when server projection values catch up, merges
  same-id-sequence server rows by id to preserve still-dirty local fields, and
  refreshes clean fields and clean sibling rows. Prompt item create, delete, and
  reorder reconciliation still use the existing full-replacement behavior.
- Phase 2 settings draft slice: `createServerBackedSettingDraft` tracks whether
  its draft has diverged from the last clean seed, preserves that dirty draft
  through stale projection epochs, reasserts the dirty value back to
  `DBState.db[key]` after projection overwrites, clears dirty state when the
  projected value matches the draft, and then allows later clean projection
  reseeds. This is whole-setting-key protection; it does not attempt nested
  field merging inside arbitrary object/array settings.
- Phase 2 selected persona profile slice: `updateSelectedPersonaField` and
  `updateSelectedPersonaLargePortrait` now mark dirty fields by selected persona
  id. `reconcileSelectedPersonaProjectionEpoch` operates only on the current
  selected persona id, clears dirty fields when projection catches up to the
  local dirty value, reasserts still-dirty legacy fields and selected persona row
  fields with trusted projection writes, and lets clean selected-row fields from
  projection remain refreshed. Persona create, delete, reorder, import, icon
  upload, and collection-wide merge semantics remain unchanged.
- Phase 2 translator preset slice: `TranslatorPresetSettings.svelte` tracks
  dirty `name`, `prompt`, and `maxResponse` fields by preset id, reconciles on
  `getServerProjectionApplyEpoch()` changes, preserves still-dirty local values
  while clean preset fields refresh from projection, clears dirty fields when
  projection catches up or the target disappears, and scopes failed debounced
  rollback to fields still dirty with the same attempted value. Create, delete,
  import, and collection-level translator preset behavior remains unchanged.
- Phase 2 live local draft slice: `LoreBookData.svelte` tracks dirty fields for
  the current lorebook entry draft and merges same-entry projection values so
  dirty local fields survive while clean fields refresh. `CharConfig.svelte`
  tracks dirty selected-character script/trigger row fields by row id and merges
  same-id-sequence projection rows so dirty row fields survive while clean
  fields and clean sibling rows refresh. Both paths clear dirty state when
  projection catches up, when targets/rows disappear, or when row sequences no
  longer match and a full reseed is required. Create, delete, reorder, import,
  select, module, plugin, and broad collection rollback behavior remains
  unchanged and is not a Phase 2 blocker.
- Projection-absent optional clean-field deletion remains outside Phase 2. The
  shared merge helper refreshes fields present in the projection surface; it does
  not treat absent optional fields as deletion instructions for this phase.
- Remaining families to track by phase:
  - Phase 3: upload/import/fetch callbacks, including module/plugin
    import/update/fetch/upload callbacks and other file/decode/remote-fetch
    callback freshness.
  - Phase 3 first slice: `CustomBackgroundToggle.svelte` issues a latest
    operation token for each custom background toggle operation and requires the
    upload placeholder to still be current before applying selected images,
    restoring canceled uploads, or showing upload errors.
  - Phase 3 composer file slice: `DefaultChatScreen.svelte` issues a
    latest-operation token per menu/paste file operation, captures the active
    transcript identity and composer mutation version, and drops late file
    results if the user edits the composer, removes attachments, clears/sends, or
    changes chat before the callback resolves.
  - Phase 3 character avatar upload slice: `selectCharImg` issues a
    latest-operation token only after a real file selection, captures the target
    character id and avatar snapshot, parses PNG metadata locally, and rechecks
    freshness before upload completion and before applying image, `ccAssets`,
    `extentions.pngExif`, or dispatching character updates.
  - Phase 3 character additional asset upload slice:
    `characterAdditionalAssetUpload.ts` captures target character id and asset
    list snapshots, issues latest-operation tokens only after selected files
    exist, and lets the editor and chat quick-add paths append uploaded entries
    only when the live selected row/draft and asset list are still fresh.
  - Phase 3 module asset upload slice: `moduleAssetUpload.ts` captures the
    target module id and asset list snapshot, issues latest-operation tokens only
    after selected files exist, and lets the module asset editor append uploaded
    entries only when the open module draft and asset list are still fresh.
  - Phase 3 prompt preset icon upload slice: `promptPresetIconUpload.ts`
    captures target preset id, selected index, and image snapshot, issues
    latest-operation tokens only after a selected file exists, and lets
    `BotSettings.svelte` update the icon only when the selected preset row,
    captured row, and image snapshot are still fresh after decode.
  - Phase 3 NanoGPT dashboard fetch slice: `nanoGPTDashboardFetch.ts` uses a
    fixed latest-operation target instead of raw API keys, captures the key for
    equality checks, rejects stale fetch completions after key changes or newer
    dashboard requests, and preserves fresh empty subscription-state results.
  - Phase 4: `restoreChatScopedState`, chat/message/generation freshness, and
    message update/delete/truncate/replace freshness.
  - Phase 5: create/delete/reorder/import/select and broad collection rollback
    for presets, personas, loadouts, lorebooks, scripts, modules, plugins,
    sidebar chat/folder lists, character list ordering, and module/plugin
    collection/storage/provider/argument behavior.
  - Phase 6: resync/import/restore/navigation/memory, including full
    restore/import/resync, memory jobs, route hydration, and navigation refresh
    fences.
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
