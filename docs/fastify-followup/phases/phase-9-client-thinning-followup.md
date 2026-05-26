# Phase 9 Follow-Up - Client Thinning

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make Fastify-served web a true server projection: durable writes go
through commands or import routes, direct projection writes fail, and
import/export events match the command map.

## Audit Findings

- Landed 2026-05-26: Fastify web bootstrap now enables the projection
  guard, startup projection replacement/normalization uses trusted
  writes, and browser smoke proves a direct projection write fails.
- Landed 2026-05-26: the named direct write examples below were routed
  through settings/character commands or trusted optimistic projection
  helpers:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1188`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1230`,
  `src/ts/stores.svelte.ts:185`,
  `src/lib/Setting/Pages/Display/NotificationToggle.svelte:10`, and
  `src/lib/Playground/PlaygroundMenu.svelte:35`.
- Landed 2026-05-26: `.risu` import/export event semantics now match the
  Phase 9 command map. Save routes receive the command event sink,
  import responses include and emit `state.imported`, export routes emit
  `state.exported` with the current revision, and focused route tests
  cover success and failure silence.
- Landed 2026-05-26: browser smoke/storage-write audit now proves both
  projection guard enforcement and multipart `.risu` import coverage.
- Landed 2026-05-26: chat and character module-selection writes in the
  module menu now run through command-backed trusted optimistic helpers
  instead of mutating the Fastify projection directly.
- Landed 2026-05-26: Bot/Ooba nested settings for `ooba`,
  `reverseProxyOobaArgs`, and `localStopStrings` now use
  `createServerBackedSettingDraft`; command allowlists cover `ooba`,
  `reverseProxyOobaArgs`, and `localStopStrings`, and focused client /
  Fastify command tests cover the mapping.
- Landed 2026-05-26: Bot parameter settings for `NAIsettings`,
  `ainconfig`, `bias`, and `additionalParams` now use
  `createServerBackedSettingDraft`; provider command allowlists and
  focused client / Fastify command tests cover the mapping.
- Landed 2026-05-26: Prompt settings now bind to local drafts that dispatch
  `patchPromptSettingsCommand`, and prompt-template editor changes keep
  optimistic updates / rollback behind trusted projection writes.
- Landed 2026-05-26: Provider routing and model scalar settings in
  `BotSettings.svelte` now bind through command-backed drafts, including
  top-level model selection, provider credentials, provider model fields,
  Google/Vertex/Ollama/NanoGPT/OpenRouter nested state, and related reset
  side effects. Fastify grouped settings validation now treats
  `customAPIFormat` and `ollamaRequestFormat` as numeric enum fields and
  accepts `NAIadventure` / `NAIappendName` in the provider group.
- Landed 2026-05-26: OpenRouter settings, auxiliary model selectors,
  separate-parameter selectors, and EasyPanel model / parameter shortcuts
  now bind through `createServerBackedSettingDraft`. The slice covers
  `openrouterFallback`, `openrouterMiddleOut`, `useInstructPrompt`,
  `openrouterProvider`, `aiModel`, `subModel`, `seperateModels`,
  `seperateModelsForAxModels`, `doNotChangeSeperateModels`,
  `seperateParameters`, `seperateParametersEnabled`,
  `seperateParametersByModel`, `epEnabled`, and
  `disableSeperateParameterChangeOnPresetChange`.
- Landed 2026-05-26: Image provider settings in `OtherBotSettings.svelte`
  now bind through `createServerBackedSettingDraft`, including
  `sdProvider`, `webUiUrl`, `sdSteps`, `sdCFG`, `sdConfig`,
  `NAIImgUrl`, `NAIApiKey`, `NAIImgModel`, `NAII2I`,
  `NAIImgConfig`, `openAIKey`, `dallEQuality`, Stability, ComfyUI,
  Fal, `google`, Imagen, `openaiCompatImage`, and `wavespeedImage`.
  WaveSpeed and NovelAI image upload/reset side effects now mutate local
  command-backed drafts instead of the Fastify projection directly.
- Landed 2026-05-26: Persona, display/theme, global regex, lore preset,
  and bot preset editors now avoid raw Fastify projection mutation.
  Persona profile and image helpers use trusted optimistic writes plus
  persona commands, bot presets continue through preset commands, global
  regex is covered by grouped settings commands, display custom
  color/text/background editors dispatch display settings patches, and
  lore preset list mutations use trusted local updates with lorebook
  commands/watchers.
- Landed 2026-05-26: Plugin settings, custom model editing, and advanced
  setting custom editors now avoid raw Fastify projection mutation.
  Plugin argument edits, enable/delete, import/update, plugin database
  bridge writes, and plugin storage updates use trusted optimistic
  writes with plugin/settings/storage commands. `customModels` and
  `banCharacterset` bind through `createServerBackedSettingDraft`, and
  client command grouping now covers `allowAllExtentionFiles` and
  `auxModelUnderModelSettings`.
- Landed 2026-05-26: Character core profile, media, and basic option
  editors in `CharConfig.svelte` now bind through
  `createServerBackedCharacterDraft` or trusted character/media helpers.
  The slice covers name, description, first message, portrait selection
  and rotation, emotion labels, view-screen and image-generation fields,
  additional asset rows/exclusions, and simple character option toggles.

## Tasks

- Continue keeping expected projection refresh, optimistic command
  replay, or rollback behind `withTrustedServerProjectionWrite`.
- Sweep remaining direct `DBState.db` writes reachable in Fastify web
  mode. Route durable settings, character, chat, memory-toggle, and
  playground writes through commands or explicitly disable them when they
  are unsupported.
- Continue with settings/editor binding surfaces after the module-menu
  Bot/Ooba, and Prompt settings-draft slices. Current high-yield grep:
  `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`.
  The next settings targets should reuse `createServerBackedSettingDraft`
  for nested top-level setting objects and remove those keys from
  `watchServerBackedSettings` in the same component to avoid duplicate
  command dispatch.
- Add any remaining command allowlist coverage found by the broader
  direct-write audit. The named slice added coverage for `notification`
  and `useAutoSuggestions`; module-selection reused existing chat and
  character-module command coverage.
- Event wiring is complete for `state.imported` and `state.exported`.
- Browser smoke/storage audit covers `.risu` import.

## Session Slices

Before each slice, refresh the line numbers with the focused grep for
that slice. Not every `DBState.db` write is a bug: command replay,
projection refresh, rollback, import, and local-only workflows can keep
trusted writes when they are intentionally outside durable Fastify-web
client mutation.

- 9A - Completed 2026-05-26: Provider routing and model scalar settings.
  Converted the remaining
  `BotSettings.svelte` top-level model/provider/API-key fields and their
  direct `oninput` assignments to local drafts plus grouped provider
  settings commands. Kept optimistic projection updates behind
  `withTrustedServerProjectionWrite`, removed duplicate
  `watchServerBackedSettings` keys, and extended command allowlist tests.
- 9B - Completed 2026-05-26: OpenRouter, auxiliary model, and
  separate-parameter selectors. Converted `OpenrouterSettings.svelte`,
  `AuxModelSelectors.svelte`, `SeparateParametersSection.svelte`, and
  the matching EasyPanel model / parameter shortcuts from direct
  projection bindings to command-backed drafts. Added grouped command
  allowlist coverage for `useInstructPrompt` and extended focused client
  / Fastify command tests for provider order/only/ignore arrays,
  auxiliary models, separate parameter overrides, and EasyPanel setup
  toggles.
- 9C - Completed 2026-05-26: Image provider settings. Covered the
  image-generation portions of
  `OtherBotSettings.svelte`: `sdConfig`, `NAIImgConfig`, `comfyConfig`,
  `openaiCompatImage`, `wavespeedImage`, `fal*`, Imagen, Stability, and
  related provider keys/models. Converted the surface to nested
  command-backed drafts, removed duplicate watcher keys, and extended
  focused client / Fastify command tests for media-group allowlists and
  masked image-provider secrets.
- 9D - Completed 2026-05-26: Memory and audio provider settings.
  Converted the Hypa V3 and audio / TTS portions of
  `OtherBotSettings.svelte` plus `PlaygroundEmbedding.svelte` to
  command-backed drafts. Covered `ttsAutoSpeech`, `elevenLabKey`,
  `voicevoxUrl`, `huggingfaceKey`, `fishSpeechKey`, `emotionProcesser`,
  `hypaV3`, `hypaV3Presets`, `hypaV3PresetId`, `hypaModel`,
  `hypaV3Key`, `hypaCustomSettings`, and `voyageApiKey`; shared
  `openAIKey` and `NAIApiKey` remained on the 9C drafts. Extended client
  command grouping and Fastify route tests for media / memory groups and
  masked provider secrets.
- 9E - Completed 2026-05-26: Persona, display/theme, global regex, lore
  preset, and bot preset editors. Converted `PersonaSettings.svelte`,
  `src/ts/persona.ts`, `GlobalRegex.svelte`, `lorepreset.svelte`,
  `botpreset.svelte`, custom background/color/text theme editors, and
  the shared setting renderer write path to command-backed or trusted
  optimistic writes. Added grouped settings coverage for `globalscript`
  and nullable text screen colors, and extended focused client /
  Fastify command tests.
- 9F - Completed 2026-05-26: Plugin, custom model, and advanced setting
  editors. Converted `PluginSettings.svelte`,
  `CustomModelsSettings.svelte`, `BanCharacterSetSettings.svelte`, and
  the plugin database/storage bridge to command-backed or trusted
  optimistic writes. Extended plugin bridge classification for
  `customModels`, `banCharacterset`, `allowAllExtentionFiles`,
  `auxModelUnderModelSettings`, and `pluginDevelopMode`, and added
  focused client / Fastify command tests.
- 9G - Completed 2026-05-26: Character core profile, media, and basic
  option editors. Added a selected-character draft bridge for scalar
  profile/media fields, converted the basic `CharConfig.svelte` profile
  and media bindings away from raw Fastify projection writes, kept chat
  `fmIndex` side effects behind trusted writes for the chat watcher, and
  wrapped character image/emotion helper mutations for projection-guard
  mode. Focused client, Fastify command route, and Svelte checks passed.
- 9H - Character lore, script, prompt, TTS, and chat-name editors. Cover
  the deeper `CharConfig.svelte` sections, `LoreBookSetting.svelte`,
  `LoreBookList.svelte`, `ChatList.svelte`, and side-chat name editors.
  Route character lore/script/prompt/TTS changes through character,
  lorebook, or chat commands.
- 9I - Sidebar toggles, custom sidebar/loadout helpers, welcome setup,
  and runtime API write classification. Cover `Toggles.svelte`,
  `CustomSidebar.svelte`, `CustomSidebarConfig.svelte`, `LoadoutModal`,
  `WelcomeRisu.svelte`, `globalApi.svelte.ts`, plugin API writes, and
  other helper writes found by the broader grep. Classify local runtime
  state separately from durable Fastify-web persistence.
- 9J - Final direct-write sweep and closeout. Rerun the broad
  `DBState.db` direct-write searches, add any remaining command allowlist
  coverage, run Fastify browser smoke, and move completed slice notes to
  `../phases-completed/`.

## Exit Criteria

- Fastify-served browser startup enables the projection guard. (Met by
  the 2026-05-26 guard slice.)
- A direct write to `DBState.db` in Fastify web mode fails unless it is
  wrapped in the trusted projection helper. (Met by the 2026-05-26 guard
  slice and browser smoke.)
- No reachable durable Fastify web workflow persists by direct client
  mutation.
- `.risu` import/export event behavior matches the command map. (Met by
  the 2026-05-26 event slice.)
- `pnpm smoke:fastify-browser` covers import and guard enforcement. (Met
  by the 2026-05-26 event slice.)

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/server/commands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm check
```

## References

- Original phase: `docs/fastify/phases/phase-9-client-thinning.md`
- Original command map:
  `docs/fastify/status/phase-9-command-map.md:186`
- projection guard default: `src/ts/server/projectionWriteGuard.svelte.ts:5`
- direct chat setting write:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1188`
- direct suggestion setting write:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1230`
- direct selected-character memory write: `src/ts/stores.svelte.ts:185`
- direct notification setting bind:
  `src/lib/Setting/Pages/Display/NotificationToggle.svelte:10`
- settings draft helper:
  `src/ts/server/settingsBridge.svelte.ts:32`
- Bot/Ooba settings draft consumers:
  `src/lib/Setting/Pages/BotSettings.svelte:128`,
  `src/lib/Setting/Pages/OobaSettings.svelte:12`
- Prompt settings draft consumer:
  `src/lib/Setting/Pages/PromptSettings.svelte:52`
- save route registration: `server/fastify/src/routes/save.ts:39`
- current state event catalog: `server/fastify/src/commands/events.ts:302`
