# Svelte UI Guide

Last audited: 2026-07-13.

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

| Symptom                                                                              | Inspect first                                                                                                   | Then inspect                                                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| App is stuck on legal, loading, settings, grid, or chat                              | `src/App.svelte`, `src/main.ts`, `src/ts/bootstrap.ts`                                                          | `src/ts/stores.svelte.ts`, `src/ts/router.ts`, `src/styles.css`                                                                          |
| URL, back/forward, settings section, playground tool, or character route is wrong    | `src/ts/router.ts`, `src/App.svelte` route effects                                                              | `src/ts/router.test.ts`, `src/App.routeEffect*.test.ts`                                                                                  |
| Theme, spacing, clipping, colors, font, UI scale, or custom CSS is wrong             | `src/styles.css`, `src/ts/gui/colorscheme.ts`, `src/ts/gui/guisize.ts`                                          | `src/lib/Setting/Pages/DisplaySettings.svelte`, `src/ts/setting/displaySettingsData.svelte.ts`                                           |
| A settings page or left-nav item is wrong                                            | `src/lib/Setting/Settings.svelte`, `src/ts/router.ts` setting slug maps                                         | The concrete `src/lib/Setting/Pages/*.svelte` page                                                                                       |
| Agent Preset authoring, status, or chat selection is wrong                           | `src/lib/Setting/Pages/AgentPresetSettings.svelte`, `src/lib/Setting/Pages/AgentPresetEditorDrawer.svelte`, `src/lib/SideBars/ChatGenerationSettingsControls.svelte` | `src/ts/agentPresetRecords.ts`, `src/ts/agentPresetReferences.ts`, `src/ts/agentPresetResolver.ts`, `src/ts/agentPresets.ts`, `server/fastify/src/commands/agentPresets.ts` |
| A model role/profile summary, inherited role, or provider panel visibility is wrong  | `src/lib/Setting/Pages/Model/ModelSettingsShell.svelte`, `ModelProfileRoleList.svelte`, `ModelProfileList.svelte`, `ModelProviderPanel.svelte`, `src/ts/model/modelProfileUiState.ts` | `src/ts/model/modelProfileResolver.ts`, legacy `ModelRoleList.svelte` inside Advanced Legacy Settings, `docs/structure/providers-and-models.md` |
| A data-driven setting row is missing, hidden, stale, or not saving                   | `src/lib/Setting/SettingRenderer.svelte`, `src/ts/setting/*SettingsData*`, `src/ts/setting/utils.ts`            | `src/lib/Setting/Wrappers/*`, `src/ts/server/settingsBridge.svelte.ts`                                                                   |
| A shared input/control is visually or behaviorally wrong                             | The primitive in `src/lib/UI/GUI/`                                                                              | The wrapper in `src/lib/Setting/Wrappers/` if it only breaks in settings                                                                 |
| Chat transcript, composer, send buttons, scroll, or hydration state is wrong         | `src/lib/ChatScreens/DefaultChatScreen.svelte`, `src/lib/ChatScreens/Chats.svelte`                              | `src/ts/server/chatMessageHydration.svelte.ts`, `src/ts/chatCommands.ts`                                                                 |
| Message HTML, translation, parser, inlays, or partial edit is wrong                  | `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/ChatBody.svelte`, `src/lib/ChatScreens/ChatBodyParseMemo.ts` | `src/ts/parser/`, `src/ts/process/files/`, `src/ts/globalApi.svelte.ts`                                                               |
| Sidebar, character list, chat list, folders, reorder, or character config is wrong   | `src/lib/SideBars/Sidebar.svelte`, `src/lib/SideBars/SideChatList.svelte`, `src/lib/SideBars/CharConfig.svelte` | `src/lib/SideBars/sidebarCharList.ts`, `src/lib/SideBars/chatFolderGrouping.ts`, `src/ts/characterCommands.ts`, `src/ts/chatCommands.ts` |
| Alert, popup, bookmark, Hypa V3, loadout, Iris, or plugin warning hides or blocks UI | `src/App.svelte`, `src/lib/Others/AlertComp.svelte`, `src/ts/alert.ts`                                          | The specific modal under `src/lib/Others/`                                                                                               |
| Grid/mobile character picker is wrong                                                | `src/lib/Others/GridCatalog.svelte`, `src/lib/Mobile/MobileCharacters.svelte`                                   | `src/ts/stores.svelte.ts` mobile stores                                                                                                  |
| Playground menu/tool routing is wrong                                                | `src/lib/Playground/PlaygroundMenu.svelte`, `src/ts/router.ts`, `src/ts/playground.ts`                          | The specific `src/lib/Playground/*.svelte` tool                                                                                          |

## Entrypoints And Shell

| Path                  | Role                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`          | Mounts `#app` and loads `/src/main.ts`.                                                                                                                                                                  |
| `src/main.ts`         | Imports polyfills/storage state, installs the store router, mounts `App.svelte`, optionally installs the Fastify browser smoke hook, calls `loadData()`, initializes hotkeys, and removes `#preloading`. |
| `src/App.svelte`      | Main render switch and overlay host. It owns legal/loading/settings/grid/sidebar/chat priority and global modal mounting.                                                                                |
| `src/styles.css`      | Tailwind v4 import, theme variable defaults, full-height app CSS, global chat text CSS, and Tailwind compatibility base rules.                                                                           |
| `src/ts/bootstrap.ts` | Browser startup coordinator. It loads Fastify resources, starts hydration/events/bridges, then updates UI-derived CSS state.                                                                            |
| `src/ts/platform.ts`  | Fastify-only platform flag. `isFastifyServer` is hard-coded true.                                                                                                                                        |

`src/LiteMain.svelte` exists but is not the live entrypoint. Live lite behavior
comes from `VITE_RISU_LITE`, `src/ts/lite.ts`, and consumers in settings/theme
and legacy mobile code.

`src/App.svelte` also owns app-level drag/drop import. Dropped `.risup` files
import presets, `.risum` files import modules through the Fastify-backed browser
module path, and other supported files fall through to character/card import.

## App Render Priority

`src/App.svelte` renders in this order:

1. Legal/setup screen when `VITE_RISU_LEGAL_CONFIGURED` is false.
2. April 1 joke screen.
3. Loading screen while `$loadedStore` is false.
4. `CustomGUISettingMenu` when `$CustomGUISettingMenuStore` is true.
5. `Settings` when `$settingsOpen` is true.
6. `GridCatalog` when `$currentRoute.kind === 'grid'`.
7. Normal shell: `Sidebar` plus `ChatScreen`.

Global overlays mount after the main branch. The common blockers are
`AlertComp`, Realm popup/frame, preset/persona lists, bookmarks, Hypa V3 modal
and progress, save popup icon, plugin alert modal, popup list, EasyPanel,
popup editor, loadout modal, Iris modal, and custom sidebar config.

If the expected screen is missing, first confirm no higher-priority branch or
overlay is mounted.

## Routes And Stores

Routing is implemented in `src/ts/router.ts`. It parses `window.location`, keeps
`currentRoute`, applies URL changes to stores, and syncs store changes back to
the URL. Route changes are not file-system based.

| Route                               | Store effect                                                  |
| ----------------------------------- | ------------------------------------------------------------- |
| `/`                                 | Home, `selectedCharID = -1`, settings/playground closed.      |
| `/settings`                         | Opens settings; split layout auto-selects model settings, mobile shows the settings list. |
| `/settings/:section`                | Opens settings and maps section slugs to `SettingsMenuIndex`. |
| `/grid` and `/characters`           | Opens the character grid.                                     |
| `/character/:chaId/:chatId?`        | Selects the character and optionally selects a chat.          |
| `/characters/:chaId/chats/:chatId?` | Legacy character/chat route shape.                            |
| `/playground/:tool`                 | Maps tool slugs to `PlaygroundStore`.                         |
| `/inlay` or `/inlays`               | Opens the inlay explorer through `PlaygroundStore = 14`.      |
| Unknown paths                       | Parse as `not-found` and close route-owned surfaces.          |

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

## Component Ownership

| Path                        | Visible ownership                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ChatScreens/`      | Main chat workflow: themed chat frame, transcript, composer, message rows, parser/translation HTML, suggestions, assets, partial edit, resize/emotion displays.            |
| `src/lib/SideBars/`         | Desktop navigation and side-panel workflows: characters, folders, chat list, chat folders, character config, lorebook, scripts, quick settings, dev tools, custom sidebar. |
| `src/lib/Setting/`          | Settings shell, renderer, row wrappers, concrete pages, bot presets, persona lists, lore presets.                                                                          |
| `src/lib/Setting/Wrappers/` | Data-driven setting row renderers for check/text/number/textarea/slider/select/segmented/color/header/button/accordion/custom rows.                                        |
| `src/lib/Setting/Pages/`    | Concrete settings pages. Some are thin `SettingRenderer` hosts; others are large stateful pages.                                                                           |
| `src/lib/UI/`               | Shared higher-level UI: accordions, menus, model pickers, provider pickers, prompt rows, Realm UI.                                                                         |
| `src/lib/UI/GUI/`           | Shared primitive controls: buttons/icon buttons, text/optional/number/textarea/resizable textarea/syntax-highlighted textarea/select/option/slider/color inputs, segmented control, portals, multilingual fields, sidebar arrows. |
| `src/lib/Others/`           | Global modals and miscellaneous UI: alerts, grid catalog, bookmark/chat-list modals, Hypa V3, plugin alerts, popup editor, loadout, Iris, legal/setup.                     |
| `src/lib/Playground/`       | Playground menu and tools for parser/tokenizer/MCP/image/translation/subtitles/inlays/tool conversion.                                                                     |
| `src/lib/Mobile/`           | Mobile components. `MobileCharacters` is active through `GridCatalog`; the full mobile shell files are currently not mounted by `App.svelte`.                              |
| `src/lib/LiteUI/`           | Lite/hub card support. `LiteMain.svelte` is not the live app entrypoint.                                                                                                   |
| `src/lang/`                 | UI string contract. Add frontend strings here rather than hard-coding labels.                                                                                              |
| `src/etc/`                  | Bundled docs/media/tokenizer seed data imported by client code.                                                                                                            |

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
- generation stage/abort UI;
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
- `ChatBodyParseMemo.ts` owns parser/LLM-detection memoization and dependency
  signatures for the active chat, character, modules, settings, CBS state, and
  reload epochs; stale HTML or expensive rerenders can originate there.
- UI mutations should route through `src/ts/chatCommands.ts` and command/bridge
  helpers in Fastify mode.
- Generation-visible state starts in `DefaultChatScreen.svelte` but durable send
  and reattach behavior lives under `src/ts/process/`.

Relevant tests include `src/lib/ChatScreens/ChatBody.svelte.test.ts`,
`src/lib/ChatScreens/ChatBody.parseMemo.test.ts`,
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

When a concrete chat route is open, `SideChatList` enters a chat-open mode with
back/author-note/toggle controls and tears down Sortable until it returns to the
list. Chat-scoped generation controls live in
`ChatGenerationSettingsControls.svelte`, `Toggles.svelte`, and
`src/ts/activeChatGenerationSettings.ts`; server send/preview/continue/
regenerate reads the effective overlay in `server/fastify/src/prompt/`.
Queued generation-settings saves are optimistic and serialized per chat.
The chat generation-settings freshness guard prevents a differing character-row
response from rolling that visible value back before the save settles.

Risk areas:

- Sidebar route application can reset `botMakerMode`; see the route-effect
  notes above.
- Character and chat reorders are optimistic command flows. Confirm rollback
  and resource reconciliation paths when the visible order changes.
- Sortable setup/teardown and folder grouping live outside the main Svelte
  markup in `dropList.ts`, `sidebarCharList.ts`, and `chatFolderGrouping.ts`.
- Hotkeys in `src/ts/hotkey.ts` use DOM selectors and visible state; UI class or
  structure changes can affect keyboard actions.

Relevant tests include `src/lib/SideBars/SideChatList.svelte.test.ts`,
`src/lib/SideBars/Sidebar.charList.test.ts`,
`src/lib/SideBars/chatFolderGrouping.test.ts`,
`src/lib/SideBars/dropList.test.ts`,
`src/lib/SideBars/chatGenerationSettingsControls.test.ts`, and
`src/ts/hotkey.resourceGuard.test.ts`.

## Settings And Shared Controls

Settings have two layers:

- `src/lib/Setting/Settings.svelte` is the manual settings shell. It owns the
  left nav, mobile/desktop split, close button, `SettingsMenuIndex` page switch,
  and routes such as `/settings/display` or `/settings/plugins`.
- `src/lib/Setting/SettingRenderer.svelte` renders data-driven rows from
  `src/ts/setting/*SettingsData*` through `src/ts/setting/settingRegistry.ts`
  and wrapper components.

Current settings indexes:

| Index | Primary slug       | Page/component behavior                                     |
| ----- | ------------------ | ----------------------------------------------------------- |
| `0`   | `backup`           | `UserSettings`.                                             |
| `1`   | `bot-preset`       | Legacy `BotSettings` when legacy bot presets exist; otherwise model settings. |
| `2`   | `other-bots`       | `OtherBotSettings`.                                        |
| `3`   | `display`          | `DisplaySettings`.                                         |
| `4`   | `plugins`          | `PluginSettings`.                                          |
| `6`   | `advanced`         | `AdvancedSettings`.                                        |
| `7`   | `communities`      | `Communities`.                                             |
| `8`   | `global-lorebook`  | `GlobalLoreBookSettings`.                                  |
| `9`   | `global-regex`     | `GlobalRegex`.                                             |
| `10`  | `language`         | `LanguageSettings`.                                        |
| `11`  | `accessibility`    | `AccessibilitySettings`.                                   |
| `12`  | `persona`          | `PersonaSettings`.                                         |
| `13`  | `prompt`           | Prompt-template editing through `PromptSettings`.           |
| `14`  | `modules`          | `ModuleSettings`.                                          |
| `15`  | `hotkeys`          | `HotkeySettings`.                                          |
| `17`  | `model`            | Profile-first model settings.                              |
| `18`  | `prompt-settings`  | Prompt preset/settings shell.                              |
| `19`  | `agent-presets`    | `AgentPresetSettings`.                                     |
| `77`  | `supporter`        | `ThanksPage`.                                              |

When `enableRisuaiProTools` is on, Settings also shows an Easy Panel nav button.
It opens the global `easyPanelStore` overlay instead of a routed
`/settings/:section` page.

Data-driven setting definitions use `SettingItem` from `src/ts/setting/types.ts`.
Important fields are `id`, `type`, `labelKey`, `helpKey`, `bindKey`,
`fallbackLabel`, `helpUnrecommended`, `showExperimental`, `bindPath`,
`condition`, `getValue`, `setValue`, `onChange`, `options`, `keywords`,
`classes`, `containerClasses`, `componentId`, and `componentProps`.
`SettingContext` also carries `presetMirrorTarget` for prompt/model preset
mirror rows.

Agent Presets are not data-driven settings rows. The live UI is
`AgentPresetSettings.svelte` plus `AgentPresetEditorDrawer.svelte`, using
row-oriented command helpers from `src/ts/agentPresets.ts`. The page creates,
edits, duplicates, deletes, reorders, and selects the global default preset;
the sidebar chat generation controls save the chat-scoped
`agentPresetId`. Prepared-input checkboxes expose their matching `{{scope}}`
placeholder, and `mainDraft` is shown only for after-main steps. Changing phase
removes scopes and dependencies that are no longer valid. Step instructions can
chain an eligible earlier output through `{{agent::outputKey}}`; missing,
same-level, disabled, or future references appear as `Incomplete` and block
generation. During chat generation, `AgentPresetProgress.svelte` consumes
chat-scoped `agent_preset_progress` snapshots and shows the current phase,
active helper steps, and completed/total count above the transcript. The removed
Context Agent page and `/settings/context-agent` route are not compatibility aliases.

The settings shell currently separates model and prompt work: settings index
`17` is model settings, `18` is prompt settings, `13` is prompt templates, and
the legacy Chat Bot/bot-preset page appears only when legacy bot presets still
exist. Keep router slug maps, `SettingsMenuIndex`, and page visibility
conditions aligned when changing these sections.

Prompt template editing and enable/disable controls belong to the selected
modern prompt preset; legacy bot-preset prompt templates remain compatibility UI
for old saves and explicit extraction paths.

Model settings are profile-first:

- `BotSettings.svelte` routes `settingsKind === 'model'` to
  `Model/ModelSettingsShell.svelte`.
- `ModelSettingsShell.svelte` owns the conversion prompt, Roles/Profiles
  segmented tabs, and Advanced Legacy Settings.
- The Roles tab uses `ModelProfileRoleList.svelte` to edit
  `Database.modelRoleProfiles` with explicit Apply/Cancel. It shows binding
  mode, inherited source, effective profile, provider/model/request-model
  summary, status, and fallback count for each canonical role.
- The Profiles tab uses `ModelProfileList.svelte` to show
  `Database.modelProfiles`, role usage, status, create/edit/duplicate/delete
  actions, and the runtime defaults panel.
- `ModelProfileEditorDrawer.svelte` is the command-backed durable profile
  editor. It covers first-class OpenAI, Anthropic, Google, Vertex, Ollama,
  Custom API, and Debug Echo panels, profile runtime overrides, fallbacks, and
  secret preserve/replace/clear behavior.
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
  runtime defaults, provider options, and fallback refs.
- `modelProfileResolver.ts` prefers durable profiles/bindings, supports
  inherited role bindings where allowed, reports ready/incomplete/
  compatibility/unsupported status, and falls back to legacy flat fields only
  for compatibility paths.
- `modelProfileUiState.ts` feeds role/profile summaries and provider
  visibility into the shell and legacy panel.

Value binding and persistence are centralized in `src/ts/setting/utils.ts`:

- `getSettingValue` reads from the composed resource database, `bindPath`, or
  custom getters.
- `setSettingValue` writes locally inside `withTrustedResourceWrite`,
  runs `onChange`, then sends a server settings patch when commands are
  available.
- Failed command patches roll the local value back only if the attempted value
  is still visible.

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
- A setting not saving is usually `utils.ts`, `settingsBridge.svelte.ts`, or a
  missing settings command group.
- `SettingSelect` and `SettingSegmented` can reset to a visible option when the
  current value is hidden by conditions.
- Wrapper-local `$state` mirrors must stay in sync with the underlying resource
  value; stale controls often come from missing read dependencies or over-eager
  writeback.
- `TextAreaInput.svelte` is complex: highlighting, autocomplete, popup editor,
  context menu, contenteditable mode, and cleanup share one primitive.
- `SliderInput.svelte` uses disabled sentinels and expects sane `min`/`max`.
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
`src/lib/Setting/Pages/Model/ModelRuntimeDefaultsEditor.svelte.test.ts`,
`src/lib/Setting/pickerGenerationSettings.test.ts`,
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

`src/lib/Others/Help.svelte` renders Markdown from `language.help`.

## Styling, Theme, And Layout

Global styles live in `src/styles.css`. Tailwind v4 uses theme variables backed
by CSS variables such as `--risu-theme-bgcolor`, `--risu-theme-textcolor`, and
`--risu-height-size`.

Display settings update CSS through:

- `src/ts/gui/colorscheme.ts` for color scheme and text theme variables;
- `src/ts/gui/guisize.ts` for sidebar/text area sizing variables;
- `src/ts/gui/animation.ts` for animation speed;
- `CustomCSSStore` in `src/ts/stores.svelte.ts` for user custom CSS injection.

The body is overflow-hidden and full-height. Layout clipping, double scrollbars,
or invisible content often starts with `src/styles.css`, route branch height
classes, or a child container missing `min-w-0`/overflow constraints.

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
`src/lib/Others/IrisModal.svelte.test.ts`, and
`src/lib/Others/ProTools/EasyPanel.svelte.test.ts`.

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
`PlaygroundSubtitle.test.ts`, `PlaygroundSubtitle.sourceLang.svelte.test.ts`,
and `PlaygroundImageTrans.svelte.test.ts`.

## Visible-State Testing

Follow the visible-state contract in `docs/structure/testing-and-operations.md`.
For UI/UX changes, assert the rendered result after the transition that changes
state. Helper assertions and command payload checks can support the test, but
they do not replace DOM-visible coverage for stale UI bugs.

Common commands:

```sh
pnpm check
pnpm test -- src/ts/router.test.ts # light pending-route coverage, not a full route-map matrix
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
