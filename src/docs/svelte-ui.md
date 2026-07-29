# Svelte UI Guide

Last audited: 2026-07-27.

The frontend is a Svelte 5 SPA. There is no SvelteKit `src/routes/` tree:
navigation is URL parsing plus Svelte stores, and `src/App.svelte` chooses the
visible screen. Fastify owns durable state and most side effects. The browser
owns rendering, local input state, visible optimistic state, hydration display,
media previews, alerts/modals, TTS playback, hotkeys, custom HTML/CSS, and
plugin execution.

Use this file first for Svelte UI/UX bugs. Use `src/docs/client-runtime.md` when
the visible issue is caused by startup resource reads, invalidation, hydration,
commands, generation, assets, storage, Realm import, plugins, or MCP.

## Fast Triage

| Symptom                                                                              | Inspect first                                                                                                                                                                         | Then inspect                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App is stuck on legal, loading, settings, grid, or chat                              | `src/App.svelte`, `src/main.ts`, `src/ts/bootstrap.ts`                                                                                                                                | `src/ts/stores.svelte.ts`, `src/ts/router.ts`, `src/styles.css`                                                                                                             |
| App reports writer takeover or becomes a frozen offline view                         | `src/ts/server/activeWriterSession.ts`, `src/ts/server/events.ts`                                                                                                                     | `src/styles.css`, `src/ts/bootstrap.ts`, `src/ts/server/commands.ts`                                                                                                        |
| URL, back/forward, settings section, playground tool, or character route is wrong    | `src/ts/router.ts`, `src/App.svelte` route effects                                                                                                                                    | `src/ts/router.test.ts`, `src/App.routeEffect.dom.test.ts`                                                                                                                  |
| Theme, motion, spacing, clipping, colors, font, UI scale, or custom CSS is wrong     | `src/styles.css`, `src/ts/gui/colorscheme.ts`, `src/ts/gui/animation.ts`, `src/ts/gui/guisize.ts`                                                                                     | `src/lib/Setting/Pages/DisplaySettings.svelte`, `src/ts/setting/accessibilitySettingsData.ts`                                                                               |
| The whole document moved or window scrolling appeared                                | `src/ts/gui/viewportScrollGuard.ts`, `src/main.ts`, `src/styles.css`                                                                                                                  | Find code that scrolls `window`, `document.scrollingElement`, or an app-root ancestor                                                                                       |
| A settings page or left-nav item is wrong                                            | `src/lib/Setting/Settings.svelte`, `src/ts/router.ts` setting slug maps                                                                                                               | The concrete `src/lib/Setting/Pages/*.svelte` page                                                                                                                          |
| Agent or Agent Preset authoring, status, or chat selection is wrong                  | `src/lib/Setting/Pages/AgentPresetSettings.svelte`, `AgentSettingsSection.svelte`, `AgentEditorDrawer.svelte`, `AgentPresetEditorDrawer.svelte`, `src/lib/SideBars/ChatGenerationSettingsControls.svelte` | `src/ts/agentPresetRecords.ts`, `src/ts/agents.ts`, `src/ts/agentPresetResolver.ts`, `src/ts/agentPresets.ts`, `server/fastify/src/commands/agentPresets.ts` |
| A model role/profile summary, inherited role, or provider panel visibility is wrong  | `src/lib/Setting/Pages/Model/ModelSettingsShell.svelte`, `ModelProfileRoleList.svelte`, `ModelProfileList.svelte`, `ModelProviderPanel.svelte`, `src/ts/model/modelProfileUiState.ts` | `src/ts/model/modelProfileResolver.ts`, legacy `ModelRoleList.svelte` inside Advanced Legacy Settings, `docs/structure/providers-and-models.md`                             |
| A data-driven setting row is missing, hidden, stale, or not saving                   | `src/lib/Setting/SettingRenderer.svelte`, `src/ts/setting/*SettingsData*`, `src/ts/setting/utils.ts`                                                                                  | `src/lib/Setting/Wrappers/*`, `src/ts/server/settingsBridge.svelte.ts`                                                                                                      |
| A shared input/control is visually or behaviorally wrong                             | The primitive in `src/lib/UI/GUI/`                                                                                                                                                    | The wrapper in `src/lib/Setting/Wrappers/` if it only breaks in settings                                                                                                    |
| Chat transcript, composer, send buttons, scroll, or hydration state is wrong         | `src/lib/ChatScreens/DefaultChatScreen.svelte`, `src/lib/ChatScreens/Chats.svelte`                                                                                                    | `src/ts/server/chatMessageHydration.svelte.ts`, `src/ts/chatCommands.ts`                                                                                                    |
| Message HTML, translation, parser, inlays, or partial edit is wrong                  | `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/ChatBody.svelte`, `src/lib/ChatScreens/ChatBodyParseMemo.ts`                                                                  | `src/ts/parser/`, `src/ts/process/files/`, `src/ts/globalApi.svelte.ts`                                                                                                     |
| Sidebar, character list, chat list, folders, reorder, or character config is wrong   | `src/lib/SideBars/Sidebar.svelte`, `src/lib/SideBars/SideChatList.svelte`, `src/lib/SideBars/CharConfig.svelte`                                                                       | `sidebarOrganizer.ts`, `sidebarDrag.ts`, `sidebarCharList.ts`, `chatFolderGrouping.ts`, and the character/chat command helpers                                              |
| Alert, popup, bookmark, Hypa V3, loadout, or Iris modal hides or blocks UI            | `src/App.svelte`, `src/lib/Others/AlertComp.svelte`, `src/ts/alert.ts`                                                                                                                | The specific modal plus `src/ts/gui/modalFocusTrap.ts`                                                                                                                      |
| Grid/mobile character picker is wrong                                                | `src/lib/Others/GridCatalog.svelte`, `src/lib/Mobile/MobileCharacters.svelte`                                                                                                         | `src/ts/stores.svelte.ts` mobile stores                                                                                                                                     |
| Playground menu/tool routing is wrong                                                | `src/lib/Playground/PlaygroundMenu.svelte`, `src/ts/router.ts`, `src/ts/playground.ts`                                                                                                | The specific `src/lib/Playground/*.svelte` tool                                                                                                                             |

## Entrypoints And Shell

| Path                  | Role                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`          | Mounts `#app` and loads `/src/main.ts`.                                                                                                                                                                                            |
| `src/main.ts`         | Imports polyfills/storage state, installs the router, push-navigation listener, and viewport guard, mounts `App.svelte`, then installs smoke/startup/hotkey behavior and removes `#preloading`.                  |
| `src/App.svelte`      | Main render switch and overlay host. It owns legal/loading/settings/grid/sidebar/chat priority and global modal mounting.                                                                                                          |
| `src/styles.css`      | Tailwind v4 import, theme variable defaults, full-height app CSS, global chat text CSS, and Tailwind compatibility base rules.                                                                                                     |
| `src/ts/bootstrap.ts` | Browser startup coordinator. It loads Fastify resources, starts hydration/events/bridges, then updates UI-derived CSS state.                                                                                                       |
| `src/ts/platform.ts`  | Fastify-only platform flag. `isFastifyServer` is hard-coded true.                                                                                                                                                                  |

`src/LiteMain.svelte` exists but is not the live entrypoint. Live lite behavior
comes from `VITE_RISU_LITE`, `src/ts/lite.ts`, and consumers in settings/theme
and legacy mobile code.

`src/App.svelte` also owns app-level drag/drop import. Dropped `.risup` files
import presets, `.risum` files import modules through the Fastify-backed browser
module path, and other supported files fall through to character/card import.
Dataset, chat, character-card, persona, preset, lorebook, regex, module, and
translator-preset exchange entrypoints are mapped in
[Assets And Saves](../../docs/structure/assets-and-saves.md#client-content-exchange).

## App Render Priority

`src/App.svelte` renders in this order:

1. Legal/setup screen when `VITE_RISU_LEGAL_CONFIGURED` is unset/falsy.
2. April 1 joke screen.
3. Loading screen while `$loadedStore` is false.
4. `CustomGUISettingMenu` when `$CustomGUISettingMenuStore` is true.
5. `Settings` when `$settingsOpen` is true.
6. `GridCatalog` when `$currentRoute.kind === 'grid'`.
7. Normal shell: `Sidebar` plus `ChatScreen`.

Global overlays mount after the main branch. The common blockers are
`AlertComp`, Realm popup/frame, preset/persona lists, bookmarks, Hypa V3 modal
and progress, save popup icon, popup list, EasyPanel,
popup editor, loadout modal, Iris modal, and custom sidebar config.
The saved-toggle management dialog is also app-hosted through
`src/lib/SideBars/ChatGenerationTogglePresetDialog.svelte`.

Two app-level states do not come from the Svelte render switch. Writer takeover
temporarily blocks interaction while the refresh/offline choice is open; the
offline choice then freezes editable controls and mounts a reload banner from
`src/ts/server/activeWriterSession.ts`. `SavePopupIcon.svelte` separately
reflects aggregate persistence activity when `showSavingIcon` is enabled.

If the expected screen is missing, first confirm no higher-priority branch or
overlay is mounted.

Blocking dialogs share `src/ts/gui/modalFocusTrap.ts`. The action maintains a
stack for nested modals, makes background branches inert, traps Tab and
programmatic focus, locks body scrolling, and restores focus/background state
on close. For focus escape or a clickable background, inspect the modal's
`data-modal-root`/action wiring and `src/ts/gui/modalFocusTrap.test.ts` before
adding component-local focus code.

## Routes And Stores

Routing is implemented in `src/ts/router.ts`. It parses `window.location`, keeps
`currentRoute`, applies URL changes to stores, and syncs store changes back to
the URL. Route changes are not file-system based.

| Route                               | Store effect                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                                 | Home, `selectedCharID = -1`, settings/playground closed.                                  |
| `/settings`                         | Opens settings; split layout auto-selects model settings, mobile shows the settings list. |
| `/settings/:section`                | Opens settings and maps section slugs to `SettingsMenuIndex`.                             |
| `/settings/persona/:personaId`      | Opens persona settings and selects the uniquely matching persona.                         |
| `/grid` and `/characters`           | Opens the character grid.                                                                 |
| `/character/:chaId/:chatId?`        | Selects the character and optionally selects a chat.                                      |
| `/characters/:chaId/chats/:chatId?` | Legacy character/chat route shape.                                                        |
| `/playground/:tool`                 | Maps tool slugs to `PlaygroundStore`.                                                     |
| `/inlay` or `/inlays`               | Opens the inlay explorer through `PlaygroundStore = 14`.                                  |
| Other unknown roots                 | Parse as `not-found` and close route-owned surfaces.                                      |

Unknown `/settings/:section` and `/playground/:tool` slugs fall back to their
default menus; they are not general not-found routes.

`src/App.svelte` has two load-bearing route effects:

- URL-to-store: after `$loadedStore`, it consumes state-driven route updates and
  calls `applyRouteToStores(route)` inside `untrack`.
- Store-to-URL: after `$loadedStore`, it skips while the router is applying a
  route or has a pending application, then calls `syncRouteFromState`.

The `untrack` is intentional. Applying a route closes route-blocking state such
as `CustomGUISettingMenuStore`, `botMakerMode`, and `CharEmotion`. If a full
resource refresh or unrelated reactive resource read retriggers route
application, the sidebar or chat tabs can visibly reset.

Important route/store facts:

- `loadedStore` gates route application and the loading shell.
- `src/ts/server/resourceState.svelte.ts` owns the settings, collections, and
  character resources used by data-driven UI. Compatibility helpers expose a
  composed database-shaped view without owning a second state tree.
- `selectedCharID` drives the active character, sidebar, and chat screen.
- `settingsOpen` plus `SettingsMenuIndex` controls the settings shell.
- `PlaygroundStore` controls playground tools. Value `2` is playground chat and
  value `14` is inlay.
- `/character/:id` and `/character/:id/:chatId` are visibly different. A
  character route without a chat id can intentionally show a select-chat state.
- `/playground/chat` creates/selects a synthetic playground character through
  `src/ts/playground.ts`.
- In-app settings and grid openings mark their history origin. Closing them uses
  `history.back()`; a direct entry without an owned origin is replaced with
  home instead of manufacturing a stale back-stack entry.
- `navigateToCharacterChatMessage` queues a bookmark/message jump until the
  target route has applied, then delivers it once; `DefaultChatScreen.svelte`
  expands and hydrates the required transcript window.
- The current character-sidebar tab is stored in the active history entry, so
  back/forward restores it without leaking it into a new route.
- While a durable generation owns a chat, character/chat navigation is
  canonicalized to that owner. Missing chat ids canonicalize to the bare
  selected-character route, and delayed route work is fenced against newer
  navigation.

## Component Ownership

| Path                        | Visible ownership                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ChatScreens/`      | Main chat workflow: themed chat frame, transcript, composer, message rows, parser/translation HTML, suggestions, assets, partial edit, resize/emotion displays.                                                                   |
| `src/lib/SideBars/`         | Desktop navigation and side-panel workflows: characters, folders, chat list, chat folders, character config, lorebook, scripts, quick settings, dev tools, custom sidebar.                                                        |
| `src/lib/Setting/`          | Settings shell, renderer, row wrappers, concrete pages, bot presets, persona lists, lore presets.                                                                                                                                 |
| `src/lib/Setting/Wrappers/` | Data-driven setting row renderers for check/text/number/textarea/slider/select/segmented/color/header/button/accordion/custom rows.                                                                                               |
| `src/lib/Setting/Pages/`    | Concrete settings pages. Some are thin `SettingRenderer` hosts; others are large stateful pages.                                                                                                                                  |
| `src/lib/UI/`               | Shared higher-level UI: accordions, menus, model pickers, provider pickers, prompt rows, Realm UI.                                                                                                                                |
| `src/lib/UI/GUI/`           | Shared primitive controls: buttons/icon buttons, text/optional/number/textarea/resizable textarea/syntax-highlighted textarea/select/option/slider/color inputs, segmented control, portals, multilingual fields, sidebar arrows. |
| `src/lib/Others/`           | Global modals and miscellaneous UI: alerts, grid catalog, bookmark/chat-list modals, Hypa V3, popup editor, loadout, Iris, and legal/setup.                                                                                       |
| `src/lib/Playground/`       | Playground menu and tools for parser/tokenizer/MCP/image/translation/subtitles/inlays/tool conversion.                                                                                                                            |
| `src/lib/Mobile/`           | Mobile components. `MobileCharacters` is active through `GridCatalog`; the full mobile shell files are currently not mounted by `App.svelte`.                                                                                     |
| `src/lib/LiteUI/`           | Lite/hub card support. `LiteMain.svelte` is not the live app entrypoint.                                                                                                                                                          |
| `src/lang/`                 | UI string contract. Add frontend strings here rather than hard-coding labels.                                                                                                                                                     |
| `src/etc/`                  | Bundled docs/media/tokenizer seed data imported by client code.                                                                                                                                                                   |

Plugin V3 can inject settings, floating-action, hamburger, and chat-menu
surfaces into these owners. Registration/replacement/unload semantics are
canonical in [Plugins And MCP](../../docs/structure/plugins-and-mcp.md#ui-surfaces).

## Chat UI

`src/lib/ChatScreens/ChatScreen.svelte` frames the chat surface. It switches
between standard, waifu, and mobile-waifu display modes, applies background and
text-screen styles, renders `BackgroundDom`, and opens chat/module modals.

`src/lib/ChatScreens/DefaultChatScreen.svelte` is the dense chat coordinator. It
owns:

- active character/chat derivation;
- lazy message hydration indicators;
- transcript window size and scroll-to-message expansion;
- composer input, file input, suggestion/sticker state, send/continue/reroll;
- generation stage/abort UI plus Agent Preset and post-generation script
  progress;
- quick menus for chat list, modules, Hypa V3, translation, image/file tools,
  extra plugin menus, and EasyPanel.

Transcript rendering then fans out through `Chats.svelte`, `Chat.svelte`,
`Message.svelte`, and `ChatBody.svelte`.

High-risk chat areas:

- Character REST resources carry message-less chat rows. Check
  `src/ts/server/chatMessageHydration.svelte.ts` before treating missing
  messages as a render bug.
- `ScrollToMessageStore`, transcript window identity, image-load waits, and
  folded-message state all affect scroll behavior.
- Message HTML crosses parser, translation, custom HTML templates, inlays,
  additional assets, module assets, and optional partial edit.
- Durable message translation is server-raw for persisted transcript rows.
  The server owns automatic translation for newly generated messages and sends
  the final translation outcome with the generation terminal frame;
  `serverGeneratedMessageTranslation.ts` mirrors an embedded success or joins
  the existing translation-job UI for running/failure states. `Chats.svelte`
  still grants one-shot client eligibility to other appended rows, subject to
  the active chat's `autoTranslate`/bot-only policy. `Chat.svelte` renders
  `bilingualDisplay` through `x-risu-bilingual-translation` blocks. The legacy
  `ChatBody.svelte` HTML translation path remains only for non-persisted
  previews/greetings and reads the same active-chat automatic policy.
- The synthetic greeting row (`idx === -1`) has a separate manual translation
  path. `Chat.svelte` and `DefaultChatScreen.svelte` use
  `src/ts/server/greetingTranslations.svelte.ts` to persist and render the
  character-scoped projection. Greetings remain manual-only even when chat
  auto-translation is enabled.
- `ChatBodyParseMemo.ts` owns parser/LLM-detection memoization and dependency
  signatures for the active chat, character, modules, settings, CBS state, and
  reload epochs; stale HTML or expensive rerenders can originate there.
- `src/ts/parser/parser.svelte.ts` emits `x-hl-lang` and
  `risu-ctrl="bgm___…"` markers. `src/ts/observer.svelte.ts` turns highlighted
  code into copy/download context-menu targets, starts BGM, retries blocked
  autoplay on the next user activation, and stops playback on chat change.
  `src/ts/observer.svelte.test.ts` guards the DOM contract; see the
  [client runtime map](client-runtime.md#client-typescript-areas) for runtime
  ownership.
- UI mutations should route through `src/ts/chatCommands.ts` and command/bridge
  helpers in Fastify mode.
- Generation-visible state starts in `DefaultChatScreen.svelte` but durable send
  and reattach behavior lives under `src/ts/process/`.
- `DefaultChatScreen.composerDrafts.ts` preserves all five composer fields per
  transcript across navigation and reload in bounded, lineage/writer-scoped
  `sessionStorage`. Exact-generation accepted saves clear recovery; newer,
  queued, or failed drafts remain. The complete recovery-store boundary is in
  [Client Runtime](client-runtime.md#draft-recovery-stores).
  `src/ts/process/rerollNavigation.svelte.ts` owns reroll navigation fencing and
  rollback.
- Input hooks are durable definitions edited at `/settings/input-hooks`.
  `ChatDraftHookSelector.svelte` chooses a chat-scoped draft hook; sending runs
  that hook before generation. The composer can also open
  `InputHookPickerDialog.svelte` for an ad hoc BTW hook and retain/dismiss its
  result independently of the message draft. Execution lives in
  `src/ts/process/inputHooks.ts` and uses the `otherAx` model role. Hook prompts
  support `{{slot::content}}`, `{{slot::draft}}`, and the bounded
  `{{slot::history::N}}` / `{{slot::historytrans::N}}` windows (`N` is 1–50).
  History access expands the resident tail only as far as needed and shares the
  translator history renderer's disabled/comment boundary, greeting, persisted
  translation, and token-budget semantics.
- `AgentPresetProgress.svelte` and `PostGenerationScriptProgress.svelte` render
  chat-scoped SSE state above the transcript. Their stores/parsing live in
  `src/ts/process/agentPresetProgress.ts`, `postGenerationProgress.ts`, and
  `src/ts/process/request/serverChat.ts`.

Relevant tests include `src/lib/ChatScreens/ChatBody.svelte.test.ts`,
`src/lib/ChatScreens/ChatBody.parseMemo.test.ts`,
`src/lib/ChatScreens/newMessageTranslationEligibility.test.ts`,
`src/ts/process/serverGeneratedMessageTranslation.test.ts`,
`src/ts/translator/bilingualInterleave{,.dom}.test.ts`,
`src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`,
`src/lib/ChatScreens/Suggestion.svelte.test.ts`, and
`src/lib/ChatScreens/PartialEditController.sharedHover.test.ts`. Parser,
loading, and freshness regressions also have focused tests such as
`Chat.parserDependencies.test.ts`, `BackgroundDom.parserDependencies.test.ts`,
`chatGenerationLoading.test.ts`, `chatButtonTriggerFreshness.test.ts`, and
`partialEditFreshness.test.ts`.

## Sidebar And Navigation UI

`src/lib/SideBars/Sidebar.svelte` owns desktop navigation: home/settings/
playground buttons, character avatars, folders, drag/drop reordering, grid open,
quick settings, dev tool, and character config switching. It uses
`selectedCharID`, `settingsOpen`, `sideBarStore`, `DynamicGUI`,
`PlaygroundStore`, `botMakerMode`, `CharEmotion`, and server command helpers.

`src/lib/SideBars/SideChatList.svelte` owns chat list workflows: selecting
chats, creating/deleting/forking chats, chat folders, reordering, exports, and
server-backed metadata watchers.

Its branch-graph action strictly hydrates every chat, abandons the result if the
character owner changes during hydration, then passes a view-only graph of
hashed greetings/message prefixes from `src/ts/gui/branches.ts` to the alert
modal. `src/lib/Others/AlertComp.svelte` exposes branch details on pointer hover
and keyboard focus. Guards are `src/lib/SideBars/SideChatList.svelte.test.ts`
and `src/lib/Others/AlertComp.branches.test.ts`.

When a concrete chat route is open, `SideChatList` enters a chat-open mode with
back/author-note/toggle controls and tears down Sortable until it returns to the
list. Chat-scoped generation controls live in
`ChatGenerationSettingsControls.svelte`, `Toggles.svelte`, and
`src/ts/activeChatGenerationSettings.ts`; server send/preview/continue/
regenerate reads the effective overlay in `server/fastify/src/prompt/`.
Queued generation-settings saves are optimistic and serialized per chat.
The chat generation-settings freshness guard prevents a differing character-row
response from rolling that visible value back before the save settles.

Saved Toggles is a captioned state button in
`src/lib/SideBars/ChatGenerationTogglePresets.svelte`. Its label distinguishes
unused, unlinked, preset-shape mismatch, edited, and matched states. It opens
`src/lib/SideBars/ChatGenerationTogglePresetDialog.svelte`; row selection changes
only the comparison target until the user explicitly applies or selects. The
dialog can save/overwrite, rename, delete, unselect, apply, or pick a complete
compatible value set from one active prompt-preset, module, or Agent source. Display order
is frozen when the dialog opens and sorts by toggle-key-set similarity,
active-count distance, `updatedAt`, then name. The selected id persists as
`generationSettings.togglePresetId`; loadouts preserve it. Preset records and
comparison/pick/sort logic live in
`src/ts/chatGenerationTogglePresetRecords.ts` and
`src/ts/chatGenerationTogglePresets.ts`; behavior is guarded by
`src/ts/chatGenerationTogglePresets.test.ts` and
`src/lib/SideBars/chatGenerationSettingsControls.test.ts`.

`src/lib/Others/LoadoutModal.svelte` exposes selective loadout apply and its
pending/queued/failure states. Apply does not navigate to a recorded character;
the fenced durable sequence is owned by
[Client Runtime](client-runtime.md#loadout-apply-sequencing).

Risk areas:

- Sidebar route application can reset `botMakerMode`; see the route-effect
  notes above.
- Character and chat reorders are optimistic command flows. Confirm rollback
  and resource reconciliation paths when the visible order changes.
- `ChatTranslationSettings.svelte` owns the three sparse active-chat
  translation toggles in the sidebar and exposes pending/queued/failed status
  from the chat-scoped durable update flow.
- Sortable setup/teardown and folder grouping live outside the main Svelte
  markup in `dropList.ts`, `sidebarCharList.ts`, and `chatFolderGrouping.ts`.
  `sidebarDrag.ts` validates pointer-drag ownership against the captured order.
  Use the pure position/movement resolvers in `sidebarOrganizer.ts` when wiring
  accessible keyboard/menu organizer actions.
- Hotkeys in `src/ts/hotkey.ts` use DOM selectors and visible state; UI class or
  structure changes can affect keyboard actions.

Anchor coverage includes `SideChatList.svelte.test.ts`,
`Sidebar.keyboard.dom.test.ts`, `sidebarOrganizer.test.ts`,
`sidebarDrag.test.ts`, and `chatGenerationSettingsControls.test.ts`. Use
`rg --files src/lib/SideBars | rg '\.test\.ts$'` to find narrower colocated
coverage.

## Settings And Shared Controls

Settings have two layers:

- `src/lib/Setting/Settings.svelte` is the manual settings shell. It owns the
  left nav, mobile/desktop split, close button, `SettingsMenuIndex` page switch,
  and routes such as `/settings/display` or `/settings/plugins`.
- `src/lib/Setting/SettingRenderer.svelte` renders data-driven rows from
  `src/ts/setting/*SettingsData*` through `src/ts/setting/settingRegistry.ts`
  and wrapper components.

Current settings indexes:

| Index | Primary slug      | Page/component behavior                                                                       |
| ----- | ----------------- | --------------------------------------------------------------------------------------------- |
| `0`   | `backup`          | `UserSettings`.                                                                               |
| `1`   | `bot-preset`      | Legacy `BotSettings` when legacy bot presets exist; otherwise model settings.                 |
| `2`   | `other-bots`      | `OtherBotSettings`.                                                                           |
| `3`   | `display`         | `DisplaySettings`.                                                                            |
| `4`   | `plugins`         | `PluginSettings`.                                                                             |
| `6`   | `advanced`        | `AdvancedSettings`.                                                                           |
| `7`   | `communities`     | `Communities`.                                                                                |
| `8`   | `global-lorebook` | Legacy `GlobalLoreBookSettings`; nav hidden unless the advanced visibility toggle is enabled. |
| `9`   | `global-regex`    | Legacy `GlobalRegex`; nav hidden unless the advanced visibility toggle is enabled.            |
| `10`  | `language`        | `LanguageSettings`.                                                                           |
| `11`  | `accessibility`   | `AccessibilitySettings`.                                                                      |
| `12`  | `persona`         | `PersonaSettings`.                                                                            |
| `13`  | `prompt`          | Prompt-template editing through `PromptSettings`.                                             |
| `14`  | `modules`         | `ModuleSettings`.                                                                             |
| `15`  | `hotkeys`         | `HotkeySettings`.                                                                             |
| `17`  | `model`           | Profile-first model settings.                                                                 |
| `18`  | `prompt-settings` | Prompt preset/settings shell.                                                                 |
| `19`  | `agent-presets`   | `AgentPresetSettings`.                                                                        |
| `20`  | `input-hooks`     | Draft and BTW input-hook definitions through `InputHookSettings`.                             |
| `21`  | `request-history` | Durable LLM request records and retention controls through `RequestHistorySettings`.          |
| `77`  | `supporter`       | `ThanksPage`.                                                                                 |

When `enableRisuaiProTools` is on, Settings also shows an Easy Panel nav button.
It opens the global `easyPanelStore` overlay instead of a routed
`/settings/:section` page.

The Data navigation group contains Backup & Restore plus Request History.
Request History reads private summaries/details through
`src/ts/server/requestHistory.ts`; retention uses the server-backed
`requestHistoryLimit` setting, and individual deletion uses the authenticated
operational route. Its detail view separates RisuAI request metadata from
additional non-content metadata returned by the provider API.

`ModuleSettings.svelte` restores reload-durable module-editor drafts from
`src/ts/server/moduleEditorDraftStore.ts`, rebases them over the latest canonical
module, and exposes copy/export/discard recovery if the target disappeared.
These encrypted drafts are not mutation-outbox entries; see
[Client Runtime](client-runtime.md#draft-recovery-stores).

Data-driven setting definitions use `SettingItem` from `src/ts/setting/types.ts`.
Important fields are `id`, `type`, `labelKey`, `helpKey`, `bindKey`,
`fallbackLabel`, `helpUnrecommended`, `showExperimental`, `bindPath`,
`condition`, `getValue`, `setValue`, `onChange`, `options`, `keywords`,
`classes`, `containerClasses`, `componentId`, and `componentProps`.
`SettingContext` also carries `presetMirrorTarget` for prompt/model preset
mirror rows.

Agents and Agent Presets are not data-driven settings rows. The live UI is
`AgentPresetSettings.svelte`, with `AgentSettingsSection.svelte` and
`AgentEditorDrawer.svelte` for reusable Agent behavior, plus
`AgentPresetEditorDrawer.svelte` for composition. Helpers in `src/ts/agents.ts`
own Agent and preset-use mutations; `src/ts/agentPresets.ts` owns preset-row
mutations. The page creates, edits, duplicates, deletes, and reorders Agents and
presets, selects the global default preset, and attaches existing Agents to a
preset. An Agent editor owns its instruction, prepared inputs, output format,
boolean/select/text/textarea toggle definitions, named Agent-only lorebook
inputs, and model/runtime defaults. `LoreBookData.svelte` owns the Agent-only
entry controls and disables normal activation controls for those entries.
`src/ts/agentLorebookInputs.ts` validates runtime resolution. A preset-use
editor owns phase, dependency/output wiring, destination, failure policy, and
optional model/runtime overrides. There is no generic port-mapping editor;
bounded prepared inputs, Agent toggles, and Agent-only lorebook inputs are the
supported authoring surface. The sidebar chat
generation controls save the chat-scoped `agentPresetId`. Keep
validation/planning in the shared record/reference/resolver helpers rather than
duplicating it in the component. [Providers And Models](../../docs/structure/providers-and-models.md#agent-preset-model-flow)
owns the execution and completeness contract. During chat generation,
`AgentPresetProgress.svelte` consumes
chat-scoped `agent_preset_progress` snapshots and shows the current phase,
active helper steps, and completed/total count above the transcript. The preset
editor's Diagnostics panel lazily hydrates chat transcripts only when opened,
filters `Message.generationInfo.agentPreset` by the preset's stable ID, and
renders a bounded newest-first run history with hidden output previews,
failures, timing/model details, and prepared-input notes. Imported metadata is
normalized at the frontend boundary before it reaches the panel. The removed
Context Agent page and `/settings/context-agent` route are not compatibility aliases.

The settings shell currently separates model and prompt work: settings index
`17` is model settings, `18` is prompt settings, `13` is prompt templates, and
the legacy Chat Bot/bot-preset page appears only when legacy bot presets still
exist. Keep router slug maps, `SettingsMenuIndex`, and page visibility
conditions aligned when changing these sections.

Prompt template editing and enable/disable controls belong to the selected
modern prompt preset; legacy bot-preset prompt templates remain compatibility UI
for old saves and explicit extraction paths.

The prompt-preset branch of `botpreset.svelte` treats `promptPresets[].archived`
as organization metadata. Its default view excludes archived rows, its archive
view includes only archived rows, and both views retain stable-id selection and
mutation behavior; archiving does not clear existing global, chat, or loadout
references.

Legacy global lorebook and regex nav buttons are hidden by default through
`showGlobalLorebookAndRegex`, defined in
`src/ts/setting/advancedSettingsData.ts`. They also remain hidden in lite mode.
This visibility flag controls navigation, not execution of imported legacy
global data. New global functionality should be implemented as modules, not
added to those legacy global pages. Visibility/default behavior is guarded by
`src/lib/Setting/Settings.svelte.test.ts`,
`src/ts/setting/advancedSettingsData.test.ts`, and
`server/fastify/__tests__/databaseDefaults.test.ts`.

Model settings are profile-first:

- `BotSettings.svelte` routes `settingsKind === 'model'` to
  `Model/ModelSettingsShell.svelte`.
- `ModelSettingsShell.svelte` owns the conversion prompt, Roles, Profiles, and
  API Credentials tabs plus Advanced Legacy Settings.
- The Roles tab uses `ModelProfileRoleList.svelte` to edit
  `Database.modelRoleProfiles`; valid binding changes apply automatically. It
  shows binding mode, inherited source, effective profile,
  provider/model/request-model summary, status, and fallback count for each
  canonical role.
- The Profiles tab uses `ModelProfileList.svelte` to show
  `Database.modelProfiles`, role usage, status, create/edit/duplicate/delete
  actions, and the runtime defaults panel.
- `ModelProfileEditorDrawer.svelte` is the command-backed durable profile
  editor. It covers first-class OpenAI, LLM Gateway, Anthropic, Google, Vertex,
  Ollama, Custom API, and Debug Echo panels, shared credential selection,
  profile runtime overrides, and fallbacks.
- `ProviderCredentialList.svelte` and
  `src/ts/model/providerCredentialRecords.ts` own shared API-key/Vertex
  credential CRUD, masked secret rotation, and deletion guards for credentials
  referenced by profiles.
- `ModelRuntimeDefaultsEditor.svelte` edits `Database.modelRuntimeDefaults`
  with explicit Save/Cancel and a count summary.
- `ModelPresetList.svelte`, hosted by `src/lib/Setting/botpreset.svelte`, is the
  embedded model preset picker/list for `modelPresets` and `modelPresetsId`.
  It can save current role settings, create empty presets, duplicate, reorder,
  delete, and show the prompt-preset model override notice.
- NanoGPT compatibility/account surfaces still live in `BotSettings.svelte` and
  shared UI helpers. `NanoGPTDashboard.svelte` fetches balance/subscription
  state and persists subscription state for request routing;
  `NanoGPTProviderPicker.svelte` fetches provider metadata for picker/filter UI.
- Advanced Legacy Settings embeds the old `ModelRoleList.svelte` plus legacy
  main/aux summaries. The legacy flat fields remain compatibility/conversion
  data for imports, presets, loadouts, and provider families without
  first-class panels. The accordion is hidden once every role's resolved source
  is `durable-profile`, including supported inherit bindings that resolve to a
  durable profile; legacy-inherit keeps it visible.

Model profile runtime state lives under `src/ts/model/`:

- `modelProfileRecords.ts` normalizes durable profile records, role bindings,
  runtime defaults, credential references, provider options, and fallback refs.
- `modelProfileResolver.ts` prefers durable profiles/bindings, supports
  inherited role bindings where allowed, reports ready/incomplete/
  compatibility/unsupported status, and falls back to legacy flat fields only
  for compatibility paths.
- `modelProfileUiState.ts` feeds role/profile summaries and provider
  visibility into the shell and legacy panel.

Value binding and persistence are centralized in `src/ts/setting/utils.ts`:

- `getSettingValue` reads from the composed resource database, `bindPath`, or
  custom getters.
- For a server-owned target, `setSettingValue` writes an optimistic local
  projection, runs `onChange`, and stages an encrypted durable settings intent
  before dispatch. Continuous controls are delayed briefly and coalesced by
  settings owner.
- `pendingBridgeFlushRegistry.ts` lets navigation, structural actions, and page
  exit flush queued owner patches before they can be overtaken.
- Retryable failures retain both the durable intent and its visible projection
  for replay. Terminal/non-durable failures roll back only attempted fields
  whose optimistic value is still current; successful responses can adopt the
  server's canonical value.

Workflow components must surface `accepted`, `queued`, and `failed` outcomes;
`queued` is retained intent, not server success. The canonical caller contract
is in
[Server Resources And Bridges](../../docs/structure/server-resources-and-bridges.md#durable-mutation-recovery-command-queue-and-local-acknowledgements).

The global saving icon is driven by `src/ts/server/persistenceActivity.svelte.ts`
and remains active for in-flight mutations or this writer's queued outbox
intents. Controls still expose busy/disabled state and local failures;
short-lived Saving/Queued text rows were removed in favor of this stable
indicator plus the existing queued notifications.

`src/lib/Setting/Pages/Display/NotificationToggle.svelte` also renders the
serialized push coordinator's setup compensation, pending cleanup/local
inspection, retry-storage, and retry-operation states. Device/server ordering
and the reload-persistent retry ledger are owned by
[Client Runtime](client-runtime.md#push-notification-coordinator).

Custom data-driven rows escape through `src/ts/setting/customComponents.ts`.
Use this for complex controls such as display editors, translator presets,
separate parameters, custom models, custom sidebar config, and export buttons.
Current registry entries include `SeparateParametersSection`,
`TranslatorPresetSettings`, `BanCharacterSetSettings`, `CustomModelsSettings`,
`SettingsExportButtons`, `CustomSidebarConfig`, `ColorSchemeSelect`,
`CustomColorSchemeEditor`, `CustomTextThemeEditor`, `CustomBackgroundToggle`,
`NullableTextColorToggle`, and `NotificationToggle`.

Settings risk areas:

- A setting not appearing is usually a `condition`, slug/index, registry, or
  data-file issue rather than a page-shell issue.
- A setting not saving is usually `src/ts/setting/utils.ts`,
  `src/ts/server/settingsBridge.svelte.ts`, or a missing settings command group.
- `SettingSelect` and `SettingSegmented` can reset to a visible option when the
  current value is hidden by conditions.
- Wrapper-local `$state` mirrors must stay in sync with the underlying resource
  value; stale controls often come from missing read dependencies or over-eager
  writeback.
- `TextAreaInput.svelte` is complex: highlighting, autocomplete, popup editor,
  context menu, contenteditable mode, and cleanup share one primitive.
- `src/lib/Others/PopupEditor.svelte` snapshots the device-specific
  `useMonacoEditorOnDesktop` or `useMonacoEditorOnMobile` setting when a popup
  session opens. Accessibility settings own both toggles; disabled mode renders
  a textarea instead of lazy-loading Monaco. See
  `src/lib/Others/PopupEditor.svelte.test.ts`.
- Fullscreen is browser-session state rendered by
  `src/lib/Setting/Pages/Display/FullscreenToggle.svelte`, not a persisted
  settings field.
- `SliderInput.svelte` uses disabled sentinels and sane `min`/`max`, supports
  touch-safe horizontal dragging while preserving vertical page pan, and offers
  an inline typed numeric editor.
- Display/theme tabs have repeated compact class patterns in
  `DisplaySettings.svelte`, `BotSettings.svelte`, and `OtherBotSettings.svelte`;
  check those page files before changing shared primitives for tab-only spacing
  problems.

Relevant tests include `src/lib/Setting/Settings.svelte.test.ts`,
`src/lib/Setting/SettingRenderer.svelte.test.ts`,
`src/lib/Setting/Wrappers/SettingAccordion.svelte.test.ts`,
`src/lib/Setting/Pages/PluginSettings.svelte.test.ts`,
`src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts`,
`src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte.test.ts`,
`src/lib/Setting/Pages/Model/ModelProfileList.svelte.test.ts`,
`src/lib/Setting/Pages/Model/ProviderCredentialList.svelte.test.ts`,
`src/lib/Setting/Pages/Model/ModelProfileEditorDrawer.svelte.test.ts`,
`src/lib/Setting/Pages/Model/ModelRuntimeDefaultsEditor.svelte.test.ts`,
`src/lib/Setting/Pages/RequestHistorySettings.svelte.test.ts`,
`src/lib/Setting/pickerGenerationSettings.test.ts`,
`src/ts/agentLorebookInputs.test.ts`,
`src/ts/setting/displaySettingsData.svelte.test.ts`, and
`src/ts/setting/utils.test.ts`. Shared control coverage includes
`src/lib/UI/GUI/TextAreaInput.svelte.test.ts` and
`src/lib/UI/GUI/TextAreaResizable.svelte.test.ts`.

## Localization

`src/lang/en.ts` is the full UI string contract. Other language files are deep
partials merged over English in `src/lang/index.ts`. Data-driven settings prefer
`labelKey`, `helpKey`, and option `labelKey`; `fallbackLabel` is an escape
hatch.

When adding strings that appear in frontend UI, add an English key under
`src/lang/en.ts`. Other locale omissions fall back to English.

Language settings retain translation-cache import/export and the global
cached-only/input-translation controls. Automatic message translation is
chat-scoped in the sidebar rather than a language setting. The old
UI-translation template download is intentionally absent; its regression guard is
`src/ts/setting/languageSettingsData.test.ts`. The broader retired-settings
inventory is in
[Generated Files And Legacy Caveats](../../docs/structure/generated-and-legacy.md#stale-or-no-port-surfaces).

`src/lib/Others/Help.svelte` renders Markdown from `language.help`.

## Styling, Theme, And Layout

Global styles live in `src/styles.css`. Tailwind v4 uses theme variables backed
by CSS variables such as `--risu-theme-bgcolor`, `--risu-theme-textcolor`, and
`--risu-height-size`.

Display settings update CSS through:

- `src/ts/gui/colorscheme.ts` for color scheme and text theme variables;
- `src/ts/gui/guisize.ts` for sidebar/text area sizing variables;
- `src/ts/gui/animation.ts` for animation speed and the app-owned
  `risu-reduced-motion` root class;
- `CustomCSSStore` in `src/ts/stores.svelte.ts` for user custom CSS injection.

`chatScreenWidth` is a durable display setting applied by
`DefaultChatScreen.svelte` through `--chat-screen-width`; it constrains both the
transcript and composer/draft card without changing the outer app shell.

The Reduced Motion toggle is a durable Accessibility setting defined in
`src/ts/setting/accessibilitySettingsData.ts`. Bootstrap and settings local
effects call `updateReducedMotion()`; `src/styles.css` and progress components
key reduced transitions/shimmers from the root class. It is not inferred from
the operating-system media preference.

The body is overflow-hidden and full-height, and `#app` uses `overflow: clip`.
`src/ts/gui/viewportScrollGuard.ts` pins the document root at scroll origin;
installing it before mount prevents browser focus, `scrollIntoView`, custom CSS,
or automation from shifting the fixed app shell. Scroll inner containers only.
Never add code that scrolls the window or document root. Layout clipping,
double scrollbars, or invisible content often starts with `src/styles.css`,
route branch height classes, or a child container missing
`min-w-0`/overflow constraints. Root pinning is guarded by
`src/ts/gui/viewportScrollGuard.test.ts`.

## Mobile And Lite

`DynamicGUI` is set from `window.innerWidth <= 1024` in
`src/ts/stores.svelte.ts`. `sideBarStore`, `sideBarClosing`, `SizeStore`,
`MobileGUI`, `MobileGUIStack`, `MobileSideBar`, and `MobileSearch` control
responsive behavior.

Current live app caveat: the full `MobileHeader`, `MobileBody`, and
`MobileFooter` shell is not mounted from `src/App.svelte`. Do not debug those
files for a live mobile issue unless you are deliberately re-enabling that
shell. `GridCatalog.svelte` and `MobileCharacters.svelte` are active.
Relevant grid/modal tests include `src/lib/Others/GridCatalog.svelte.test.ts`,
`src/lib/Others/ChatList.svelte.test.ts`,
`src/lib/Others/WelcomeRisu.svelte.test.ts`,
and `src/lib/Others/IrisModal.svelte.test.ts`.

Lite mode is controlled by `VITE_RISU_LITE` and `src/ts/lite.ts`, not by
`LiteMain.svelte` as a live entrypoint.

## Playground

`src/lib/Playground/PlaygroundMenu.svelte` maps `PlaygroundStore` values to
tool components. Keep its buttons aligned with route slug maps in
`src/ts/router.ts`.

Important values:

- `1`: menu
- `2`: playground chat, using `src/ts/playground.ts`
- `3`: embedding
- `4`: tokenizer
- `5`: syntax
- `6`: Jinja
- `7`: image generation
- `8`: parser
- `9`: subtitles
- `10`: image translation
- `11`: translation
- `12`: MCP
- `13`: CBS docs
- `14`: inlay explorer
- `101`: tool conversion

Tool-specific issues usually belong in the corresponding
`src/lib/Playground/*.svelte` file after confirming the route/store mapping.
Focused playground tests include `ToolConversion.svelte.test.ts`,
`PlaygroundSubtitle.svelte.test.ts`, `PlaygroundSubtitle.test.ts`, and
`PlaygroundImageTrans.svelte.test.ts`.

## Visible-State Testing

Follow the visible-state contract in
[Testing And Operations](../../docs/structure/testing-and-operations.md#visible-state-test-contract).
For UI/UX changes, assert the rendered result after the transition that changes
state. Helper assertions and command payload checks can support the test, but
they do not replace DOM-visible coverage for stale UI bugs.

Common commands:

```sh
pnpm check
pnpm test -- src/ts/router.test.ts # history, queued jumps, route ownership, and stale navigation
pnpm test -- src/App.routeEffect.dom.test.ts
pnpm test -- src/lib/Setting/Settings.svelte.test.ts src/lib/Setting/SettingRenderer.svelte.test.ts src/ts/setting/utils.test.ts
pnpm test -- src/lib/SideBars/SideChatList.svelte.test.ts
pnpm test -- src/lib/ChatScreens/ChatBody.svelte.test.ts
pnpm test -- src/lib/Others/GridCatalog.svelte.test.ts src/lib/Playground/ToolConversion.svelte.test.ts
pnpm smoke:fastify-browser
```

Use `pnpm dev:agent` when an agent needs the full-stack app in a browser. It
serves the frontend at `http://localhost:6418`, proxies Fastify on port `6419`,
and bypasses auth/TOS for agent sessions. Stop it when finished.
