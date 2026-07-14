# UI Flow Stale State Audit

Date: 2026-06-24.

Status: current-code, read-only audit. This report intentionally does not fix
the findings below.

## Purpose

The recent commit history shows a repeated bug shape: implementation is
technically present, but the first real UI flow crosses an async boundary and
then writes to a different, newer, or partially hydrated target. This audit
looked for that shape in current code.

## Method

Eight read-only sub-agents audited independent slices:

- chat, composer, message actions, reroll, and generation;
- character editor drafts and character asset uploads;
- settings, prompt/model presets, personas, translators, loadouts, and prompt
  templates;
- sidebar, chat list, route/refreeze, and active chat generation settings;
- lorebooks, scripts, modules, plugins, custom UI, and MCP;
- imports, backups, assets, Realm import, and memory jobs;
- command/projection/SSE/bootstrap/resync infrastructure;
- test coverage and visible-state gates.

The audit loop for each persistent UI action was:

1. identify the user-visible state being changed;
2. identify async boundaries: await, debounce, file read, upload, import, modal,
   SSE, route/navigation, generation job, projection, or full resync;
3. check for target freshness guards, attempted-value rollback, and dirty draft
   projection merge;
4. check whether the rendered UI flow is tested, not just helper payloads.

Verdicts:

- `Issue`: a plausible current bug in normal UI flow or a transactional
  correctness gap.
- `Risk`: a lower-confidence or edge-condition gap worth hardening.
- `Pass`: audited surface has the expected guard and test shape.

## Executive Summary

The project is much stronger than the older archived audits: command mutations
are revision-gated, many optimistic flows use attempted-value rollback, and the
repo now has visible-state DOM and browser-smoke tests. The main weakness is no
longer "commands are unsafe"; it is the boundary between a visible UI action and
the async work that follows it.

The highest-value fixes are:

1. carry stable chat/message/character targets through composer send,
   translation, modal, and generation-setting flows;
2. avoid advancing projection revision cursors when local surgical application
   fails;
3. issue upload/import operation tokens before file reads, not after;
4. make import/restore and rollback flows aware of destructive refresh epochs;
5. expand visible DOM proof for editor surfaces that are currently covered only
   by helper/source-shape tests.

## Confirmed Issues

| ID   | Area                            | Finding                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                             | Suggested audit/fix target                                                                                                                                                                       |
| ---- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I-01 | Chat send                       | Main composer send captures a composer identity, but the append/generate path does not carry a stable active-chat target through the whole async flow. A chat switch after hydration can still affect where append/generation/effects land.     | `src/lib/ChatScreens/DefaultChatScreen.svelte:543`, `src/lib/ChatScreens/DefaultChatScreen.svelte:614`, `src/ts/chatCommands.ts:2219`                                                                                                                                                                                                | Capture `captureActiveChatTarget()` at send start, pass it to append/generate, re-check after append/send, and add a DOM test with deferred append/send plus chat switch.                        |
| I-02 | Message translation             | Server raw translation local success/rollback writes by current message index instead of captured message id. If the active chat changes before completion, local projection can update the wrong row.                                          | `src/lib/ChatScreens/Chat.svelte:333`, `src/lib/ChatScreens/Chat.svelte:357`, `src/lib/ChatScreens/Chat.svelte:390`                                                                                                                                                                                                                  | Apply/rollback by captured `messageId`; add rendered test where translation resolves after switching chat.                                                                                       |
| I-03 | Projection/SSE                  | Surgical projection branches can mark a command event applied even when local target application fails.                                                                                                                                         | `src/ts/bootstrap.ts:413`, `src/ts/bootstrap.ts:435`, `src/ts/server/chatMessageHydration.svelte.ts:298`                                                                                                                                                                                                                             | If local apply returns false, force resync and mark applied only after successful resync. Test missing chat/character targets on generation/message/lorebook events.                             |
| I-04 | Character editor                | Several persistent `CharConfig` actions are gated on `characterDraft.value.type`, but `type` is not in the draft seed keys, so real-character actions can silently no-op.                                                                       | `src/lib/SideBars/CharConfig.svelte:130`, `src/lib/SideBars/CharConfig.svelte:479`, `src/lib/SideBars/CharConfig.svelte:1183`, `src/lib/SideBars/CharConfig.svelte:1544`, `src/lib/SideBars/CharConfig.svelte:1648`                                                                                                                  | Guard against the live selected DB row plus `characterDraft.characterId`, or seed `type` read-only and exclude it from patches. Add behavior tests for bias, alternate greeting, and script add. |
| I-05 | Character/media uploads         | Some upload flows issue freshness tokens only after `selectSingleFile`/`selectMultipleFile` has already read bytes. A slow older file read can become the latest operation after a newer picker selection.                                      | `src/ts/characters.ts:170`, `src/lib/SideBars/CharConfig.svelte:609`, `src/lib/SideBars/CharConfig.svelte:672`, `src/lib/SideBars/CharConfig.svelte:703`; contrast guarded folder image path at `src/lib/SideBars/Sidebar.svelte:88`                                                                                                 | Begin operations in an `onFileSelected`/`onFilesSelected` callback before bytes are read. Add tests where older file-read resolves after newer selection.                                        |
| I-06 | Prompt settings                 | Prompt settings drafts in `PromptSettings.svelte` can lose a local dirty value if stale projection lands before the queued 250 ms patch flushes. The local helper lacks the dirty/projection-epoch reassertion used by shared settings bridges. | `src/lib/Setting/Pages/PromptSettings.svelte:396`, `src/lib/Setting/Pages/PromptSettings.svelte:404`                                                                                                                                                                                                                                 | Add dirty-field tracking plus projection-epoch merge/reassert, or route through the shared bridge. Test stale projection between edit and debounce flush.                                        |
| I-07 | Active chat generation settings | Reset, toggle-preset save, and preset/persona picker flows can retarget after a confirm/input/modal because they re-resolve the active chat when the action completes.                                                                          | `src/lib/SideBars/ChatGenerationResetDefaultsButton.svelte:18`, `src/ts/activeChatGenerationSettings.ts:282`, `src/lib/SideBars/ChatGenerationTogglePresets.svelte:32`, `src/ts/chatGenerationTogglePresets.ts:24`, `src/ts/stores.svelte.ts:128`, `src/lib/Setting/botpreset.svelte:170`, `src/lib/Setting/listedPersona.svelte:32` | Capture `{ characterId, chatId }` when opening the confirm/input/modal. Abort or use target-aware save APIs if the active chat changed. Add DOM tests that switch chats before confirm/click.    |
| I-08 | Bundle/local-backup import      | Bundle/local-backup import can persist assets before DB import succeeds. If DB decode/apply fails after asset registration, files/metadata/events can remain from a failed import.                                                              | `server/fastify/src/routes/save.ts:139`, `server/fastify/src/routes/save.ts:155`, `server/fastify/src/risuSave/localBackupImport.ts:211`, `server/fastify/src/risuSave/localBackupImport.ts:327`                                                                                                                                     | Stage assets until DB import is ready to commit, or rollback created assets/events/files on failure. Test malformed embedded DB after valid assets.                                              |
| I-09 | Lorebook UI                     | Lorebook delete confirmations can act on stale rows. The dialog awaits confirmation, then parent handlers delete by captured index/object identity. Reorder/import/projection during the dialog can remove the wrong row.                       | `src/lib/SideBars/LoreBook/LoreBookData.svelte:289`, `src/lib/SideBars/LoreBook/LoreBookList.svelte:396`, `src/lib/SideBars/LoreBook/LoreBookList.svelte:454`, `src/lib/SideBars/LoreBook/LoreBookList.svelte:514`                                                                                                                   | Delete against the latest collection by stable entry id/folder key, with same-row guards for id-less entries. Add delayed-confirm tests with sibling insert/reorder.                             |
| I-10 | Module imports                  | Module-local lorebook/regex imports can overwrite edits made while the picker is open. Regex import also dereferences canceled picker results.                                                                                                  | `src/lib/Setting/Pages/Module/ModuleMenu.svelte:312`, `src/lib/Setting/Pages/Module/ModuleMenu.svelte:331`, `src/ts/process/scripts.ts:79`, `src/ts/process/scripts.ts:81`, `src/lib/Setting/Pages/Module/ModuleMenu.svelte:519`, `src/lib/SideBars/Scripts/RegexList.svelte:110`                                                    | Return imported rows separately, re-resolve stable target after picker, merge into latest collection, and handle cancel. Add delayed-picker tests.                                               |
| I-11 | Plugins/custom UI               | Plugin V3/custom UI reloads are not generation-guarded. Overlapping loads can unload/register from an older snapshot after a newer load.                                                                                                        | `src/ts/plugins/plugins.svelte.ts:563`, `src/ts/plugins/plugins.svelte.ts:580`, `src/ts/plugins/apiV3/v3.svelte.ts:1593`, `src/ts/plugins/apiV3/v3.svelte.ts:1231`, `src/ts/plugins/apiV3/v3.svelte.ts:1288`                                                                                                                         | Add a load generation or serialized queue. Test overlapping V3 loads and assert menus/providers reflect only the newest plugin set.                                                              |
| I-12 | Plugin/MCP rollback             | Some settings rollbacks are not attempted-aware. Plugin V3 theme API restores `previous` blindly; MCP refresh token rollback restores the whole previous array.                                                                                 | `src/ts/plugins/apiV3/v3.svelte.ts:73`, `src/ts/plugins/apiV3/v3.svelte.ts:951`, `src/ts/process/mcp/mcp.ts:314`                                                                                                                                                                                                                     | Use attempted-value checks or route through existing settings patch rollback helpers. Add tests where newer theme/token edits happen before failure rollback.                                    |

## Risks To Harden

| ID   | Area                         | Risk                                                                                                                                                                                                                    | Evidence                                                                                                                                                              | Suggested proof                                                                                                                                                            |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Generation settings rollback | Failed older generation-settings saves can restore over newer optimistic values because rollback is not attempted-value guarded.                                                                                        | `src/ts/chatCommands.ts:1445`, `src/ts/chatCommands.ts:1485`, current one-failure test at `src/ts/chatCommands.test.ts:1491`                                          | Test fail-first/save-second interleavings; restore only if live still equals that attempt.                                                                                 |
| R-02 | Generation local mirror      | Client SSE patch/terminal mirroring applies to captured character/chat indexes even though payloads carry stable ids. Reorder/page changes during generation can make local projection diverge from server persistence. | `src/ts/process/serverBackedSendChat.ts:97`, `src/ts/process/serverBackedSendChat.ts:376`, `src/ts/process/request/serverChatEvents.ts:114`                           | Resolve live chat by stable id before patch/terminal/post-gen apply. Test reorder/switch before terminal apply.                                                            |
| R-03 | Message icon actions         | Bookmark, branch, disable, and disable-above read active chat after a small async delay instead of capturing target before the delay.                                                                                   | `src/lib/ChatScreens/Chat.svelte:1629`, `src/lib/ChatScreens/Chat.svelte:1642`, `src/lib/ChatScreens/Chat.svelte:1716`, `src/lib/ChatScreens/Chat.svelte:1750`        | Capture chat/message id before the delay, or remove the delay. Add switch-chat-before-resume DOM tests.                                                                    |
| R-04 | Model role apply             | Applying model role profile bindings patches whichever model preset is selected after the first async command resolves, not necessarily the preset selected at click time.                                              | `src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte:203`, `src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte:223`                                          | Capture selected preset id before awaiting. Test selection switch between role update and preset patch.                                                                    |
| R-05 | Model profile drawer         | Editing an existing model profile can fall through to create if the profile disappears from projection while the drawer is open.                                                                                        | `src/lib/Setting/Pages/Model/ModelProfileList.svelte:110`, `src/lib/Setting/Pages/Model/ModelProfileList.svelte:125`                                                  | Treat missing existing profile in edit mode as stale/missing, not create. Add drawer-open deletion test.                                                                   |
| R-06 | Modal chat delete            | Modal chat delete re-reads `$selectedCharID` after confirmation, unlike sidebar delete which keeps the row character id.                                                                                                | `src/lib/Others/ChatList.svelte:118`, `src/lib/SideBars/SideChatList.svelte:200`                                                                                      | Capture originating character id before confirm. Test character switch while confirm is open.                                                                              |
| R-07 | Sortable chat reorder        | Drag reorder reconstructs payloads from DOM indexes against current `chara.chats`, without projection epoch/freshness guard during drag.                                                                                | `src/lib/SideBars/SideChatList.svelte:245`, `src/lib/SideBars/SideChatList.svelte:302`, current payload test at `src/lib/SideBars/SideChatList.svelte.test.ts:582`    | Use DOM chat ids directly and validate they still belong to the same character. Add dirty-projection-during-drag test.                                                     |
| R-08 | Destructive refresh          | `createDestructiveRefreshToken()` exists but has no production caller. Failed optimistic commands after full restore/resync can still rollback if restored live state coincidentally equals the attempted value.        | `src/ts/server/staleStateGuards.ts:161`, `src/ts/server/projectionResync.ts:81`, `src/ts/server/commands.ts:3055`, `src/ts/server/staleStateGuards.ts:84`             | Maintain a destructive-refresh epoch captured at optimistic dispatch and skip rollback if it changed. Test pending edit, full restore to attempted value, command failure. |
| R-09 | Realm import                 | Stale Realm import completion still triggers destructive projection resync before latest-token check. Current test expects this behavior.                                                                               | `src/ts/characterCards.ts:1646`, `src/ts/characterCards.ts:1851`, `src/ts/characterCards.realmImport.test.ts:384`                                                     | Decide/document intent. If unintended, check freshness before resync and update test.                                                                                      |
| R-10 | Avatar upload                | Avatar upload is row-safe but not current-editor-safe; unlike other character uploads it does not check current selected character.                                                                                     | `src/ts/characters.ts:90`, `src/ts/characters.ts:177`                                                                                                                 | If navigation should cancel avatar upload, add selected-character guard and test switching characters before `saveImage` resolves.                                         |
| R-11 | Dirty merge granularity      | Dirty projection merge is top-level only. Editing `newGenData.prompt` protects the whole `newGenData` object, so clean sibling projection updates can stay stale.                                                       | `src/ts/server/characterBridge.svelte.ts:94`, `src/ts/server/staleStateGuards.ts:146`, test at `src/ts/server/characterBridge.svelte.test.ts:257`                     | Only fix if real nested churn appears; otherwise document as an intentional conflict granularity.                                                                          |
| R-12 | Script draft reorder         | Script draft dirty merge falls back to full reseed when row id order changes, dropping local dirty row fields.                                                                                                          | `src/lib/SideBars/CharConfig.svelte:237`, `src/ts/server/scriptDefinitionBridge.svelte.ts:627`, coverage at `src/ts/server/scriptDefinitionBridge.svelte.test.ts:240` | Merge by stable row id across reorder, or add explicit conflict UX/test.                                                                                                   |
| R-13 | MCP risuaccess               | MCP risuaccess writes resolve targets before `await promptAccess`; replaced/deleted targets are not explicitly revalidated after acceptance.                                                                            | `src/ts/process/mcp/risuaccess/modules.ts:434`, `src/ts/process/mcp/risuaccess/characters.ts:522`                                                                     | Add deferred-prompt tests for target delete/replace before accept.                                                                                                         |

## Positive Controls

These are surfaces that now look like good patterns to copy:

- command mutations use `baseRevision` and active-writer guards before bumping
  revision and persisting events:
  `server/fastify/src/routes/commands.ts:1389`,
  `server/fastify/src/commands/mutations.ts:204`,
  `server/fastify/src/commands/mutations.ts:244`;
- SSE replay is durable and gap-aware, and replay-unavailable triggers full
  resync: `server/fastify/src/commands/events.ts:93`,
  `server/fastify/src/routes/events.ts:74`, `src/ts/bootstrap.ts:290`;
- full projection resync skips stale bootstrap responses:
  `src/ts/server/projectionResync.ts:45`,
  `src/ts/server/projectionResync.ts:71`;
- composer draft/file/autotranslate guards use operation tokens, target
  identity, and mutation versions:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:206`;
- reroll navigation has target-operation guards and waits for truncate
  persistence: `src/ts/process/rerollNavigation.svelte.ts:73`;
- character profile drafts use dirty-field merge and attempted rollback:
  `src/ts/server/characterBridge.svelte.ts:59`,
  `src/ts/server/characterBridge.svelte.ts:282`,
  `src/ts/server/characterBridge.svelte.ts:495`;
- prompt-template owner switching and dirty item merge are guarded:
  `src/ts/server/promptTemplateBridge.svelte.ts:151`,
  `src/ts/server/promptTemplateBridge.svelte.ts:397`;
- memory job UI uses serials, aborts, ETags, terminal fences, and scoped
  updates: `src/ts/server/memoryJobRefresh.ts:34`;
- plugin import/update freshness has operation-token coverage:
  `src/ts/server/pluginImport.ts:53`.

## Test And Process Findings

The visible-state testing policy is correct and should remain the standard:
`docs/structure/testing-and-operations.md:155` says user-visible state changes
need rendered assertions after the same transition, and optimistic flows must
assert both optimistic change and rollback.

Current coverage strengths:

- generation-settings visible flows are covered in
  `src/lib/_audit/phase0Journey2TogglePaint.dom.test.ts:148`,
  `src/lib/_audit/phase0Journey4Grouping.dom.test.ts:150`, and
  `src/lib/SideBars/chatGenerationSettingsControls.test.ts:552`;
- chat-list DOM rollback is covered in
  `src/lib/SideBars/SideChatList.svelte.test.ts:748`,
  `src/lib/SideBars/SideChatList.svelte.test.ts:810`,
  `src/lib/SideBars/SideChatList.svelte.test.ts:923`, and
  `src/lib/Others/ChatList.svelte.test.ts:463`;
- browser smoke now checks rendered app state, including character visibility,
  route/refreeze journeys, and reroll transcript rows:
  `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts:159`,
  `server/fastify/browser-smoke/phase0VisibleState.spec.ts:55`,
  `server/fastify/browser-smoke/rerollSwipePersistence.spec.ts:64`.

Current process gaps:

- there is no single default gate for the whole UI-flow bug-family matrix.
  `pnpm test:all` runs frontend, explicit gates, and server tests, but omits
  smoke and `coverage:ui-map` (`package.json:25`);
- `coverage:ui-map` is explicitly opt-in (`package.json:29`,
  `docs/structure/testing-and-operations.md:142`);
- default frontend Vitest excludes explicit audit gates unless
  `RISU_TEST_INCLUDE_GATES=true` (`vitest.config.ts:4`,
  `vitest.config.ts:22`);
- one focused sidebar route-mode DOM run failed because the test language mock
  lacks `language.hotkeyDesc.popupEditor`, used by
  `src/lib/UI/GUI/TextAreaInput.svelte:428`; mock is in
  `src/lib/SideBars/SideChatList.svelte.test.ts:213`.

Recommended audit lane for this bug family:

```sh
pnpm exec vitest run src/lib/_audit/phase0Journey2TogglePaint.dom.test.ts src/lib/_audit/phase0Journey4Grouping.dom.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/SideBars/SideChatList.svelte.test.ts src/lib/Others/ChatList.svelte.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/lib/ChatScreens/DefaultChatScreen.shellGreeting.dom.test.ts
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts
pnpm test:server
pnpm smoke:fastify-browser
pnpm coverage:ui-map
```

## Verification Performed During This Audit

Sub-agents ran focused checks while auditing:

- settings/presets slice: 8 files, 174 tests passed;
- character/editor slice: 8 files, 111 tests passed;
- sidebar/chat-list slice: 144 tests passed, 1 focused test failed because of
  the missing `hotkeyDesc.popupEditor` mock;
- command/projection/SSE slice:
  `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/projectionResync.test.ts src/ts/server/staleStateGuards.test.ts`,
  56 tests passed;
- imports/backups/memory slice ran focused frontend and Fastify route tests;
  both passed;
- chat/generation slice ran focused client stale-flow tests, 9 files/101 tests
  passed, and filtered server generation finalization tests, 9 tests passed;
- modules/plugins/MCP slice was source-inspection only.

This report itself was produced from the sub-agent results plus local source
inspection. It is not a remediation patch.

## Remediation Progress Snapshot

The remediation tracker is consolidated with the audit. All issue and risk IDs below correspond to the findings above.

Date started: 2026-06-24.

This document tracks remediation of the Confirmed Issues and Risks To Harden in
`.archived-docs/ui-and-user-input/user-input/ui-flow-stale-state-audit.md`.

### Workflow States

- `Pending`: not started.
- `Exploring`: explorer agent is examining the area.
- `Ready`: explorer findings are available for implementation.
- `Implementing`: implementation worker is applying the fix.
- `Verifying`: verification worker is validating the result.
- `Fixed`: verification passed and the fix was committed.
- `Blocked`: work cannot continue without a decision or external change.

### Confirmed Issues

| ID   | Area                            | Status | Explorer | Implementation | Verification | Commit                                                                  | Notes                                                                                                                                   |
| ---- | ------------------------------- | ------ | -------- | -------------- | ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 | Chat send                       | Fixed  | complete | complete       | passed       | `8e1d112d5 fix: carry chat send target through async flow`              | Captured active chat target through append/send; verifier passed focused DOM and sendChat tests.                                        |
| I-02 | Message translation             | Fixed  | complete | complete       | passed       | `977737ff2 fix: target message translation updates by id`               | Applied/rolled back translation by captured message id; verifier passed focused rendered stale-switch test.                             |
| I-03 | Projection/SSE                  | Fixed  | complete | complete       | passed       | `fad8fec93 fix: resync failed projection applies before cursor advance` | Lorebook/chat-message surgical apply failures now await full resync before marking events applied.                                      |
| I-04 | Character editor                | Fixed  | complete | complete       | passed       | `fa1f78e4e fix: guard character draft actions by live row`              | Replaced draft `type` gates with live selected-row/draft-id guards; verifier passed focused CharConfig and bridge tests.                |
| I-05 | Character/media uploads         | Fixed  | complete | complete       | passed       | `b93095edd fix: issue upload tokens before file reads`                  | Upload tokens now start in picker callbacks; verifier fixed read-rejection cleanup and passed focused race tests.                       |
| I-06 | Prompt settings                 | Fixed  | complete | complete       | passed       | `5f02a8d59 fix: preserve dirty prompt settings across projection`       | Dirty/owner-aware prompt settings drafts now reassert stale projections before debounce flush; verifier passed focused tests/typecheck. |
| I-07 | Active chat generation settings | Fixed  | complete | complete       | passed       | `f1f998f03 fix: guard chat generation modals by target`                 | Captured active-chat targets through reset/input/picker flows; verifier passed focused stale-target tests.                              |
| I-08 | Bundle/local-backup import      | Fixed  | complete | complete       | passed       | `019cd24eb fix: stage bundle assets until import commit`                | Bundle assets are staged until DB decode/import succeeds; verifier passed route tests and strict server typecheck.                      |
| I-09 | Lorebook UI                     | Fixed  | complete | complete       | passed       | `c91ce1d89 fix: resolve lorebook deletes after confirmation`            | Delete confirmations now resolve latest row by stable target; verifier passed focused tests and `pnpm check`.                           |
| I-10 | Module imports                  | Fixed  | complete | complete       | passed       | `fa0c7a1f4 fix: merge module imports into latest draft`                 | Module lorebook/regex imports now return rows and merge by stable module id; verifier passed focused tests and `pnpm check`.            |
| I-11 | Plugins/custom UI               | Fixed  | complete | complete       | passed       | `dc344ff92 fix: guard plugin v3 reload generations`                     | Plugin loads are coalesced and V3 providers/custom UI reject stale generations; verifier passed focused tests and `pnpm check`.         |
| I-12 | Plugin/MCP rollback             | Fixed  | complete | complete       | passed       | `cd8ffddce fix: make plugin and mcp rollbacks attempted-aware`          | Theme and MCP token rollbacks now preserve newer edits; verifier passed focused tests and `pnpm check`.                                 |

### Risks To Harden

| ID   | Area                         | Status | Explorer | Implementation | Verification | Commit                                                               | Notes                                                                                                              |
| ---- | ---------------------------- | ------ | -------- | -------------- | ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| R-01 | Generation settings rollback | Fixed  | complete | complete       | passed       | `19262caeb fix: guard generation settings rollback attempts`         | Failed older saves now roll back only when live generation settings still match the attempted value.               |
| R-02 | Generation local mirror      | Fixed  | complete | complete       | complete     | 7827ba602 fix: resolve server-backed generation mirrors by id        | Server-backed mirror resolves chat by stable ids with index fallback only for legacy payloads.                     |
| R-03 | Message icon actions         | Fixed  | complete | complete       | complete     | e43829ac7 fix: remove stale delay from message icon actions          | Removed stale async delay before bookmark, branch, disable, and disable-above action resolution.                   |
| R-04 | Model role apply             | Fixed  | complete | complete       | complete     | 9fba627dd fix: target model role preset patches by captured id       | Captured selected model preset id before awaited role-profile command.                                             |
| R-05 | Model profile drawer         | Fixed  | complete | complete       | complete     | 5d007f207 fix: guard stale model profile edit saves                  | Edit saves now guard missing profile targets and show a stale-target error instead of creating.                    |
| R-06 | Modal chat delete            | Fixed  | complete | complete       | complete     | ecd22ad5b fix: resolve modal chat deletes by origin target           | Modal delete resolves the captured origin character/chat after confirmation before deleting.                       |
| R-07 | Sortable chat reorder        | Fixed  | complete | complete       | complete     | ee8616157 fix: validate sortable chat reorder by ids                 | Sortable reorder builds payloads from DOM ids and fails closed on stale/missing ids.                               |
| R-08 | Destructive refresh          | Fixed  | complete | complete       | complete     | 4e1a45290 fix: skip optimistic rollback after destructive refresh    | Optimistic rollback runners skip rollback if a full projection replacement advanced the destructive refresh epoch. |
| R-09 | Realm import                 | Fixed  | complete | complete       | complete     | d82e96dd7 fix: skip stale realm import resyncs                       | Stale Realm import completions return before refresh progress or destructive projection resync.                    |
| R-10 | Avatar upload                | Fixed  | complete | complete       | complete     | d75894529 fix: cancel stale avatar uploads after navigation          | Avatar upload freshness now includes current selected/editor scope and selection-attempt id.                       |
| R-11 | Dirty merge granularity      | Fixed  | complete | complete       | complete     | b4c1cc553 test: document top-level character draft merge granularity | Existing test now explicitly encodes top-level character draft conflict granularity.                               |
| R-12 | Script draft reorder         | Fixed  | complete | complete       | complete     | fdc16dc64 fix: preserve dirty script draft rows across reorder       | Script definition projection merge now preserves dirty row fields across stable-id reorders.                       |
| R-13 | MCP risuaccess               | Fixed  | complete | complete       | complete     | 8b1d6507e fix: revalidate risuaccess targets after prompts           | Module and character risuaccess writes revalidate stable target id/object after accepted prompt.                   |
