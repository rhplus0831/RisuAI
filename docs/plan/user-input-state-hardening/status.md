# User Input State Hardening Status

Date: 2026-06-18

This workstream is active. Phase 0 is complete as a docs/contract baseline,
Phase 1 is complete as the shared-helper and first rollback-adopter slice,
Phase 2 is complete as the dirty draft projection slice, and Phase 3 is complete
as the upload/import/fetch callback slice. Phase 4 is complete as the
chat/message/generation freshness slice. The plan consolidates the input
persistence inventory under
`../../user-input-layer-audit/` and stale-state risk review under
`../../user-stale-state-audit/`.

## Snapshot

- Plan state: active, Phase 0 contract decisions complete, Phase 1 complete,
  Phase 2 dirty draft projection complete, Phase 3 upload/import/fetch callback
  freshness complete, and Phase 4 chat/message/generation freshness complete.
  The next active phase is Phase 5 collection-domain rollback and projection
  hardening. The first Phase 3 slice
  now guards custom background upload/cancel/error callbacks so stale completions
  cannot restore or apply an old custom background after a newer choice. Composer
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
  writing `nanogptSubscriptionState`. Character emotion image uploads now guard
  by latest selected file operation, target character id, row identity, and
  emotion list snapshot before appending and dispatching. Settings media asset
  uploads for NovelAI character reference, NovelAI i2i base, and WaveSpeed
  reference images now guard by target/context/field snapshots before writing
  image and base64 fields. Character TTS media callbacks now guard VITS model
  registration and GPT-SoVITS reference audio upload by selected row, draft id,
  `ttsMode`, and field snapshots before applying narrow media fields. Custom
  color scheme imports now guard valid application and invalid-file alerts by
  latest selected file operation plus captured theme name/scheme snapshots.
  Plugin import/update flows now guard remote fetch/text, picker/read,
  validation alerts, TypeScript transpile, safety modal, duplicate confirm, and
  final create/update application by latest operation plus plugin-list snapshots.
  Persona icon uploads now guard selected-row and icon snapshots around PNG
  selection and image upload before applying only fresh icon fields.
  BotSettings bias JSON imports now guard selected prompt preset id and bias
  snapshots around JSON file selection/read before mutating `biasDraft.value`.
  Sidebar character-folder image uploads now guard by stable folder id and
  image-field snapshots around image selection, upload, and source resolution
  before applying fresh folder image fields.
  NovelAI `.naiv4vibe` imports now guard provider/model/reference-mode context
  and vibe-field snapshots around file selection/read before merging fresh vibe
  fields into `NAIImgConfigDraft.value`.
  EasyPanel separate-parameters JSON imports now guard base/override slot
  context and target-slot snapshots around file selection/read before applying a
  fresh imported object to only the active slot. The final Phase 3 closeout audit
  found no known live upload/import/fetch callback surface still pending. Audit
  drift is recorded for the BotSettings additional-params import row because the
  live UI has no import button there; the EasyPanel separate-parameters import
  path is now guarded. DefaultChatScreen composer send/continue operations now
  guard delayed clear/restore by active transcript identity, latest operation,
  and composer mutation version, and auto-translate writes now re-check source,
  target, and active transcript freshness before applying. DefaultChatScreen
  reroll actions now guard active chat freshness by identity/scope around
  hydration, tail swaps, tail slices, truncate persistence, and post-truncate
  generation. Partial edit/delete modal saves now carry the originally selected
  source data, source range, operation mode, chat id, and message id, and the
  parent chat row re-checks live target/source freshness before persisting.
  Suggestion send/copy/reroll actions now capture visible suggestion targets,
  re-check active chat and list freshness before mutating/persisting, and
  persist `suggestMessages` with chat-row metadata rollback. Scoped message
  update/delete/truncate/replace-tail/replace-all failures now restore only
  attempted message fields or `chat.message` arrays when the live state still
  matches the attempted optimistic state, preserving newer same-chat metadata and
  divergent message edits. Durable generation finalization now captures
  send/continue/regenerate target snapshots, rejects stale persistence before
  chat-var or message writes, stores snapshots on retry rows, terminalizes stale
  retries, and treats already-persisted retry replays as no-op completions.
  Dynamic rendered chat buttons now capture active character/chat/message target
  identity, drop stale manual/Lua trigger results, apply accepted results to the
  captured chat row with scoped rollback, and keep guarded chat-var/note trigger
  side effects on the returned chat while the target remains fresh. Phase 5 has
  started with script/trigger replacement rollback: character/module script and
  trigger replacements now compare the attempted payload before scoped rollback,
  preserve newer same-target edits, and avoid suppressing watcher dispatch on
  stale no-op rollback. Plugin custom storage PUT, DELETE, and bulk rollback now
  restores only affected keys that still match the attempted optimistic state,
  preserves newer sibling keys, and keeps deferred same-key failures so
  overlapping writes unwind correctly when failures resolve out of order. Plugin
  `realArg`, `enabled`, explicit delete, and provider-selection rollback now
  restores only the targeted field, missing row, or provider value when live
  state still matches the attempted optimistic state. Plugin create, full
  update, reorder, and DB bridge collection patch rollback now use frozen
  attempted payloads plus row, field, and order rollback records; successful
  collection sequence steps are kept when a later step fails.
  Global module create, update, delete, enable, reorder, and plugin DB bridge
  module/enabledModules patch rollback now use attempted row, field,
  enabled-membership, reference, and order records; stale failures preserve newer
  sibling and same-target edits while delete rollback restores
  character/chat/loadout references only when live references still match the
  attempted delete state.
  MCP `risu-set-module-info` now reuses the attempted-aware global module
  rollback sequencer for PATCH plus enable command sequences, preserving an
  accepted module PATCH when a later enable command fails.
  Plugin V2 database settings patches now use settings-specific attempted
  rollback, preserving newer same-key edits and plugin list/provider/storage
  state when a settings command fails.
  Persona create, delete, and reorder command failures now roll back only the
  attempted persona collection change while preserving newer row edits, appended
  rows, and changed selection/profile mirrors.
  Translator preset create, select, delete, and import command failures no
  longer restore broad translator preset snapshots, so newer projected rows,
  selection, and mirrored legacy fields survive stale delayed collection
  failures while scoped field-update rollback remains intact.
  Prompt-template item create, delete, and reorder command failures now roll
  back only the attempted item collection change while preserving newer sibling
  row edits, appended rows, and live row content across reorder rollback.
  Split prompt/model preset array command failures now roll back only targeted
  create/import/delete rows, attempted reorder order, and attempted-matching
  selection/settings instead of restoring legacy bot preset or sibling split
  preset snapshots.
  Legacy bot preset command failures now roll back only attempted saved fields,
  generated copies/created rows, deleted rows, attempted reorder order,
  attempted-matching selection/settings, and unchanged generated split rows from
  legacy extraction instead of restoring whole preset snapshots over newer
  same-row edits, sibling rows, split preset edits, or changed selection.
  Persona residual command failures now roll back only attempted profile row
  fields, profile mirror fields, selection state, icon fields, and unchanged
  import-created rows instead of restoring full persona snapshots over newer
  same-row edits, sibling rows, profile mirrors, or changed selection.
  Scoped lorebook entry replacement failures now roll back only attempted entry
  rows, missing deleted entries, attempted order, or attempted full replacement
  collections instead of restoring broad lorebook snapshots over newer sibling
  entries, same-entry edits, appended entries, or newer order changes.
  Top-level global lorebook list command failures now roll back only attempted
  rows, name fields, order, and selected lorebook id instead of restoring full
  lorebook snapshots over newer sibling rows, row-name edits, appended rows,
  order changes, or newer selection.
  MCP module lorebook, regex, and Lua-trigger command failures now use scoped
  module lorebook/script/trigger rollback snapshots instead of broad lorebook or
  script-definition snapshots.
  MCP character regex and Lua-trigger command failures now use scoped character
  script/trigger rollback records instead of broad script-definition snapshots.
  `applyModule()` command fan-out now uses scoped per-step rollback records so
  accepted child replacements stay applied when a later lorebook/script/trigger
  command fails.
  Chat folder create, update, delete, and reorder command failures now use
  scoped attempted-value rollback instead of restoring broad chat snapshots.
  Chat create, delete, and reorder command failures now use scoped
  attempted-value rollback instead of restoring broad chat snapshots.
  Character sidebar `characterOrder` drag reorder, folder creation/order, and
  folder metadata update failures now use order-only or field-only attempted
  rollback instead of restoring broad character snapshots.
  Character create, create-and-select, import-style create, and permanent
  delete command failures now use attempted row, order-placement, and
  selection-id rollback instead of restoring broad character snapshots.
  Hypa V3 preset array setting failures now roll back append/import,
  rename/settings edit, and delete attempts by preset row or insertion index
  instead of restoring the whole `hypaV3Presets` array.
  Combined sidebar chat/folder drag reorder failures now use focused folder/chat
  order rollback instead of broad chat snapshots.
  Chat fork command failures now use scoped forked-chat row, source metadata
  patch, and branch-folder rollback instead of broad chat snapshots.
  Chat metadata PATCH command failures now use scoped attempted-field rollback
  instead of broad chat snapshots.
  Chat import command failures now use attempted batch rollback and stable
  target capture instead of broad chat snapshots or drifted selection.
  Lorebook import now captures stable character/chat/global-lorebook targets and
  post-picker rollback baselines instead of using stale selected indexes/pages.
  Plugin import/update now waits for accepted server-backed create/update
  commands before reloading the plugin runtime, so failed command rollbacks skip
  loading runtime side effects from rejected optimistic plugin state.
  Server-backed sidebar chat-folder creation now inserts folders
  optimistically, serializes the frozen attempted folder snapshot, and rolls
  back failed creates only when the attempted folder is still unchanged and
  unreferenced by newer chat moves.
  Loadout create, delete, favorite, and apply command failures now roll back by
  attempted row, attempted favorite value, module membership, global-variable
  value, and touch metadata instead of restoring broad loadout/apply snapshots.
  Failed `applyLoadout()` sequences keep earlier server-accepted persona,
  preset, and module commands when a later settings or touch command fails, and
  failed touch rollback restores `lastUsed`, `characterIds`, and
  `lastLoadedLoadoutName` only while those live values still match the attempted
  touch.
  Plugin V2/V3 compatibility character and chat bridge failures now use scoped
  target-row and per-command-step rollback instead of broad state restore.
  Failed plugin character writes restore only attempted target-row fields, and
  failed V3 chat compatibility update sequences preserve earlier accepted
  metadata, message, or scriptstate steps while rolling back only unaccepted
  attempted tail effects.
  Multi-group plugin DB bridge settings failures now preserve earlier
  server-accepted settings groups, roll back failed or unaccepted attempted
  settings keys, and keep newer same-key edits plus unrelated plugin, provider,
  storage, and module state.
  Phase 2 landed character profile draft dirty top-level field protection;
  prompt-template item row dirty projection merging; whole-key dirty projection
  protection for
  `createServerBackedSettingDraft`; selected persona profile dirty projection
  protection; translator preset `name`/`prompt`/`maxResponse` dirty projection
  protection; lorebook entry draft dirty projection merging; and
  selected-character script/trigger live local draft dirty projection merging.
  Phase 1 settings, character, and chat row metadata rollback adoption landed;
  message-target freshness landed in Phase 4.
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
  `src/ts/server/characterEmotionUpload.ts` now centralizes character emotion
  upload target capture, latest-operation tracking, selected row freshness,
  emotion-list snapshot checks, and live-list append behavior for
  `addCharEmotion`.
  `src/ts/server/settingsMediaAssetUpload.ts` now centralizes settings media
  target capture, latest-operation tracking, context/field snapshot freshness,
  and narrow asset-field merging for the guarded `OtherBotSettings.svelte` image
  upload buttons.
  `src/ts/server/characterTtsAssetUpload.ts` now centralizes character TTS media
  target capture, latest-operation tracking, selected row/draft/mode freshness,
  and field snapshot checks for VITS model registration and GPT-SoVITS reference
  audio upload.
  `src/ts/server/colorSchemeImport.ts` now centralizes custom color scheme import
  snapshot capture, latest-operation tracking, JSON shape validation, and fresh
  settings patch resolution. `selectSingleFile` now has an optional
  `onFileSelected` hook so import tokens can start after real DOM selection but
  before file reading resolves.
- `src/ts/server/pluginImport.ts` now centralizes plugin import/update snapshot
  capture, latest-operation tracking, freshness checks, and fresh create/update
  target resolution for `src/ts/plugins/plugins.svelte.ts`.
- `src/ts/server/personaIconUpload.ts` now centralizes persona icon upload
  target capture, latest-operation tracking, selected row uniqueness, icon
  snapshot freshness, and fresh selected-index resolution for
  `src/ts/persona.ts`.
- `src/ts/server/biasImport.ts` now centralizes BotSettings bias JSON import
  target capture, latest-operation tracking, JSON array parsing, and fresh bias
  value resolution for `src/lib/Setting/Pages/BotSettings.svelte`.
- `src/ts/server/characterFolderImageUpload.ts` now centralizes sidebar
  character-folder image upload target capture, latest-operation tracking,
  image-only snapshot freshness, and fresh `{ imgFile, img }` patch resolution
  for `src/lib/SideBars/Sidebar.svelte`.
- `src/ts/server/naiVibeImport.ts` now centralizes NovelAI `.naiv4vibe` import
  target capture, latest-operation tracking, vibe file validation, vibe-field
  snapshot freshness, and fresh narrow patch resolution for
  `src/lib/Setting/Pages/OtherBotSettings.svelte`.
- `src/ts/server/seperateParametersImport.ts` now centralizes EasyPanel
  separate-parameters JSON import parsing, explicit base/override target
  capture, latest-operation tracking, target-slot snapshot freshness, and fresh
  imported-object resolution for `AllSeperateParameters.svelte` and
  `EasyPanel.svelte`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte` now snapshots composer
  send/continue operations, builds outgoing user messages from captured drafts,
  guards stale success clears and failure restores, guards generation-prep
  composer clears, drops stale auto-translate results, and guards reroll wrapper
  continuations across hydration by active transcript identity.
- `src/ts/process/rerollNavigation.svelte.ts` now scopes reroll operations by
  selected character and stable chat id/index fallback, then rejects stale tail
  swaps, tail slices, truncate persistence, and post-truncate generation.
- `src/lib/ChatScreens/partialEditFreshness.ts`,
  `src/lib/ChatScreens/PartialEditController.svelte`, and
  `src/lib/ChatScreens/Chat.svelte` now capture partial edit/delete source
  snapshots and drop stale modal saves before local mutation or message patch
  dispatch.
- `src/lib/ChatScreens/Suggestion.svelte` now uses visible suggestion target
  snapshots and `dispatchUpdateChatRow` for guarded send/copy/reroll and
  generated suggestion persistence.
- `src/ts/chatCommands.ts` now uses attempt-aware scoped message rollback for
  message patch and message-list command failures; `appendCurrentChatEmptyCharMessage`
  mints message ids before optimistic replace-all writes so rollback compares
  equivalent attempted arrays.
- `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/src/generationFinalizationRetry.ts`, and
  `server/fastify/src/db.ts` now carry generation finalization target snapshots
  through durable persistence and retry storage. `durableGeneration.test.ts`
  covers stale send/continue/regenerate finalization and already-persisted
  no-op retry replay.
- `src/lib/ChatScreens/chatButtonTriggerFreshness.ts`,
  `src/lib/ChatScreens/Chat.svelte`, `src/ts/process/triggers.ts`, and
  `src/ts/process/scriptings.ts` now guard rendered dynamic button trigger
  results and deferred chat-var/note side effects by captured chat target
  freshness. `Chat.customHtml.test.ts`, `chatButtonTriggerFreshness.test.ts`,
  and `triggers.projectionGuard.test.ts` cover stale rendered trigger paths.
- `src/ts/server/scriptDefinitionBridge.svelte.ts` now guards character/module
  script/trigger replacement rollback by attempted payload. Failed scoped
  replacements only restore the prior collection when live state still equals
  the attempted payload; `scriptDefinitionBridge.svelte.test.ts` covers positive
  rollback, stale skip, coalesced edits, and stale no-op watcher suppression.
- `src/ts/pluginCommands.ts` now guards plugin custom storage PUT, DELETE, and
  bulk rollback per key and attempted value. It defers non-latest same-key
  failures and cascades exposed failed operations so overlapping writes unwind in
  either failure order; `pluginCommands.test.ts` covers sibling preservation,
  same-key stale skip, both out-of-order PUT failure orders, DELETE rollback,
  and bulk clear/replace rollback.
- `src/ts/pluginCommands.ts` also now guards plugin non-storage rollback for
  `realArg`, `enabled`, explicit delete, and provider selection. It restores
  only fresh attempted fields, reinserts only still-missing deleted plugin rows,
  preserves newer provider/storage/sibling plugin edits, and uses deferred
  same-target failure unwinding for overlapping realArg writes.
- `src/ts/pluginCommands.ts` and `src/ts/plugins/plugins.svelte.ts` now guard
  plugin create, full update, reorder, and DB bridge collection patch rollback.
  Create/update command payloads are frozen before base-revision lookup,
  full-plugin updates roll back only fields still matching attempted values,
  reorder rollback compares attempted order, and collection patch sequences clear
  successful steps before rolling back only a failed or unattempted tail.
- `src/ts/moduleCommands.ts` and `src/ts/plugins/plugins.svelte.ts` now guard
  global module create, update, delete, enable, reorder, and plugin DB bridge
  module/enabledModules patch rollback. Module rollback records are scoped by
  attempted row, field, enabled membership, delete reference, and order state;
  overlapping same-target failures defer behind newer pending operations.
- `src/ts/moduleCommands.ts` and `src/ts/process/mcp/risuaccess/modules.ts` now
  guard MCP module-info PATCH plus enable rollback through the same sequenced
  module rollback steps, replacing the old broad
  `restoreGlobalModuleState(previous)` path for `risu-set-module-info`.
- `src/ts/pluginCommands.ts` and `src/ts/plugins/plugins.svelte.ts` now guard
  plugin DB bridge settings patch rollback by settings-key attempted values
  instead of broad plugin-state snapshots, and multi-group bridge settings
  dispatch now rolls back only the failed or unaccepted group tail.
- `src/ts/characterCommands.ts`, `src/ts/chatCommands.ts`,
  `src/ts/plugins/plugins.svelte.ts`, and `src/ts/plugins/apiV3/v3.svelte.ts`
  now route plugin compatibility character/chat bridge writes through scoped
  target-row and accepted-step rollback helpers instead of broad
  character/chat-state restore.
- `src/ts/persona.ts` now guards persona create, delete, and reorder rollback by
  attempted collection state rather than restoring full persona snapshots.
- `src/ts/persona.ts` also now guards queued persona profile saves, direct
  saves, trigger prompt saves, persona selection, icon saves, and persona import
  create rollback by attempted row, profile mirror, selection, and created-row
  state.
- `src/ts/server/lorebookBridge.svelte.ts` now guards scoped lorebook entry
  replacement rollback for character, chat, global lorebook-entry, and
  module-lorebook entry collections by attempted id, value, and order.
- `src/ts/server/lorebookBridge.svelte.ts` also now guards top-level global
  lorebook create, rename, delete, reorder, and select rollback by attempted
  row, name, order, and selected lorebook id.
- `src/ts/process/mcp/risuaccess/modules.ts` now passes module-scoped lorebook,
  script, and trigger rollback snapshots for MCP module lorebook, regex, and
  Lua-trigger writes.
- `src/ts/process/mcp/risuaccess/characters.ts` now passes character-scoped
  script and trigger rollback snapshots for MCP character regex and Lua-trigger
  writes.
- `src/ts/process/modules.ts` now guards `applyModule()` character lorebook,
  script, and trigger command fan-out with per-step scoped rollback records and
  attempted payload checks.
- `src/ts/chatCommands.ts` now guards chat folder create, update, delete, and
  reorder command rollback by attempted row, metadata, affected chat folder
  assignment, and order state.
- `src/ts/chatCommands.ts` also now guards chat create, delete, and reorder
  command rollback by attempted row, selection, folder assignment, and order
  state.
- `src/ts/characterCommands.ts` now guards character sidebar
  `characterOrder` drag reorder, folder creation/order, and folder metadata
  update rollback by attempted order structure or attempted metadata fields
  instead of broad character snapshots.
- `src/ts/characterCommands.ts` also now guards character create,
  create-and-select, import-style create, and permanent delete rollback by
  attempted row, order placement, and selected character id instead of broad
  character snapshots.
- `src/ts/server/settingsBridge.svelte.ts` now guards Hypa V3 preset array
  rollback by attempted append/import rows, rename/settings edit rows, delete
  insertion index, and shifted `hypaV3PresetId` selection instead of broad
  settings-array restore.
- `src/ts/chatCommands.ts` and `src/lib/SideBars/SideChatList.svelte` now guard
  combined sidebar chat/folder drag reorder rollback by attempted folder order,
  accepted folder-command state, chat order, and folder assignments instead of
  broad chat snapshots.
- `src/ts/chatCommands.ts` now guards chat fork rollback by attempted forked
  chat row, source chat metadata patch, and branch folder creation instead of
  broad chat snapshots.
- `src/ts/chatCommands.ts` now guards direct chat metadata PATCH rollback by
  sanitized attempted fields instead of broad chat snapshots.
- `src/ts/chatCommands.ts` and `src/ts/characters.ts` now guard chat import
  batch rollback and target freshness by accepted step, attempted imported row,
  and stable character id instead of broad chat snapshots or current selection.
- `src/ts/process/lorebook.svelte.ts` now guards lorebook import target
  freshness by stable character, chat, or global lorebook id and captures scoped
  rollback baselines after file-picker awaits.
- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte` now dispatches
  translator preset create, select, delete, and import collection commands
  without broad full-state rollback callbacks while retaining scoped dirty
  field-update rollback.
- `src/lib/Setting/Pages/PromptSettings.svelte` and
  `src/ts/server/promptTemplateBridge.svelte.ts` now guard prompt-template item
  create, delete, and reorder rollback by attempted item id/order instead of
  broad prompt-template snapshots.
- `src/ts/storage/database.svelte.ts` now guards split model/prompt preset
  create, prompt import, delete, select, and reorder rollback by attempted row,
  order, selection, and scalar settings instead of broad preset snapshots.
- `src/ts/storage/database.svelte.ts` also now guards legacy bot preset save,
  copy, select, create, update, delete, reorder, and extraction rollback by
  attempted row, field, order, selection, generated split row, and scalar
  settings state.
- Verification state: Phase 5 multi-group plugin settings rollback
  validation is recorded in `latest-verification.md`.
- Highest issue density:
  - Character editor: 52 issue rows, mostly dirty projection and unguarded
    upload callbacks.
  - Chat/messages: composer, file-post, reroll, partial edit, dynamic trigger,
    suggestion, and generation paths are covered through Phase 4.
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
  message update/delete/truncate/replace freshness landed in Phase 4. Collection
  rollback domains stay owned by Phase 5. No known code gap blocks Phase 1
  completion.
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
- [Phase 3](phases/phase-3-upload-import-fetch-callbacks.md): complete. Upload,
  file, import, decode, and remote-fetch callback tokens have landed for custom
  background, composer file/paste, character avatar/additional asset/emotion/TTS,
  settings media, module asset, prompt preset icon, NanoGPT dashboard fetch,
  custom color scheme, plugin import/update, persona icon, BotSettings bias JSON,
  sidebar character-folder image, NovelAI `.naiv4vibe`, and EasyPanel
  separate-parameters import paths. No known live Phase 3 callback surface
  remains pending after the final audit. The BotSettings additional-params import
  row is audit drift because the live UI has no import button there.
- [Phase 4](phases/phase-4-chat-messages-generation.md): complete. DefaultChatScreen
  composer send/continue clear/restore, auto-translate freshness, and reroll
  active-chat freshness have landed. Partial edit/delete modal freshness has
  landed. Suggestion persistence freshness has landed. Attempt-aware
  chat-scoped message rollback has landed. Durable generation finalization
  freshness has landed. Dynamic rendered button trigger freshness has landed.
  Composer file and paste callbacks are already covered by Phase 3. No known
  code gap blocks Phase 4 completion.
- [Phase 5](phases/phase-5-collection-domains.md): active. Sidebar/import
  collection flows remain here. Script/trigger replacement rollback, plugin
  custom storage plus
  non-storage and collection rollback slices, global module/MCP module-info,
  plugin DB bridge settings, persona collection, and translator preset
  collection rollback slices have landed. Prompt-template item collection
  rollback, split prompt/model preset array rollback, legacy bot preset
  rollback, persona residual command rollback, scoped lorebook entry replacement
  rollback, top-level global lorebook list rollback, and MCP module lorebook,
  regex, and Lua-trigger rollback have also landed. MCP character regex and
  Lua-trigger rollback has also landed. `applyModule()` multi-domain rollback
  has also landed. Chat folder command rollback and chat list command rollback
  have also landed. Character sidebar order/folder metadata rollback has also
  landed. Character list create/delete/import rollback has also landed. Hypa V3
  preset array rollback has also landed. Combined sidebar chat/folder reorder
  rollback has also landed. Chat fork rollback has also landed. Chat metadata
  PATCH rollback has also landed. Chat import flow rollback has also landed.
  Lorebook import target freshness has also landed. Plugin import/update runtime
  reload ordering has also landed. Sidebar chat-folder creation optimism,
  loadout create/delete/favorite/apply rollback, and plugin compatibility bridge
  scoped rollback have also landed. Multi-group plugin settings rollback has
  also landed.
- [Phase 6](phases/phase-6-resync-memory-navigation.md): pending. Realm, backup,
  and local bundle restore/import resyncs; character/chat import
  refresh/navigation edges; memory job list/progress ordering; route/selection
  hydration; welcome/onboarding delayed setup; and DevTool autopilot long-loop
  chat targeting remain here.
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
  - Phase 3: complete. Upload/import/fetch callbacks, including module/plugin
    import/update/fetch/upload callbacks and other file/decode/remote-fetch
    callback freshness, have no known live pending surface after final audit.
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
  - Phase 3 character emotion upload slice: `characterEmotionUpload.ts` captures
    target character id, row index, and emotion image list snapshot, issues
    latest-operation tokens only after selected files exist, and lets
    `addCharEmotion` append uploaded entries and dispatch only when the selected
    row and live emotion list are still fresh.
  - Phase 3 settings media asset upload slice: `settingsMediaAssetUpload.ts`
    captures target ids, overwritten image/base64 fields, and mode/model context
    snapshots for the NovelAI character reference, NovelAI i2i base, and
    WaveSpeed reference image buttons. `OtherBotSettings.svelte` now selects
    files before issuing upload tokens, checks freshness around `saveAsset`, and
    applies only a fresh narrow merge into the active settings draft.
  - Phase 3 character TTS media slice: `characterTtsAssetUpload.ts` captures
    target character id, row index, draft id, `ttsMode`, and VITS/ref-audio field
    snapshots. `CharConfig.svelte` now selects files before issuing tokens,
    checks freshness around VITS model registration and reference audio
    `saveAsset`, and applies only `character.vits` or
    `gptSoVitsConfig.ref_audio_data` when the draft is still fresh.
  - Phase 3 custom color scheme import slice: `colorSchemeImport.ts` captures
    theme name/scheme snapshots, starts latest-operation tokens only after a real
    JSON file is selected, validates imported scheme shape, and lets
    `importColorScheme` apply or alert only when the theme state is still fresh.
  - Phase 3 plugin import/update slice: `pluginImport.ts` captures plugin-list
    snapshots, starts latest-operation tokens before remote update fetches or
    after real file picker selection, and lets `importPlugin` apply or alert only
    when plugin state is still fresh across read, transpile, safety modal,
    duplicate confirm, and final create/update application.
  - Phase 3 persona icon upload slice: `personaIconUpload.ts` captures selected
    persona id, legacy `userIcon`, and selected row icon snapshots, starts tokens
    only after a real PNG file is selected, and lets `selectUserImg` apply only
    fresh icon fields while preserving same-persona text edits made during
    upload.
  - Phase 3 BotSettings bias import slice: `biasImport.ts` captures selected
    prompt preset id and current bias snapshots, starts tokens only after a real
    JSON file is selected, preserves the prior JSON-array acceptance behavior,
    and lets `BotSettings.svelte` mutate `biasDraft.value` only while preset and
    bias state are fresh. The stale-audit additional-params import row is source
    drift; the live additional-params block currently has no import button.
  - Phase 3 sidebar character-folder image upload slice:
    `characterFolderImageUpload.ts` captures stable folder id and image-field
    snapshots only, starts tokens from `selectSingleFile`'s `onFileSelected`
    hook after a real image file is selected, tolerates reorder/rename/color
    changes with unchanged image fields, and lets `Sidebar.svelte` apply only a
    fresh `{ imgFile, img }` patch by folder id.
  - Phase 3 NovelAI `.naiv4vibe` import slice: `naiVibeImport.ts` captures
    provider/model/reference-mode context and vibe-field snapshots only, starts
    tokens from `selectSingleFile`'s `onFileSelected` hook after a real vibe file
    is selected, validates imported vibe files, suppresses stale invalid-file
    alerts, and lets `OtherBotSettings.svelte` merge only fresh vibe fields while
    preserving unrelated NAI image config edits.
  - Phase 3 EasyPanel separate-parameters import slice:
    `seperateParametersImport.ts` parses JSON objects only, captures explicit
    base or override slot identity, parameters-tab state, by-model toggle,
    active selector, and target-slot snapshot only, starts tokens from
    `selectSingleFile`'s `onFileSelected` hook after a real JSON file is
    selected, and lets `EasyPanel.svelte` replace only the fresh active base slot
    or override model slot while preserving unrelated slots.
  - Phase 4 DefaultChatScreen composer freshness slice: composer send/continue
    operations capture active transcript identity, latest-operation token,
    composer mutation version, text, translated text, and files. Send builds the
    outgoing message from the captured snapshot; delayed append success/failure
    and generation-prep clears mutate the composer only while fresh.
    Auto-translate writes re-check active transcript, source text, and target
    field version before applying delayed results.
  - Phase 4 reroll active-chat slice: `DefaultChatScreen.svelte` snapshots
    active transcript identity around reroll hydration, and
    `rerollNavigation.svelte.ts` issues selected-character/chat-scoped operation
    tokens before reroll, unreroll, new reroll, and candidate-selection work.
    Tail swaps, tail slices, truncate persistence, and post-truncate generation
    now apply only while the captured target is still fresh.
  - Phase 4 partial edit/delete modal slice: `PartialEditController.svelte`
    captures the selected source data/range/mode/chat id/message id when an edit
    or delete operation opens. `Chat.svelte` resolves the save through
    `partialEditFreshness.ts` against the current live chat/message and drops
    stale saves before local display mutation or message update dispatch.
  - Phase 4 suggestion persistence slice: `Suggestion.svelte` snapshots the
    selected character/chat and visible suggestion list before send/copy/reroll
    actions, drops stale action continuations, and persists `suggestMessages`
    with `dispatchUpdateChatRow` so rollback is limited to chat-row metadata.
  - Phase 4 message rollback slice: scoped message update/delete/truncate,
    replace-tail, and replace-all failure rollbacks now restore only attempted
    message fields or `chat.message` arrays, and only while live message state
    still equals the attempted optimistic state.
  - Phase 4 generation finalization slice: durable generation send/continue/
    regenerate finalization captures target snapshots, persists them on retry
    rows, rejects stale target rows before chat-var/message writes, marks stale
    retry rows terminal, and treats already-persisted retry replays as no-op
    completions without revision or command-event churn.
  - Phase 4 dynamic rendered button trigger slice: custom rendered
    `risu-trigger`/`risu-btn` buttons capture active character/chat/message
    identity before awaits, drop stale results after active target changes, apply
    fresh results to the captured chat row, and defer guarded chat-var/note side
    effects into the returned chat.
  - Phase 4 is complete.
    Composer file and paste callbacks are already covered by Phase 3.
  - Phase 5 first slice: `scriptDefinitionBridge.svelte.ts` now captures the
    attempted character/module script or trigger payload before replacement
    dispatch and only applies scoped rollback when live state still matches that
    attempted payload. Coalesced edits keep the pre-first-edit baseline plus the
    final attempted payload; stale no-op rollback does not suppress newer
    watcher dispatch.
  - Phase 5 plugin storage slice: `pluginCommands.ts` now captures per-key
    rollback records for plugin custom storage PUT, DELETE, and bulk operations.
    Failed operations restore only keys whose live state still matches the
    attempted optimistic value or missing state, preserve newer sibling keys, and
    defer non-latest same-key failures so overlapping failed writes unwind back
    to the original value regardless of response order.
  - Phase 5 plugin non-storage slice: `pluginCommands.ts` now captures
    attempted rollback records for plugin `realArg`, `enabled`, explicit delete,
    and provider selection. Failed operations restore only fresh attempted
    fields, reinsert only still-missing plugin rows, preserve newer
    provider/storage/sibling plugin edits, and defer overlapping same-target
    failures.
  - Phase 5 plugin collection slice: plugin create, full update, reorder, and
    DB bridge collection patch rollback now capture attempted row, field, and
    order records. Direct create/update payloads are frozen before base-revision
    lookup, and collection patch sequence rollback keeps earlier successful
    server-accepted steps while rolling back only the failed or unattempted tail.
  - Phase 5 module command slice: global module create, update, delete, enable,
    reorder, and plugin DB bridge module/enabledModules patch rollback now
    capture attempted row, field, enabled-membership, reference, and order
    records. Failed module commands preserve newer same-target and sibling edits,
    delete rollback restores character/chat/loadout references only while live
    references still match the attempted delete state, and overlapping failures
    unwind in response order.
  - Phase 5 MCP module-info slice: `risu-set-module-info` now sends module PATCH
    and enable command pairs through the attempted-aware module rollback
    sequencer. A failed PATCH restores only attempted fields and unattempted
    enable state; a later failed enable leaves an accepted PATCH intact.
  - Phase 5 plugin DB bridge settings slice: Plugin V2 database settings patches
    now capture previous and attempted settings values before optimistic bridge
    writes. Failed settings commands restore only still-attempted settings keys
    and no longer restore plugin rows, provider selection, or custom storage.
  - Phase 5 persona collection slice: persona create, delete, and reorder
    rollback now removes only unchanged attempted created rows, reinserts only
    still-missing deleted rows, restores previous ID order only while live order
    still matches attempted order, and restores selected profile mirrors only
    when live values still match attempted values.
  - Phase 5 translator preset collection slice:
    `TranslatorPresetSettings.svelte` now sends create, select, delete, and
    import-backed create commands without broad translator preset snapshot
    rollback. Deferred command-failure tests cover newer row, selection, and
    mirrored `translatorPrompt`/`translatorMaxResponse` preservation while
    field-update rollback stays scoped.
  - Phase 5 prompt-template item collection slice: prompt item create, delete,
    and reorder rollback now uses focused attempted item/order helpers instead
    of broad prompt-template snapshots. Deferred rollback tests cover unchanged
    create removal, edited-create skip, delete reinsertion, reorder restoration,
    and newer-reorder skip.
  - Phase 5 split prompt/model preset array slice: model/prompt create, prompt
    import, delete, select, and reorder rollback now uses targeted row, order,
    selection, and attempted settings rollback instead of broad preset snapshots.
  - Phase 5 legacy bot preset slice: legacy preset save, copy, select, create,
    update, delete, reorder, and extraction rollback now uses targeted row,
    field, order, selection, generated split row, and attempted settings
    rollback instead of broad preset snapshots.
  - Phase 5 persona residual slice: queued profile saves, direct saves, trigger
    prompt saves, persona selection, icon saves, and persona import create
    rollback now use attempted row, profile mirror, selection, and created-row
    rollback instead of broad persona snapshots.
  - Phase 5 scoped lorebook entry replacement slice: character, chat, global
    lorebook-entry, and module-lorebook entry replacement rollback now freezes
    attempted collections and rolls back by attempted id, value, and order.
  - Phase 5 top-level global lorebook list slice: global lorebook create,
    rename, delete, reorder, and select rollback now uses attempted row, name,
    order, and selected-id guards instead of broad lorebook snapshots.
  - Phase 5 MCP module subdomain slice: MCP module lorebook, regex, and
    Lua-trigger writes now pass module-scoped rollback snapshots instead of
    broad lorebook or script-definition snapshots.
  - Phase 5 MCP character subdomain slice: MCP character regex and Lua-trigger
    writes now pass character-scoped rollback snapshots instead of broad
    script-definition snapshots.
  - Phase 5 `applyModule()` slice: module apply now serializes character
    lorebook/script/trigger replacement commands with per-step scoped rollback
    records, preserving earlier accepted child replacements when a later command
    fails.
  - Phase 5 chat folder command slice: chat folder create, update, delete, and
    reorder rollback now uses attempted row, metadata, affected-chat, and order
    guards instead of broad chat snapshots.
  - Phase 5 chat list command slice: chat create, delete, and reorder rollback
    now uses attempted row, selection, folder-assignment, and order guards
    instead of broad chat snapshots.
  - Phase 5 character sidebar order slice: `characterOrder` drag reorder,
    folder creation/order, and folder metadata update rollback now uses
    attempted order-structure and metadata-field guards instead of broad
    character snapshots.
  - Phase 5 character list create/delete/import slice: character create,
    create-and-select, import-style create, and permanent delete rollback now
    uses attempted row, order-placement, and selection-id guards instead of broad
    character snapshots.
  - Phase 5 Hypa V3 preset array slice: append/import, rename/settings edit, and
    delete rollback now uses attempted row, insertion-index, and shifted
    selection-id guards instead of broad `hypaV3Presets` array restore.
  - Phase 5 combined sidebar chat/folder reorder slice: folder drag now uses a
    focused chat-command helper that preserves accepted folder reorder and rolls
    back attempted chat order/folder assignment without broad chat snapshots.
  - Phase 5 chat fork slice: fork commands now roll back only the attempted
    forked chat row, source metadata patch, and created branch folder while
    preserving newer sibling edits, changed fork rows, and branch folders still
    referenced by a live chat.
  - Phase 5 chat metadata PATCH slice: `dispatchUpdateChat()` now restores only
    sanitized attempted chat-row metadata fields that still match the optimistic
    value, preserving newer same-row, sibling, folder, and selection edits.
  - Phase 5 chat import flow slice: multi-chat imports now preserve accepted
    folder/chat create steps, remove only unchanged unaccepted imported rows,
    handle duplicate-id legacy imports as inserted rows, and re-resolve import
    targets by stable character id after file-picker awaits.
  - Phase 5 lorebook import freshness slice: lorebook imports now re-resolve
    stable character/chat/global-lorebook targets by id after file-picker awaits
    and snapshot rollback baselines immediately before the import write.
  - Phase 5 sidebar chat-folder creation slice: server-backed create-folder now
    appears optimistically in the sidebar and failed creates preserve attempted
    folders that newer chat moves reference.
  - Phase 5 multi-group plugin settings slice: plugin DB bridge settings
    dispatch now splits patches by settings group, preserves accepted earlier
    groups when a later group fails, and rolls back the failed or unaccepted
    attempted tail while keeping newer same-key edits and unrelated state.
  - Phase 5: import collection flows and any residual sidebar collection edges.
  - Known pre-existing test gap: `pnpm exec vitest run
    src/ts/compatibilityAdapters.test.ts` fails in
    `routes MCP character lorebook writes through lorebook commands in
    server-backed web mode` at `src/ts/compatibilityAdapters.test.ts:626`. The
    failure reproduced at baseline commit `30d4ad7ab`.
  - Phase 6: Realm/backup/local bundle restore/import resyncs, character/chat
    import refresh/navigation edges, memory job list/progress ordering,
    route/selection hydration, welcome/onboarding delayed setup, DevTool
    autopilot long-loop chat targeting, and related navigation refresh fences.
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
