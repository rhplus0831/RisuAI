# Settings And Provider Fields

Settings are split between data-driven `SettingRenderer` rows and hand-built settings pages. Any bound setting field ultimately patches a settings group.

## Generic Setting Renderer

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/SettingRenderer.svelte:33` | `item.id` | Generic setting row renderer. | Renders persistent settings when `bindKey` or `bindPath` is present. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Wrappers/SettingText.svelte:38` | `SettingText` | Data-defined text input. | Calls `setSettingValue`. | Client `src/ts/setting/utils.ts:65`, server `commands.ts:1319`. |
| `src/lib/Setting/Wrappers/SettingTextarea.svelte:38` | `SettingTextarea` | Data-defined textarea. | Calls `setSettingValue`. | Client `src/ts/setting/utils.ts:65`, server `commands.ts:1319`. |
| `src/lib/Setting/Wrappers/SettingButton.svelte:14` | `SettingButton` | Data-defined button. | Calls `item.options.onClick`; only rows whose handler patches settings or imports data persist. | Handler-specific; settings patches go to `commands.ts:1319`. |
| `src/ts/setting/utils.ts:65` | `setSettingValue` | Shared data setting write. | Updates local `DBState`, mirrors prompt/model preset values when active, builds server settings patch. | `server/fastify/src/routes/commands.ts:1319`. |

Persistent text/textarea row ids in the current data files:

| Source | Setting ids | Database change |
| --- | --- | --- |
| `src/ts/setting/advancedSettingsData.ts:37`, `:44`, `:50`, `:58`, `:65` | `adv.addPrompt`, `adv.descPrefix`, `adv.emoPrompt`, `adv.keiUrl`, `adv.presetChain` | Patches `additionalPrompt`, `descriptionPrefix`, `emotionPrompt2`, `keiServerURL`, `presetChain`. |
| `src/ts/setting/chatFormatSettingsData.ts:32` | `chatFormat.jinjaTemplate` | Patches `JinjaTemplate`. |
| `src/ts/setting/displaySettingsData.svelte.ts:44`, `:133`, `:423`, `:435`, `:447`, `:459`, `:494` | `display.guiHTML`, `display.customFont`, quote fields, `display.customCSS` | Patches display settings. `display.customGui` at `:34` only opens a modal. |
| `src/ts/setting/languageSettingsData.svelte.ts:151`, `:170`, `:179` | `lang.deeplKey`, `lang.deeplXUrl`, `lang.deeplXToken` | Patches translator settings. Cache export/import/clear buttons at `:278`, `:304`, `:349` affect local translator cache only, not the Fastify app DB. |

## Model And Provider Settings

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/BotSettings.svelte:98` through `:183` | `createServerBackedSettingDraft(...)` provider keys | Provider/model setting drafts. | Patches model/provider settings such as `aiModel`, `subModel`, Google/Vertex/OpenAI/Claude/Mistral/NovelAI/Ollama/OpenRouter/NanoGPT/Kobold/Ooba keys, URLs, flags, and tools. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/BotSettings.svelte:665` through `:1006` | provider `TextInput` fields | API key, URL, model, proxy, and provider text fields. | Updates the draft keys declared at `:98` through `:183`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/BotSettings.svelte:980` | `echoMessageDraft.value` | Echo message `TextAreaInput`. | Patches `echoMessage`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1077`, `:1088`, `:1091` | `activeLocalStopStringsDraft` | Add/remove stop string buttons and stop string `TextInput`. | Updates `localStopStrings`, either global settings or selected prompt preset override. | Settings `commands.ts:1319` or prompt preset patch `commands.ts:2063`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1251`, `:1266`, `:1272` | `biasDraft` | Add/remove bias buttons and bias text fields. | Updates generation bias fields in settings or selected prompt preset override. | Settings `commands.ts:1319` or prompt preset patch `commands.ts:2063`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1283`, `:1289`, `:1310`, `:1325`, `:1328`, `:1331` | `activeAdditionalParamsDraft` | Import/add/remove additional params buttons and key/value `TextInput`s. | Updates additional request params in settings or selected prompt preset override. | Settings `commands.ts:1319` or prompt preset patch `commands.ts:2063`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1433` | `moduleIntergrationDraft.value` | Module integration textarea. | Updates selected prompt preset `moduleIntergration`. | `server/fastify/src/routes/commands.ts:2063`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1467` | prompt preset icon upload button | Uploads/embeds prompt preset icon data. | Updates selected prompt preset `image`. | `server/fastify/src/routes/commands.ts:2063`. |
| `src/lib/Setting/Pages/BotSettings.svelte:1503`, `:1506`, `:1509` | `mainPromptDraft`, `jailbreakDraft`, `globalNoteDraft` | Prompt textareas. | Updates selected prompt preset prompt fields. | `server/fastify/src/routes/commands.ts:2063`. |
| `src/lib/Setting/Pages/OobaSettings.svelte:12` | Ooba drafts | Ooba reverse proxy and local stop-string text fields/buttons. | Patches Ooba settings or prompt preset override. | `server/fastify/src/routes/commands.ts:1319` or `:2063`. |
| `src/lib/Setting/Pages/OpenrouterSettings.svelte:17` through `:20` | OpenRouter drafts | Provider/fallback settings controls. | Patches OpenRouter provider settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:17` | `customModelsDraft` | Custom model text fields and add/remove buttons. | Updates `customModels`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/Model/AuxModelSelectors.svelte:15` through `:17` | aux model drafts | Aux model fields/selectors. | Updates separate auxiliary model settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/SeparateParametersSection.svelte:26`, `:30` | separate parameter drafts | Separate parameter text/number fields. | Updates `seperateParameters*` settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Others/ProTools/EasyPanel.svelte:33` through `:55` | Easy Panel drafts | Pro-tools model/parameter text fields. | Updates model/separate parameter settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/UI/NanoGPTDashboard.svelte` | NanoGPT dashboard actions | Subscription/provider state controls. | Updates NanoGPT settings through drafts declared in `BotSettings.svelte`. | `server/fastify/src/routes/commands.ts:1319`. |

## Media, TTS, Memory, Display, And Onboarding

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/OtherBotSettings.svelte:30` through `:74` | media/TTS/memory drafts | Image/TTS/memory setting drafts. | Patches image generation, TTS, and Hypa memory settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/OtherBotSettings.svelte:353` through `:1034` | provider text fields | WebUI/NAI/DALL-E/Stability/Comfy/Fal/Imagen/OpenAI-compatible/WaveSpeed/TTS keys and URLs. | Updates corresponding media/TTS settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/OtherBotSettings.svelte:587`, `:663`, `:954` | media asset upload buttons | Uploads image/reference assets and stores ids in settings. | Assets `server/fastify/src/routes/assets.ts:220`; settings `commands.ts:1319`. |
| `src/lib/Setting/Pages/OtherBotSettings.svelte:1068`, `:1081`, `:1103`, `:1128`, `:1159`, `:1204`, `:1211`, `:1246`, `:1341`, `:1346`, `:1348`, `:1350`, `:1355` | Hypa V3 preset/buttons/text fields | Creates, imports, deletes, renames, and edits Hypa memory presets/settings. | Settings `server/fastify/src/routes/commands.ts:1319`; memory preset collection may be written by the settings command. |
| `src/lib/Playground/PlaygroundEmbedding.svelte:16`, `:17` | `hypaV3Key`, `hypaCustomSettings` drafts | Embedding playground key/settings text fields. | Patches memory/provider settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte:23`, `:30`, `:36` | `customBackground` buttons | Sets/resets custom background; may upload/select asset source. | Settings `server/fastify/src/routes/commands.ts:1319`; asset upload if new file uses `server/fastify/src/routes/assets.ts:220`. |
| `src/lib/Setting/Pages/Display/NullableTextColorToggle.svelte:26` | nullable color input | Updates optional text color settings. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte:28` | color scheme editor fields/buttons | Updates `colorScheme`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/Display/CustomTextThemeEditor.svelte:17` | text theme editor fields/buttons | Updates `customTextTheme`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Setting/Pages/HotkeySettings.svelte:10`, controls at `:30`, `:40`, `:50`, `:60` | hotkey buttons/inputs | Updates `hotkeys`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Others/CustomSidebarConfig.svelte:12`, `:46`, `:73`, `:113` | `customSidebarItemsDraft` | Custom sidebar add/remove/search/config controls. | Updates `customSidebarItems`. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/SideBars/CustomSidebar.svelte:31`, `:40` | `aiModelDraft` and delegated `SettingRenderer` | Custom sidebar model field and chosen setting rows. | Updates `aiModel` or the selected server-backed setting. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/Others/WelcomeRisu.svelte:47`, `:65`, `:88`, `:91`, `:94`, buttons at `:369`, `:379` | onboarding setting handlers | Onboarding language, username, and provider key inputs/buttons. | Patches `language`, `username`, `openAIKey`, `openrouterKey`, `claudeAPIKey`, and onboarding-related settings. | `server/fastify/src/routes/commands.ts:1319`. |
