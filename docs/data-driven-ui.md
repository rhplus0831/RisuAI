# Data-dependent UI variation inventory

Last audited: 2026-07-17 at `73583c417`.

This is the identification pass for UI whose content, structure, available
actions, or semantic state changes with data. It is a map for later runtime
side-effect traces, not a claim that every variant is correct.

## Scope and method

The live graph was followed from `src/main.ts` and `src/App.svelte`, including
lazy imports, settings registries, plugin/module insertion points, and the
browser state that feeds Svelte. The scan found 184 reachable Svelte components
and 1,217 structural `{#if}`, `{#each}`, `{#await}`, and `{#key}` blocks. Those
blocks were consolidated into 88 logical variation points below; a single row
can own many leaf branches.

Included:

- a different screen, section, message form, label, empty/error/loading state,
  action set, or record ordering;
- asynchronous replacement of placeholders with hydrated, streamed, fetched,
  or asset-backed content;
- output supplied by characters, chats, settings, presets, plugins, modules,
  parsed markup, browser capabilities, build flags, locale, or time;
- meaningful disabled, missing-reference, incompatibility, and optimistic
  states even when their difference is partly visual.

Excluded:

- ordinary interpolation of a value into an otherwise unchanged input or text
  node;
- decorative-only color, spacing, animation, and theme changes;
- test harnesses and currently unmounted surfaces: `LiteMain.svelte`,
  `WelcomeRisu.svelte`, `PromptDiffModal.svelte`, `EmotionBox.svelte`,
  `PlaygroundRegex.svelte`, and the standalone `MobileBody`/`MobileHeader`/
  `MobileFooter` shell;
- `$MobileGUI === true` branches. `MobileGUI` is initialized to `false` and has
  no production writer. Responsive behavior in the live shell instead uses
  `DynamicGUI`, `SizeStore`, or a component-local viewport width.

Driver tags used below:

| Tag | Source |
| --- | --- |
| `R` | Fastify-backed settings, collections, characters, chats, or messages. |
| `A` | Async hydration, network/catalog/asset work, generation, or progress streams. |
| `L` | Route state, local component state, input, selection, scroll, or viewport. |
| `B` | Build flag, browser capability/permission, locale, or date/time. |
| `X` | Plugin, module, custom HTML/CSS/CBS, parser, or remote-authored content. |

## App shell, routing, and home

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `APP-01` | Root render priority (`B`, `L`, `A`) | Strictly replaces the whole app with legal notice, April Fools page, bootstrap loading, custom-GUI editor, settings, character grid, or normal sidebar/chat. A higher branch hides every lower one. Loading has an independently changing status line. | `src/App.svelte:72-124,182-298`; `src/ts/bootstrap.ts` |
| `APP-02` | URL/store routing (`L`, `R`, `A`) | Settings section, playground tool, grid, inlay explorer, bare character, character chat, and home all select different content. Unknown settings/tool slugs fall back to their menu; an unknown root clears route-owned state and reaches home rather than a not-found page. Active generation can canonicalize navigation to its owner. | `src/ts/router.ts:140-243,382-620`; `src/App.svelte:88-124` |
| `APP-03` | Legal configuration and browser language (`B`) | A falsy `VITE_RISU_LEGAL_CONFIGURED` hides all application data. The legal page independently chooses Chinese, Korean, or English fallback from `navigator.language`. | `src/App.svelte:182-184`; `src/lib/Others/Legal.svelte:16-90` |
| `APP-04` | Bootstrap/resource readiness (`A`, `R`) | Spinner plus changing startup status, then the routed app after settings/collections/characters, durable-mutation replay, selected character, hydration, plugins, and CSS state are prepared. | `src/App.svelte:255-274`; `src/ts/bootstrap.ts`; `src/ts/stores.svelte.ts:25,158-160` |
| `APP-05` | Responsive shell (`B`, `L`) | Above 1024px the sidebar is inline; at or below 1024px it becomes a conditional modal/backdrop controlled by `sideBarStore`. Settings independently switch split view to list/detail below 700px, and hotkeys replace their table below 768px. | `src/ts/stores.svelte.ts:12-28`; `src/App.svelte:282-297`; `src/lib/Setting/Settings.svelte:48-61,105-395`; `src/lib/Setting/Pages/HotkeySettings.svelte:35-99` |
| `APP-06` | Lite build (`B`) | `VITE_RISU_LITE=TRUE` removes chat/model setup, display/accessibility, lore/regex, plugin/module, and advanced/about settings groups; language, hotkeys, and backup remain. | `src/ts/lite.ts`; `src/lib/Setting/Settings.svelte:111-301` |
| `APP-07` | Application language (`R`, `B`) | Most labels/help/options switch among the selected resource language, with English deep-merge fallback. The legal page and Iris intro have separate browser/resource-language selection paths. | `src/lang/index.ts:10-45`; `src/ts/setting/languageSettingsData.svelte.ts:50-96`; `src/lib/Others/Legal.svelte`; `src/lib/Others/IrisModal.svelte:41-92` |
| `APP-08` | Date-gated content (`B`, `L`) | April 1 can replace the app with a two-step fake search page. The home title changes for holidays; Christmas/anniversary clicking reveals a score/timer minigame after five clicks. | `src/App.svelte:72-74,184-250`; `src/lib/UI/Title.svelte:5-33,56-150` |
| `HOME-01` | Landing versus Realm (`L`, `R`) | Home title/version/GitHub card or the Realm catalog. Opening Realm can first yield an external-server confirmation unless `doNotWarnExternalServers` is set. | `src/lib/UI/MainMenu.svelte:11-75` |
| `HOME-02` | Realm catalog request (`A`, `L`, `X`) | Loading, failure/retry, server-supplied `additionalHTML`, empty catalog, card grid, and pagination. Search/sort/NSFW/page replace results; stale requests are fenced. The dormant `$MobileGUI` filter branch is not live. | `src/lib/UI/Realm/RealmMain.svelte:19-90,136-328`; `src/ts/characterCards.ts` |
| `HOME-03` | Realm card and detail data (`A`, `R`, `X`) | Hidden image versus remote image; multilingual Markdown; tag truncation; emotion/asset/lore badges; author and fork link; recognized license; popularity; creator-only delete; delete-busy state. | `src/lib/UI/Realm/RealmHubIcon.svelte:17-76`; `src/lib/UI/Realm/RealmPopUp.svelte:115-253`; `src/lib/UI/Realm/RealmLicense.svelte:13-35` |

## Chat surface

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `CHAT-01` | Chat layout and character presentation (`R`, `L`, `A`, `X`) | Classic, Waifu desktop, or Waifu-mobile layout; no art, resizable art, emotion art, or generated art; custom background image; parsed character/module background DOM. `viewScreen`, `inlayViewScreen`, transient `CharEmotion`, and module embedding all participate. | `src/lib/ChatScreens/ChatScreen.svelte:47-116`; `BackgroundDom.svelte:20-92`; `ResizeBox.svelte:85-96`; `TransitionImage.svelte:18-131`; `src/ts/util.ts:286-322` |
| `CHAT-02` | Character/chat selection (`L`, `R`, `A`) | Main menu, playground, selected-character-without-chat prompt (including most-recent shortcut), or active transcript. A selected character alone does not imply an open chat; route and resource IDs must agree. | `src/lib/ChatScreens/DefaultChatScreen.svelte:202-241,1405-1462`; `src/ts/router.ts` |
| `CHAT-03` | Transcript hydration and failure (`A`, `R`) | Fullscreen message-jump loading, inline hydration loading, failure with retry, shell row with no body, or resident transcript. Bookmarks and jumps can request messages outside the current window. | `src/lib/ChatScreens/DefaultChatScreen.svelte:616-627,1405-1438`; `src/ts/server/chatMessageHydration.svelte.ts`; `src/ts/server/characterShellHydration.svelte.ts` |
| `CHAT-04` | Transcript window, folding, scroll, and unread (`R`, `L`, `A`) | Tail-only rows and Load More, compatibility cold-storage loader, folded-window boundary, auto-scroll, scroll-to-message overlay, and an unread/new-message affordance in six configured placements. Same-chat message growth and last role, not just arrival, determine unread state. | `src/lib/ChatScreens/DefaultChatScreen.svelte:675-720,1348-1410,1465-1474,1694-1755`; `Chats.svelte:52-91,121-179`; `DefaultChatScreen.loadPages.ts` |
| `CHAT-05` | Greeting, legal disclosure, and creator note (`R`, `B`) | Synthetic first greeting; alternate-greeting navigation/page count; AI disclosure; dismissible creator note. These only appear when the loaded window covers the beginning, and the greeting is `idx=-1`, not a normal persisted message. | `src/lib/ChatScreens/DefaultChatScreen.svelte:1751-1810`; `CreatorQuote.svelte:14-23`; `src/ts/globalApi.svelte.ts:1962-1966` |
| `CHAT-06` | Message semantic state (`R`, `A`, `L`) | Translation editor, raw editor, comment, special branch-reference comment, generation loader, blank row, or parsed body. Malformed special comments can render effectively empty. | `src/lib/ChatScreens/Chat.svelte:1474-1654`; `ChatBody.svelte:119-414`; `Message.svelte` |
| `CHAT-07` | Message layout and identity (`R`, `X`, `L`) | Mobile-chat bubbles by role, cardboard cards, default rows, playground Assistant/User labels with role switch, hidden/displayed icon, portrait variants, timestamp, and arbitrary custom-HTML placement of text/icon/buttons/generation info. | `src/lib/ChatScreens/Chats.svelte:52-91,151-179`; `Chat.svelte:2275-2613` |
| `CHAT-08` | Parsed/custom message content (`R`, `A`, `X`) | Markdown/HTML output changes with CBS variables, regex scripts, modules, parser settings, inlays, additional/module assets, and custom tags such as `risu-btn`. Referenced media may resolve to image/video/audio, fuzzy asset match, or placeholder. | `src/lib/ChatScreens/ChatBody.svelte:119-414`; `ChatBodyParseMemo.ts`; `Chat.svelte:2325-2469,2545-2548`; `src/ts/parser/parser.svelte.ts:507-813,976`; `src/ts/cbs.ts` |
| `CHAT-09` | Translation and request metadata (`R`, `A`, `B`) | Original versus server raw translation versus LLM translation, translation spinner/editor, model/request badge, request timing/tokens, and legal disclosure. Availability depends on translator type, job state, generation info, and settings. | `src/lib/ChatScreens/Chat.svelte:1476-1537,2041-2077`; `src/ts/server/messageTranslationJobs.ts`; `src/lib/Others/AlertComp.svelte:619-801` |
| `CHAT-10` | Per-message actions (`R`, `L`, `A`, `B`) | Desktop inline versus narrow-screen popup actions; copy, TTS, edit, delete, translate, bookmark, branch, disable-one/disable-above, and partial edit appear or disable by row role/index, settings, TTS/translator capability, generation/translation state, and disabled range. | `src/lib/ChatScreens/Chat.svelte:1642-1695,1698-2273,2472-2613`; `PartialEditController.svelte:873-1095` |
| `CHAT-11` | Rerolls, swipes, branches, and alternate greetings (`R`, `L`, `A`) | Previous/next greeting, first-message page count, swipe/regenerate button, reroll candidate list, undo/new reroll, and branch graph. Each has distinct empty/current/disabled states and may require full hydration. | `src/lib/ChatScreens/Chat.svelte:2103-2162`; `RerollList.svelte:19-90`; `src/lib/Others/AlertComp.svelte:1068-1173`; `src/ts/process/rerollNavigation.svelte.ts` |
| `CHAT-12` | Composer and generation ownership (`R`, `A`, `L`) | Send versus abort/progress; character menu versus playground action; normal plus translated textarea; translation rollback; continue/regenerate disabled state. Drafts are keyed by transcript identity. Only a generation owned by the visible chat gets visible progress, although another active generation can still disable sending. | `src/lib/ChatScreens/DefaultChatScreen.svelte:325-413,487-605,1208-1245,1491-1616`; `DefaultChatScreen.composerDrafts.ts`; `src/ts/process/index.svelte.ts` |
| `CHAT-13` | Attachments, stickers, and suggestions (`R`, `A`, `L`) | Attachment strip with missing/generic/image/video/audio previews; sticker/asset picker; suggestion loading, empty/hidden, generated list, translated/original controls, and reroll. Stale-owner guards suppress results for a newly selected chat. | `src/lib/ChatScreens/DefaultChatScreen.svelte:1618-1692`; `AssetInput.svelte:31-205`; `Suggestion.svelte:506-557`; `src/ts/process/files/inlays.ts` |
| `CHAT-14` | Generation and post-generation progress (`A`, `R`) | Stage labels (starting, prompt, memory, model, finalizing), Agent Preset before/after-main step progress, and post-generation script owner/phase/LLM-call progress. Progress is chat-scoped; Agent Preset progress suppresses the generic row loader. | `src/lib/ChatScreens/Chat.svelte:1579-1593`; `AgentPresetProgress.svelte:12-65`; `PostGenerationScriptProgress.svelte:7-68`; `src/lib/ChatScreens/chatGenerationLoading.ts`; `agentPresetProgress.ts`; `postGenerationProgress.ts` |
| `CHAT-15` | Chat menu and extension actions (`R`, `A`, `X`) | TTS stop, continuation, module/chat-list modal, screenshot, EasyPanel, Hypa, translation active state, reroll, plus runtime plugin/module menu entries and floating buttons. The final labels/icons/actions cannot be enumerated from the component alone. | `src/lib/ChatScreens/DefaultChatScreen.svelte:1814-2011`; `ChatScreen.svelte:106-116`; `src/ts/stores.svelte.ts:174-185`; `src/ts/plugins/apiV3/v3.svelte.ts:1348-1454` |

## Sidebar and character-owned editors

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `SIDE-01` | Sidebar navigation form (`R`, `L`, `X`) | Labeled menu sidebar versus compact avatar rail; hamburger at top/bottom; menu open/closed; runtime plugin entries. The live local `sideBarMode` remains `0`, so nonzero modes are not separate current surfaces. | `src/lib/SideBars/Sidebar.svelte:68,148,380-711,735-810`; `SidebarAvatar.svelte:54-140` |
| `SIDE-02` | Character order/folders (`R`, `A`, `L`) | Character rows, folder rows, expanded children, folder name/image/open/closed fallback, selected marker, and optimistic drag/reorder. Stale order references are omitted. | `src/lib/SideBars/Sidebar.svelte:249-254,488-588`; `sidebarCharList.ts:115-214`; `sidebarOrganizer.ts`; `sidebarDrag.ts` |
| `SIDE-03` | Contextual sidebar panel (`R`, `L`) | Welcome/select-bot, playground chat list, Chat/Character tabs, optional Dev Tool, Quick Settings, Dev Tool body, character editor, or chat list. Priority is Quick Settings -> Dev Tool -> character editor -> chat list. | `src/lib/SideBars/Sidebar.svelte:735-810`; `QuickSettingsGUI.svelte` |
| `SIDE-04` | Chat list route and folder data (`R`, `L`, `A`) | Active-chat author-note/settings pane or folder/list index; empty folders; grouped/ungrouped chats; selected row; edit/rename/organizer handles; create/import/export/delete/branch/bookmark/persona actions. A chat with a nonexistent non-null folder ID can fall out of both groups. | `src/lib/SideBars/SideChatList.svelte:87-91,847-1334`; `chatFolderGrouping.ts`; `DropList.svelte` |
| `SIDE-05` | Author note and effective generation settings (`R`, `A`, `X`) | Template-derived note placeholder/token count; resolved or unconfigured model/prompt/persona/agent preset; visible missing reference; optional persona note; recursive group/select/text/textarea/boolean toggles; mismatch markers and reset state. | `src/lib/SideBars/AuthorNoteEditor.svelte:131-172`; `ChatGenerationSettingsControls.svelte:17-151`; `Toggles.svelte:55-347`; `ChatGenerationTogglePresets.svelte:26-143`; `src/ts/activeChatGenerationSettings.ts` |
| `SIDE-06` | Custom sidebar schema (`R`) | Ordered model selector, current loadout button, or delegated setting row; unknown items are ignored. Duplicates are allowed, and the accepted `databaseKey` kind currently has no render branch, producing a silent gap. | `src/lib/SideBars/CustomSidebar.svelte:12-43`; `src/lib/Others/CustomSidebarConfig.svelte` |
| `SIDE-07` | Character editor identity and sections (`R`, `A`, `L`, `B`) | Editable/read-only/private-license state; profile fields; icon/CC assets/notification image; view-screen none/emotion/image-generation forms; additional asset empty/list/media preview/exclusion; lore/scripts/background; manage/export license restrictions; optional legacy fields; bias/personality/scenario/greetings/Hypa. Many legacy fields only surface when data already exists or `showUnrecommended` is enabled. | `src/lib/SideBars/CharConfig.svelte:390-523,1085-1695,2082-2361` |
| `SIDE-08` | Character TTS editor (`R`, `A`, `B`) | None, Web Speech support/voice list, ElevenLabs, VOICEVOX styles, NovelAI preset/custom voice, OpenAI built-in/custom, HuggingFace, VITS, GPT-SoVITS nested audio/path/prompt controls, or FishSpeech model list. Catalogs add loading, empty, resolved, and error paths. | `src/lib/SideBars/CharConfig.svelte:1695-2081`; `src/ts/process/tts.ts`; provider-operation adapters under `src/ts/server/` |
| `SIDE-09` | Lorebook scope/hydration/editor (`R`, `A`, `L`) | Global/external/character/chat source; character/chat/settings tabs; hydration loading/failure/retry; inherited versus custom settings; empty/list/folder filtering; folder versus entry; Lore Plus; always-active/selective/regex/probability/order/key/token controls; bulk enable state. | `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:95-281`; `LoreBookList.svelte:581-723`; `LoreBookData.svelte:286-520`; `src/ts/server/chatMessageHydration.svelte.ts:681-910` |
| `SIDE-10` | Regex and trigger editors (`R`, `L`, `A`) | Regex empty/list/collapsed/expanded/type/flags; Trigger Lua/V1/V2 format; V1 condition/effect-specific fields; V2 canvas/category/new/edit modes and dozens of `effect.type`-specific editors; unsupported/deprecated/low-level warnings. Stored deprecated types can remain visible even when creation menus hide them. | `src/lib/SideBars/Scripts/RegexList.svelte:96-108`; `RegexData.svelte:105-203`; `TriggerList.svelte:18-124`; `TriggerV1Data.svelte:70-494`; `TriggerV2List.svelte:49-163,2662-4540` |
| `SIDE-11` | Developer panel (`R`, `A`, `L`) | Typed script-state inputs or empty state; async character/chat/prompt token results; autopilot rows; chat versus instruct preview; Jinja-only editor. | `src/lib/SideBars/DevTool.svelte:129-303` |

## Settings

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `SET-01` | Settings shell/navigation (`R`, `L`, `B`, `X`) | Desktop split versus narrow list/detail; Lite-reduced menu; legacy bot-preset entry only when rows exist; page selected by `SettingsMenuIndex`; plugin menu rows; EasyPanel only with Pro Tools; lorebook picker overlay. Menu index `1` renders legacy Bot Settings when legacy presets exist and modern Model Settings otherwise. | `src/lib/Setting/Settings.svelte:48-61,105-403`; `src/ts/router.ts` |
| `SET-02` | Schema-driven setting rows (`R`, `L`) | Each item can be omitted by a condition, choose one of 11 wrapper types, recursively render an accordion, show warning/experimental/help metadata, or render nothing for an unknown custom component. Context includes database, main/sub model capability, and preset mirror target. | `src/lib/Setting/SettingRenderer.svelte:20-40`; `src/ts/setting/types.ts:13-61,102-187`; `src/ts/setting/utils.ts:705-711`; `src/ts/setting/settingRegistry.ts`; `customComponents.ts` |
| `SET-03` | Conditional select/segmented options (`R`) | Options are filtered by their own conditions. A persisted unavailable value is retained on first render; after a later option-set change it can be coerced to the explicit fallback or last available option, making visibility itself capable of causing a setting mutation. | `src/lib/Setting/Wrappers/SettingSelect.svelte:20-74`; `SettingSegmented.svelte:33-62`; `src/ts/setting/types.ts:40-83` |
| `SET-04` | Display and accessibility dependencies (`R`, `A`, `B`) | Custom HTML and Waifu controls by theme; custom color/text/font editors by selection; memory-thickness and quote children by enabling parent; nullable color picker by value; pending/existing background asset; notification permission can turn a just-enabled toggle off; auto-scroll reveals always-scroll and placement children. | `src/ts/setting/displaySettingsData.svelte.ts:23-149,218-260,424-503`; `accessibilitySettingsData.ts:171-200`; `src/lib/Setting/Pages/Display/*`; `src/ts/server/pushNotificationSetting.ts` |
| `SET-05` | Language and translator configuration (`R`, `L`, `A`) | Local restart warning after language change; translator disabled/enabled; provider-specific DeepL/DeepLX/Google/LLM fields; Google-specific language choices; LLM preset list/editor; auto/combine/legacy controls; LLM cache/import/export actions. Missing selected translator preset yields no editor fields. | `src/ts/setting/languageSettingsData.svelte.ts:50-377`; `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:1454-1691`; `src/lang/index.ts` |
| `SET-06` | Advanced and chat-format dependencies (`R`, `B`) | Local-network timeout, experimental fields, unrecommended/deprecated fields, prompt-info text, regex-worker timeouts, dynamic-asset editor, Jinja instruction template, custom model list/expanded editor/flags. The request-location row is hard-hidden and is not a live surface. | `src/ts/setting/advancedSettingsData.ts:148-162,251-267,326-602`; `chatFormatSettingsData.ts:9-37`; `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:18-276` |
| `SET-07` | Model-capability parameter schema (`R`) | Seed and sampling/penalty/thinking/effort controls appear from resolved `modelInfo.parameters` and flags; Claude budget/adaptive, DeepSeek, and related nested controls also depend on the selected thinking mode. | `src/ts/setting/botSettingsParamsData.ts:36-302`; `src/ts/model/modellist.ts` |
| `SET-08` | Model Settings shell and conversion (`R`, `A`, `L`) | Full legacy conversion prompt, compact declined notice, queued/error notice, Roles/Profiles tab, or legacy-only screen. Advanced Legacy Settings remains only while at least one resolved role lacks a durable-profile source. | `src/lib/Setting/Pages/Model/ModelSettingsShell.svelte:36-110,159-244`; `src/ts/model/modelProfileUiState.ts`; `modelProfileResolver.ts` |
| `SET-09` | Model role rows (`R`) | Eight roles show binding mode, inherited source, effective/missing profile, provider/model/request model, ready/incomplete/compatibility/unsupported status and reason, fallback count, and dirty Apply/Cancel state. Only optional roles offer inherit/profile modes; missing referenced profiles remain visibly selectable as missing. | `src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte:36-191,285-382`; `src/ts/model/modelProfileResolver.ts:1343-1408` |
| `SET-10` | Model profile list/editor (`R`, `A`, `L`) | Empty/list; provider/model/status/reason/fallback/usage badges; command pending/error; create/edit drawer. Compatibility/unsupported profiles lock provider fields; provider switches can warn that credentials will clear; runtime/fallback accordions exist only for editable first-class providers. | `src/lib/Setting/Pages/Model/ModelProfileList.svelte:73-120,323-423`; `ModelProfileEditorDrawer.svelte:99-112,405-491` |
| `SET-11` | Provider-specific model form (`R`, `A`, `B`) | Entire form switches among OpenAI, Anthropic, Google, Vertex, Ollama, Custom API, Debug Echo, or compatibility notice. Nested variants include local/cloud Ollama, known/manual model, catalogs, Custom API URL warning/headers/params/flags, Vertex identity/private key, request format, and thinking support. | `src/lib/Setting/Pages/Model/ModelProviderPanel.svelte:88-108,131-457`; `KeyValueRowsEditor.svelte`; provider catalogs under `src/ts/model/` |
| `SET-12` | Secrets, fallbacks, and runtime defaults (`R`, `L`) | Preserved saved secret versus replace/clear; profile versus raw fallback row; missing current profile; self/duplicate exclusions; empty fallback state; runtime default empty/count/edit/error/queued/reset/save states. | `src/lib/Setting/Pages/Model/SecretField.svelte:30-54`; `ModelFallbackEditor.svelte:16-140`; `ModelRuntimeDefaultsEditor.svelte:177-223`; `ModelRuntimeOptionsEditor.svelte` |
| `SET-13` | Model preset list (`R`, `L`) | Empty/list; selected row; prompt-preset role-override notice; modern profile/runtime/legacy badges; missing-profile and fallback summaries; reorder/delete availability. | `src/lib/Setting/Pages/Model/ModelPresetList.svelte:140-203,234-339`; `src/lib/Setting/botpreset.svelte` |
| `SET-14` | Legacy Bot Settings/provider panels (`R`, `A`, `X`, `B`) | Model/parameters/prompt/other tabs or legacy stacked layout; prompt presets may omit parameters; provider panels for Google/Vertex/Anthropic/Mistral/NovelAI/Reverse Proxy/Cohere/Ollama/NanoGPT/OpenRouter/plugins/Kobold/Echo/Horde/textgen/Ooba; loading catalog versus manual/result; subscription state; format-specific parameters; streaming/thinking nesting; prompt-template hydration; custom flags/assets/tools. | `src/lib/Setting/Pages/BotSettings.svelte:382-459,1184-2302`; `ModelGrid.svelte`; `NanoGPTDashboard.svelte`; `NanoGPTProviderPicker.svelte`; `ModelList.svelte` |
| `SET-15` | Prompt preset/template authoring (`R`, `A`, `L`) | Standalone versus inline chrome; template/settings tab; hydration loading/error/retry; empty/list; validation warnings; token counts; optional COT/JSON schema/model override/fallback sections; fallback arrays. Prompt rows expand to type-specific forms for plain/jailbreak/COT, ChatML, cache, chat range, author note, persona, description, or memory. | `src/lib/Setting/Pages/PromptSettings.svelte:1200-1480`; `src/lib/UI/PromptDataItem.svelte:81-119,219-362`; `src/ts/server/promptTemplateHydration.ts` |
| `SET-16` | Agent Preset list/editor/diagnostics (`R`, `A`, `L`) | Empty/list; default/enabled/disabled/invalid/incomplete/model-not-ready/ready status; phase/step/usage/concurrency summaries; reorder/pending/error/drawer. Editor changes by create/edit, phase, output/dependency/scope/failure policy, validation, and saved state. Diagnostics changes through unavailable/loading/error/limited/empty/run-list/selected run and optional details. | `src/lib/Setting/Pages/AgentPresetSettings.svelte:168-373`; `AgentPresetEditorDrawer.svelte:118-153,430-1081`; `AgentPresetDiagnosticsPanel.svelte:18-520`; `src/ts/agentPresetResolver.ts` |
| `SET-17` | Plugin management (`R`, `A`, `X`) | Empty/list; name/version/risk/hot-reload badge; safe custom links; enabled state; update status cycle; mutation pending/error. Expanded plugin metadata dynamically chooses divider, select, textarea, radio, checkbox, number, or text for every non-hidden argument. | `src/lib/Setting/Pages/PluginSettings.svelte:299-542`; `src/ts/plugins/plugins.svelte.ts`; `pluginSafety.ts`; `pluginPermissions.ts` |
| `SET-18` | Module management/editor (`R`, `A`, `X`) | Empty/list/search result; ordinary versus MCP row; enabled/integration state; MCP import busy; create/edit/error/pending; basic/lore/regex/trigger/assets tabs; missing arrays initialized on entry; asset empty/list and preview by media extension. Search with no match currently yields a blank list instead of the global empty message. | `src/lib/Setting/Pages/Module/ModuleSettings.svelte:162-352`; `ModuleMenu.svelte:530-767`; `ModuleChatMenu.svelte:75-150`; `src/ts/process/modules.ts` |
| `SET-19` | Persona, lorebook, and regex record lists (`R`, `A`, `L`) | Persona icon empty/loading/resolved and selected state; selected persona editor; display/rename picker modes; selected/global lorebook name; lore empty/list/folders and data-shaped editor; regex empty/list/expanded. Final-row deletion is guarded in logic for several lists but not always visibly disabled. | `src/lib/Setting/Pages/PersonaSettings.svelte:120-248`; `src/lib/Setting/listedPersona.svelte`; `lorepreset.svelte`; `src/lib/SideBars/LoreBook/*`; `src/lib/SideBars/Scripts/RegexList.svelte`; `RegexData.svelte` |
| `SET-20` | Media, TTS, emotion, and memory settings (`R`, `A`, `L`, `B`) | Modern four-tab navigation versus legacy stacked accordions. The image form switches among WebUI, NovelAI, DALL-E, Stability, ComfyUI, Fal, Imagen, OpenAI-compatible, and WaveSpeed panels, then exposes model-only controls such as high-res, sampler, style, LoRA, vibe/image/character references, media previews, and async catalog/error fallbacks. Hypa V3 enablement adds preset and settings editors; WebGPU adds local models; max-memory calculation has result/error states; experimental mode swaps request controls; embedding provider adds its credential fields. | `src/lib/Setting/Pages/OtherBotSettings.svelte:594-1677`; `src/ts/server/providerOperations.ts`; `src/ts/process/memory/hypav3.ts` |
| `SET-21` | Backup/support/external workflows (`R`, `A`, `L`) | Backup controls all disable during a shared operation and report progress/errors via AlertComp. Supporter/Realm external navigation may add confirmation. Community/support content can therefore be preceded or replaced by a shared alert state. | `src/lib/Setting/Pages/UserSettings.svelte:22-143`; `ThanksPage.svelte`; `Communities.svelte`; `src/lib/Others/AlertComp.svelte` |
| `SET-22` | Custom GUI visual editor (`R`, `L`, `X`) | Persisted `guiHTML` becomes a data-shaped visual tree. Node type/structure controls the canvas; selection and local menu state switch component/container/help editors and highlights. | `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:1-449`; `src/ts/server/settingsBridge.svelte.ts` |

## Global overlays and workflow modals

These overlays are independently mounted after the main branch. They are not a
single exclusive switch, so multiple conditions can produce nested or stacked
UI.

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `MODAL-01` | Overlay host (`L`, `R`, `A`) | Alert, Realm detail, model/prompt/legacy preset picker, persona picker, bookmarks, Hypa modal/progress, plugin warning, arbitrary popup, EasyPanel, popup editor, loadout, Iris, and custom-sidebar config can mount over any main screen. | `src/App.svelte:299-346` |
| `MODAL-02` | Shared alert matrix (`L`, `R`, `A`, `X`) | Main dialog variants for normal/error/wait/ask/input/select/TOS/Markdown/select-character/request-data/add-character/chat-options/progress; separate card export, toast, module selector, branch graph, and request-log inspector. `pluginconfirm` is dormant because it has no production caller. | `src/ts/alert.ts:6-39,71-307`; `src/lib/Others/AlertComp.svelte:341-1345` |
| `MODAL-03` | Alert substate (`R`, `A`, `L`) | Error network subtext/stack/translated details/copied status; determinate/legacy/indeterminate progress; encoded select display/options; input datalist; request-data tabs and missing/present log/prompt info; export choices/warnings by module/preset/character assets; request-log empty/list/success/failure/expanded/copied. Result-bearing dialogs queue while passive alerts defer. | `src/lib/Others/AlertComp.svelte:40-69,211-292,429-801,953-1017,1174-1345`; `src/ts/alert.ts:71-307` |
| `MODAL-04` | Context popup/editor (`L`, `B`, `X`) | Arbitrary snippet content from the caller; left/right and top/bottom placement from viewport/click; editor versus Monaco loading versus parser preview; preview token count and optional toggle panel; global chat variables can change preview without changing editor text. | `src/lib/UI/PopupList.svelte:8-128`; `src/lib/Others/PopupEditor.svelte:12-145`; `src/lib/UI/GUI/TextAreaInput.svelte` |
| `MODAL-05` | Character grid/catalog (`R`, `L`, `A`) | Simple/grid/list/trash tabs; active/trash split and count; filtered empty state; image/fallback; selected marker; unnamed fallback; creator-note locale; trash versus restore/permanent-delete actions. The live simple view delegates to `MobileCharacters`. | `src/lib/Others/GridCatalog.svelte:22-49,75-84,139-368` |
| `MODAL-06` | Simple mobile character list (`R`, `L`, `B`) | Trash exclusion, last-interaction/name ordering, search, chat count, selected row, and relative time from unknown/minutes through years. Relative text refreshes each minute. | `src/lib/Mobile/MobileCharacters.svelte:43-120,141-204` |
| `MODAL-07` | Bookmark and chat-list modals (`R`, `A`, `L`) | Bookmark hydration loading/error/retry/empty/list; custom name or message excerpt; individual/all expansion into the full message renderer. Chat list varies by chat rows/edit/create/import/delete. Hydration results are fenced to the original character/chat. | `src/lib/Others/BookmarkList.svelte:32-164,297-415`; `ChatList.svelte:263-325`; `src/ts/server/chatMessageHydration.svelte.ts` |
| `MODAL-08` | Preset/persona/lore pickers (`R`, `L`, `A`) | Picker kind and global versus active-chat target; empty/list/selected; legacy/model/prompt badges and missing references; persona note and target-specific highlight; lore display versus rename. | `src/lib/Setting/botpreset.svelte`; `listedPersona.svelte`; `lorepreset.svelte`; `src/ts/stores.svelte.ts:36-48,130-156` |
| `MODAL-09` | Loadout workflow (`R`, `A`, `L`) | Overlapping recent/current-character/favorites/all groups, section omission when empty, all-empty state, preset name/favorite/last-used, operation-busy text, and hydrate/apply/save error. | `src/lib/Others/LoadoutModal.svelte:27-90,143-177,228-310`; `src/ts/loadout.ts` |
| `MODAL-10` | Iris dialogue (`R`, `A`, `L`, `B`) | Device-saved or localized intro; typewriter/skip/tip/advance; waiting dots; end composer; backlog with speaker/current-row styling; unsupported `otherAx` warning and disabled send; LLM/tool response or error rollback. | `src/lib/Others/IrisModal.svelte:41-123,426-681`; `src/ts/iris.ts` |
| `MODAL-11` | Custom sidebar configuration (`R`, `L`) | Empty/list, add-type chooser, or searchable settings submenu. Candidate rows and labels come from current setting metadata/language. | `src/lib/Others/CustomSidebarConfig.svelte:12-153`; `src/ts/setting/utils.ts:713-732` |
| `MODAL-12` | EasyPanel requirement gate (`R`, `L`) | Requirements warning until six settings are enabled; then model, parameter, custom-model, and settings tabs. Parameter content switches between model-specific overrides and six role-specific editors. | `src/lib/Others/ProTools/EasyPanel.svelte:56-97,246-382` |
| `MODAL-13` | Plugin safety and permission prompts (`A`, `X`, `L`) | Deduplicated localized safety reasons plus raw Dev Info; continue versus abort. Runtime permission confirmation content changes for network, database, DOM, provider, send-chat, update, logs, or other capability; cached grants suppress it until explicit/periodic reconfirmation. | `src/lib/Others/PluginAlertModal.svelte:6-86`; `src/ts/plugins/pluginSafety.ts:129-153`; `pluginPermissions.ts:43-190`; `plugins.svelte.ts:389-419` |
| `MODAL-14` | Save and background progress (`R`, `A`, `L`) | Save icon only when both `showSavingIcon` and transient saving state are true. Hypa background progress switches compact `miniMsg` spinner and expanded message/submessage. Module import can replace AlertComp text with live asset completed/total progress. | `src/lib/Others/SavePopupIcon.svelte:1-12`; `HypaV3Progress.svelte:1-39`; `src/ts/process/modules.ts:220-237,347-473` |

## Hypa V3 memory

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `HYPA-01` | Memory mode/load state (`R`, `A`, `B`) | Server-backed mode adds server job panel and summary loading/error/empty/list states; legacy mode exposes bulk/category tools that disappear in server mode. | `src/lib/Others/HypaV3Modal.svelte:47-83,1126-1295` |
| `HYPA-02` | Search/filter presentation (`R`, `L`) | Search hidden/open with current/total; important/category filter; last-selected Important/Recent/Similar/Random metric buckets; filtered summary list. | `src/lib/Others/HypaV3Modal.svelte:358-415,944-1095,1162-1247` |
| `HYPA-03` | Summary row (`R`, `A`, `L`) | Bulk-selected/read-only; category/tags; metric labels; important; translation; rerolled result/translation; collapsed/expanded; chat memo chips; connected-message hydration, missing/orphan state, and translated expanded message. | `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:557-934` |
| `HYPA-04` | Jobs and bulk operations (`R`, `A`, `L`) | Refreshing/updated/waiting, error/empty/job list, status/attempt/cancelling; bulk edit by selection count; resummary processing/result/optional translation. | `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:19-49,138-203`; `bulk-edit-actions.svelte:68-146`; `bulk-resummary-result.svelte:19-108` |
| `HYPA-05` | Category/tag manager and footer (`R`, `A`, `L`) | Category counts/edit/display/undeletable unclassified/empty; tag empty/list/edit for owned summary; async next-message, no-message, hydration error, and missing-first-greeting warning. | `src/lib/Others/HypaV3Modal/category-manager-modal.svelte:125-243`; `tag-manager-modal.svelte:118-214`; `modal-footer.svelte:14-92` |

## Playground

| ID | Surface and drivers | UI variants to capture | Primary owners |
| --- | --- | --- | --- |
| `PLAY-01` | Tool routing (`L`, `B`) | Menu or one of embedding, tokenizer, syntax, Jinja, image generation, parser, subtitles, image translation, translation, MCP, CBS docs, inlay explorer, or tool conversion. Index `2` intentionally uses the normal chat surface. Narrow width adds header offset; repeated easter-egg clicks change then blank a label. | `src/lib/Playground/PlaygroundMenu.svelte:23-200`; `src/ts/router.ts` |
| `PLAY-02` | Live text transformers/docs (`L`, `A`, `X`) | Jinja/parser/syntax/tokenizer output continuously replaces with result or inline error; tokenizer changes IDs/count/timing by tokenizer. CBS docs derive searchable cards/aliases; a no-match search currently yields a blank list rather than its global empty message. | `src/lib/Playground/PlaygroundJinja.svelte:26-51`; `PlaygroundParser.svelte:5-32`; `PlaygroundSyntax.svelte:6-28`; `PlaygroundTokenizer.svelte:7-60`; `PlaygroundDocs.svelte:7-80` |
| `PLAY-03` | Embedding tool (`L`, `A`, `B`) | WebGPU adds models; OpenAI/custom model adds credential/base fields; run disables inputs and shows spinner/results; any input/config change clears the old result. | `src/lib/Playground/PlaygroundEmbedding.svelte:12-195` |
| `PLAY-04` | Image generation (`L`, `A`) | Generate label versus spinner; output image only while current positive/negative prompts still match the submitted values, so editing hides stale output. | `src/lib/Playground/PlaygroundImageGen.svelte:28-84` |
| `PLAY-05` | Image translation (`L`, `A`) | Auto versus manual prompt/image/selection rectangle; mode-specific loading text and canvas blur; JSON editor only after output; redrawn parsed result. | `src/lib/Playground/PlaygroundImageTrans.svelte:92-146,341-541` |
| `PLAY-06` | Subtitle generation (`R`, `L`, `A`, `B`) | Mode/source-language/default prompt; warnings from audio/video/streaming/WebGPU capability; live conversion/download/transcription progress; plain output, downloadable captioned media, Reset, and collapsible VTT. | `src/lib/Playground/PlaygroundSubtitle.svelte:31-40,301-447,529-572,658-758` |
| `PLAY-07` | Translation tool (`R`, `L`, `A`) | Single versus bulk; keep-context; `(n of total)`/token progress; chunk-by-chunk output; preserved JSON row shape; visible partial failure list while successful chunks remain; stale output cleared by input/config change. | `src/lib/Playground/PlaygroundTranslation.svelte:14-222` |
| `PLAY-08` | MCP tool list (`A`, `X`, `L`) | Refresh replaces server/tool cards whose schema, URL, description, and inputs are data-defined; refresh and per-tool execution have separate busy state; results surface through Markdown/error alerts. | `src/lib/Playground/PlaygroundMCP.svelte:8-77`; `src/ts/process/mcp/` |
| `PLAY-09` | Inlay explorer (`A`, `L`) | Count and selection toolbar; load error/retry; initial loading; empty; paginated grid/load-more; image/video/audio/unavailable preview; distinct ID, dimensions, and size only when present. | `src/lib/Playground/PlaygroundInlayExplorer.svelte:13-29,203-320`; `src/ts/process/files/inlays.ts` |
| `PLAY-10` | Tool conversion (`L`, `A`) | File list with detected type or red unsupported state; Run disabled until at least one supported input; converted downloads after processing. | `src/lib/Playground/ToolConversion.svelte:7-58` |

## Cross-cutting variation sources

These sources make several inventory rows effectively open-ended and must be
captured in any detailed follow-up trace.

### Fastify resource lifecycle

The same durable value can pass through server shell, lazy hydration,
optimistic projection, queued/retryable intent, canonical acknowledgement,
rollback, SSE invalidation, and authoritative refresh. A detailed trace must
record both the displayed value and the resource/hydration status; reading only
the final database-shaped view hides those transitions.

Primary owners: `src/ts/server/resourceState.svelte.ts`,
`resourceInvalidation.ts`, `chatMessageHydration.svelte.ts`,
`promptTemplateHydration.ts`, `settingsBridge.svelte.ts`, `chatBridge.svelte.ts`,
`characterBridge.svelte.ts`, and `pendingMutationOutbox.ts`.

### Plugin-defined UI

Plugin V3 can add settings-menu rows, hamburger rows, chat-menu rows, floating
buttons, icons, and body interceptors at runtime. Plugin records also define
their own argument control schema. Static component markup therefore cannot
enumerate final menus or some parsed message bodies.

Primary owners: `src/ts/plugins/apiV3/v3.svelte.ts:1348-1476`,
`src/ts/stores.svelte.ts:174-190`, and
`src/lib/Setting/Pages/PluginSettings.svelte`.

### Module-defined UI and parsing

Enabled global/chat modules can hide message icons, inject background markup,
add assets, lore, regex, triggers, custom toggles, and MCP definitions. The
visible result depends on enabled-module order plus character/chat ownership,
not only the component receiving the final value.

Primary owners: `src/ts/process/modules.ts:65-80,731-740,1109-1110`,
`src/ts/stores.svelte.ts:247-309`, `BackgroundDom.svelte`, `Toggles.svelte`, and
the parser.

### User- and server-authored markup

`guiHTML`, character `backgroundHTML`, custom CSS, CBS, Markdown, message
scripts, inlays/assets, and Realm `additionalHTML` can create or remove visible
content outside ordinary Svelte branches. A trace must retain the source text,
sanitized/parsed output, resolved assets, reload epochs, and active
character/chat/module identities.

Primary owners: `src/lib/ChatScreens/Chat.svelte`, `ChatBody.svelte`,
`BackgroundDom.svelte`, `ChatBodyParseMemo.ts`, `src/ts/parser/`, `src/ts/cbs.ts`,
`src/ts/gui/colorscheme.ts`, and `src/lib/UI/Realm/RealmMain.svelte`.

### Async ownership and freshness

Catalogs, asset previews, translation, transcript/lore hydration, generation,
provider lists, TTS voices, memory jobs, and uploads can finish after selection
changes. Many paths fence results by target identity or latest-operation token.
A useful trace must include the captured owner, current owner, operation token,
and whether a late result was applied or discarded, not just the network
response.

Primary owners: `src/ts/server/staleStateGuards.ts`, specialized upload/import
guards under `src/ts/server/`, and the relevant component-local request guards.

## Recommended follow-up trace record

For each inventory ID selected for detailed investigation, capture:

1. Route, viewport, build flags, locale/date, selected character/chat, and
   mounted overlays.
2. Minimal persistent fixture, including deliberately missing references and
   empty/nonempty collections.
3. Initial resource and hydration status, then every optimistic, streamed,
   canonical, rollback, and invalidation transition.
4. Exact visible text/rows/actions/disabled states before, during, after, on
   failure, and after navigating away while work is in flight.
5. Plugin/module/custom-markup inputs and the post-parse DOM when the row is
   tagged `X`.
6. A screenshot or accessible DOM snapshot plus the request UID/trace entry for
   server-backed transitions.

Start with `CHAT-03`, `CHAT-08`, `CHAT-12`, `SIDE-05`, `SIDE-07`, `SIDE-10`,
`SET-03`, `SET-08` through `SET-20`, `MODAL-02`, `HYPA-01`, and the
cross-cutting sources. These combine the most independent data owners or have
final UI that cannot be determined from one component alone.
