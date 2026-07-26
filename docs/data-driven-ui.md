# Data-dependent UI variation inventory

Last audited: 2026-07-23.

This is the identification pass for UI whose content, structure, available
actions, or semantic state changes with data. It is a map for later runtime
side-effect traces, not a claim that every variant is correct.

## Scope and method

The live graph was followed from `src/main.ts` and `src/App.svelte`, including
lazy imports, settings registries, plugin/module insertion points, and the
browser state that feeds Svelte. The original structural scan was consolidated
into the logical variation points below; a single row can own many leaf
branches. Owner references deliberately omit line numbers because these large
components move frequently and the file boundary is the useful navigation
contract.

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

| Tag | Source                                                                        |
| --- | ----------------------------------------------------------------------------- |
| `R` | Fastify-backed settings, collections, characters, chats, or messages.         |
| `A` | Async hydration, network/catalog/asset work, generation, or progress streams. |
| `L` | Route state, local component state, input, selection, scroll, or viewport.    |
| `B` | Build flag, browser capability/permission, locale, or date/time.              |
| `X` | Plugin, module, custom HTML/CSS/CBS, parser, or remote-authored content.      |

## App shell, routing, and home

- **`APP-01` — Root render priority (`B`, `L`, `A`)**
  - Variants: Strictly replaces the whole app with legal notice, April Fools page, bootstrap loading, custom-GUI editor, settings, character grid, or normal sidebar/chat. A higher branch hides every lower one. Loading has an independently changing status line.
  - Owners: `src/App.svelte`; `src/ts/bootstrap.ts`
- **`APP-02` — URL/store routing (`L`, `R`, `A`)**
  - Variants: Settings section, playground tool, grid, inlay explorer, bare character, character chat, and home all select different content. Unknown settings/tool slugs fall back to their menu; an unknown root clears route-owned state and reaches home rather than a not-found page. Active generation can canonicalize navigation to its owner.
  - Owners: `src/ts/router.ts`; `src/App.svelte`
- **`APP-03` — Legal configuration and browser language (`B`)**
  - Variants: A falsy `VITE_RISU_LEGAL_CONFIGURED` hides all application data. The legal page independently chooses Chinese, Korean, or English fallback from `navigator.language`.
  - Owners: `src/App.svelte`; `src/lib/Others/Legal.svelte`
- **`APP-04` — Bootstrap/resource readiness (`A`, `R`)**
  - Variants: Spinner plus changing startup status, then the routed app after settings/collections/characters, durable-mutation replay, selected character, hydration, plugins, and CSS state are prepared.
  - Owners: `src/App.svelte`; `src/ts/bootstrap.ts`; `src/ts/stores.svelte.ts`
- **`APP-05` — Responsive shell (`B`, `L`)**
  - Variants: Above 1024px the sidebar is inline; at or below 1024px it becomes a conditional modal/backdrop controlled by `sideBarStore`. Settings independently switch split view to list/detail below 700px, and hotkeys replace their table below 768px.
  - Owners: `src/ts/stores.svelte.ts`; `src/App.svelte`; `src/lib/Setting/Settings.svelte`; `src/lib/Setting/Pages/HotkeySettings.svelte`
- **`APP-06` — Lite build (`B`)**
  - Variants: `VITE_RISU_LITE=TRUE` removes chat/model setup, display/accessibility, lore/regex, plugin/module, and advanced/about settings groups; language, hotkeys, and backup remain.
  - Owners: `src/ts/lite.ts`; `src/lib/Setting/Settings.svelte`
- **`APP-07` — Application language (`R`, `B`)**
  - Variants: Most labels/help/options switch among the selected resource language, with English deep-merge fallback. The legal page and Iris intro have separate browser/resource-language selection paths.
  - Owners: `src/lang/index.ts`; `src/ts/setting/languageSettingsData.svelte.ts`; `src/lib/Others/Legal.svelte`; `src/lib/Others/IrisModal.svelte`
- **`APP-08` — Date-gated content (`B`, `L`)**
  - Variants: April 1 can replace the app with a two-step fake search page. The home title changes for holidays; Christmas/anniversary clicking reveals a score/timer minigame after five clicks.
  - Owners: `src/App.svelte`; `src/lib/UI/Title.svelte`
- **`APP-09` — Insecure-origin warning (`B`, `L`)**
  - Variants: During bootstrap, a plain-HTTP/insecure context shows a one-time acknowledged warning before the main app loads. The durable outbox remains available through its raw-key cipher path, while the disposable hash cache falls back to full resource reads without WebCrypto.
  - Owners: `src/ts/bootstrap.ts`; `src/ts/server/pendingMutationOutbox.ts`; `src/ts/server/resourceCache.ts`
- **`APP-10` — Active-writer takeover (`R`, `A`, `L`)**
  - Variants: A writer SSE event or validated stale-writer response blocks interaction and asks for Refresh or Stay Offline. Refresh reloads; offline mode stops server coordination, freezes editable controls, preserves selectable text, and adds a reload banner.
  - Owners: `src/ts/server/activeWriterSession.ts`; `src/ts/server/events.ts`; `src/styles.css`
- **`HOME-01` — Landing versus Realm (`L`, `R`)**
  - Variants: Home title/version/GitHub card or the Realm catalog. Opening Realm can first yield an external-server confirmation unless `doNotWarnExternalServers` is set.
  - Owners: `src/lib/UI/MainMenu.svelte`
- **`HOME-02` — Realm catalog request (`A`, `L`, `X`)**
  - Variants: Loading, failure/retry, server-supplied `additionalHTML`, empty catalog, card grid, and pagination. Search/sort/NSFW/page replace results; stale requests are fenced. The dormant `$MobileGUI` filter branch is not live.
  - Owners: `src/lib/UI/Realm/RealmMain.svelte`; `src/ts/characterCards.ts`
- **`HOME-03` — Realm card and detail data (`A`, `R`, `X`)**
  - Variants: Hidden image versus remote image; multilingual Markdown; tag truncation; emotion/asset/lore badges; author and fork link; recognized license; popularity; creator-only delete; delete-busy state.
  - Owners: `src/lib/UI/Realm/RealmHubIcon.svelte`; `src/lib/UI/Realm/RealmPopUp.svelte`; `src/lib/UI/Realm/RealmLicense.svelte`

## Chat surface

- **`CHAT-01` — Chat layout and character presentation (`R`, `L`, `A`, `X`)**
  - Variants: Classic, Waifu desktop, or Waifu-mobile layout; no art, resizable art, emotion art, or generated art; custom background image; parsed character/module background DOM. `viewScreen`, `inlayViewScreen`, transient `CharEmotion`, and module embedding all participate.
  - Owners: `src/lib/ChatScreens/ChatScreen.svelte`; `BackgroundDom.svelte`; `ResizeBox.svelte`; `TransitionImage.svelte`; `src/ts/util.ts`
- **`CHAT-02` — Character/chat selection (`L`, `R`, `A`)**
  - Variants: Main menu, playground, selected-character-without-chat prompt (including most-recent shortcut), or active transcript. A selected character alone does not imply an open chat; route and resource IDs must agree.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `src/ts/router.ts`
- **`CHAT-03` — Transcript hydration and failure (`A`, `R`)**
  - Variants: Fullscreen message-jump loading, inline hydration loading, failure with retry, shell row with no body, or resident transcript. Bookmarks and jumps can request messages outside the current window.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `src/ts/server/chatMessageHydration.svelte.ts`; `src/ts/server/characterShellHydration.svelte.ts`
- **`CHAT-04` — Transcript window, folding, scroll, and unread (`R`, `L`, `A`)**
  - Variants: Tail-only rows and Load More, compatibility cold-storage loader, folded-window boundary, auto-scroll, scroll-to-message overlay, and an unread/new-message affordance in six configured placements. Same-chat message growth and last role, not just arrival, determine unread state.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `Chats.svelte`; `DefaultChatScreen.loadPages.ts`
- **`CHAT-05` — Greeting, legal disclosure, and creator note (`R`, `B`)**
  - Variants: Synthetic first greeting; alternate-greeting navigation/page count; AI disclosure; dismissible creator note. These only appear when the loaded window covers the beginning, and the greeting is `idx=-1`, not a normal persisted message.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `CreatorQuote.svelte`; `src/ts/globalApi.svelte.ts`
- **`CHAT-06` — Message semantic state (`R`, `A`, `L`)**
  - Variants: Translation editor, raw editor, comment, special branch-reference comment, generation loader, blank row, or parsed body. Malformed special comments can render effectively empty.
  - Owners: `src/lib/ChatScreens/Chat.svelte`; `ChatBody.svelte`; `Message.svelte`
- **`CHAT-07` — Message layout and identity (`R`, `X`, `L`)**
  - Variants: Mobile-chat bubbles by role, cardboard cards, default rows, playground Assistant/User labels with role switch, hidden/displayed icon, portrait variants, timestamp, and arbitrary custom-HTML placement of text/icon/buttons/generation info.
  - Owners: `src/lib/ChatScreens/Chats.svelte`; `Chat.svelte`
- **`CHAT-08` — Parsed/custom message content (`R`, `A`, `X`)**
  - Variants: Markdown/HTML output changes with CBS variables, regex scripts, modules, parser settings, inlays, additional/module assets, and custom tags such as `risu-btn`. Referenced media may resolve to image/video/audio, fuzzy asset match, or placeholder.
  - Owners: `src/lib/ChatScreens/ChatBody.svelte`; `ChatBodyParseMemo.ts`; `Chat.svelte`; `src/ts/parser/parser.svelte.ts`; `src/ts/cbs.ts`
- **`CHAT-09` — Translation and request metadata (`R`, `A`, `B`)**
  - Variants: Original versus server raw translation versus LLM translation, translation spinner/editor, bilingual pairing/emphasis, model/request badge, request timing/tokens, and legal disclosure. Newly generated rows receive server-owned automatic-translation outcomes in the generation terminal frame; other appended rows can use the one-shot client trigger. Availability depends on translator type, job state, generation info, and the active chat's translation settings.
  - Owners: `src/lib/ChatScreens/Chat.svelte`; `src/lib/ChatScreens/Chats.svelte`; `src/ts/process/serverGeneratedMessageTranslation.ts`; `src/ts/server/messageTranslationJobs.ts`; `src/lib/Others/AlertComp.svelte`
- **`CHAT-10` — Per-message actions (`R`, `L`, `A`, `B`)**
  - Variants: Desktop inline versus narrow-screen popup actions; copy, TTS, edit, delete, translate, bookmark, branch, disable-one/disable-above, and partial edit appear or disable by row role/index, settings, TTS/translator capability, generation/translation state, and disabled range.
  - Owners: `src/lib/ChatScreens/Chat.svelte`; `PartialEditController.svelte`
- **`CHAT-11` — Rerolls, swipes, branches, and alternate greetings (`R`, `L`, `A`)**
  - Variants: Previous/next greeting, first-message page count, swipe/regenerate button, reroll candidate list, undo/new reroll, and branch graph. Each has distinct empty/current/disabled states and may require full hydration.
  - Owners: `src/lib/ChatScreens/Chat.svelte`; `RerollList.svelte`; `src/lib/Others/AlertComp.svelte`; `src/ts/process/rerollNavigation.svelte.ts`
- **`CHAT-12` — Composer and generation ownership (`R`, `A`, `L`)**
  - Variants: Send versus abort/progress; character menu versus playground action; normal plus translated textarea; translation rollback; selected draft-hook output; BTW hook picker/pending/result/dismissed state; continue/regenerate disabled state. Message, translation, files, draft output, and BTW output are keyed by transcript identity. Only a generation owned by the visible chat gets visible progress, although another active generation can still disable sending.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `InputHookPickerDialog.svelte`; `DefaultChatScreen.composerDrafts.ts`; `src/ts/process/inputHooks.ts`; `src/ts/process/index.svelte.ts`
- **`CHAT-13` — Attachments, stickers, and suggestions (`R`, `A`, `L`)**
  - Variants: Attachment strip with missing/generic/image/video/audio previews; sticker/asset picker; suggestion loading, empty/hidden, generated list, translated/original controls, and reroll. Stale-owner guards suppress results for a newly selected chat.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `AssetInput.svelte`; `Suggestion.svelte`; `src/ts/process/files/inlays.ts`
- **`CHAT-14` — Generation and post-generation progress (`A`, `R`)**
  - Variants: Stage labels (starting, prompt, memory, model, finalizing), Agent Preset before/after-main step progress, and post-generation script owner/phase/LLM-call progress. Progress is chat-scoped; Agent Preset progress suppresses the generic row loader.
  - Owners: `src/lib/ChatScreens/Chat.svelte`; `AgentPresetProgress.svelte`; `PostGenerationScriptProgress.svelte`; `src/lib/ChatScreens/chatGenerationLoading.ts`; `agentPresetProgress.ts`; `postGenerationProgress.ts`
- **`CHAT-15` — Chat menu and extension actions (`R`, `A`, `X`)**
  - Variants: TTS stop, continuation, module/chat-list modal, screenshot, EasyPanel, Hypa, translation active state, reroll, plus runtime plugin/module menu entries and floating buttons. The final labels/icons/actions cannot be enumerated from the component alone.
  - Owners: `src/lib/ChatScreens/DefaultChatScreen.svelte`; `ChatScreen.svelte`; `src/ts/stores.svelte.ts`; `src/ts/plugins/apiV3/v3.svelte.ts`

## Sidebar and character-owned editors

- **`SIDE-01` — Sidebar navigation form (`R`, `L`, `X`)**
  - Variants: Labeled menu sidebar versus compact avatar rail; hamburger at top/bottom; menu open/closed; runtime plugin entries. The live local `sideBarMode` remains `0`, so nonzero modes are not separate current surfaces.
  - Owners: `src/lib/SideBars/Sidebar.svelte`; `SidebarAvatar.svelte`
- **`SIDE-02` — Character order/folders (`R`, `A`, `L`)**
  - Variants: Character rows, folder rows, expanded children, folder name/image/open/closed fallback, selected marker, and optimistic drag/reorder. Stale order references are omitted.
  - Owners: `src/lib/SideBars/Sidebar.svelte`; `sidebarCharList.ts`; `sidebarOrganizer.ts`; `sidebarDrag.ts`
- **`SIDE-03` — Contextual sidebar panel (`R`, `L`)**
  - Variants: Welcome/select-bot, playground chat list, Chat/Character tabs, optional Dev Tool, Quick Settings, Dev Tool body, character editor, or chat list. Priority is Quick Settings -> Dev Tool -> character editor -> chat list.
  - Owners: `src/lib/SideBars/Sidebar.svelte`; `QuickSettingsGUI.svelte`
- **`SIDE-04` — Chat list route and folder data (`R`, `L`, `A`)**
  - Variants: Active-chat author-note/settings pane or folder/list index; empty folders; grouped/ungrouped chats; selected row; edit/rename/organizer handles; create/import/export/delete/branch/bookmark/persona actions. A chat with a nonexistent non-null folder ID can fall out of both groups.
  - Owners: `src/lib/SideBars/SideChatList.svelte`; `chatFolderGrouping.ts`; `DropList.svelte`
- **`SIDE-05` — Author note and effective generation settings (`R`, `A`, `X`)**
  - Variants: Template-derived note placeholder/token count; resolved or unconfigured model/prompt/persona/agent preset; visible missing reference; optional persona note; recursive group/select/text/textarea/boolean toggles; mismatch markers and reset state; per-chat auto-translation/bot-only/bilingual/emphasis controls; and a selected/missing/unselected draft hook.
  - Owners: `src/lib/SideBars/AuthorNoteEditor.svelte`; `ChatGenerationSettingsControls.svelte`; `ChatTranslationSettings.svelte`; `ChatDraftHookSelector.svelte`; `Toggles.svelte`; `ChatGenerationTogglePresets.svelte`; `src/ts/activeChatGenerationSettings.ts`
- **`SIDE-06` — Custom sidebar schema (`R`)**
  - Variants: Ordered model selector, current loadout button, or delegated setting row; unknown items are ignored. Duplicates are allowed, and the accepted `databaseKey` kind currently has no render branch, producing a silent gap.
  - Owners: `src/lib/SideBars/CustomSidebar.svelte`; `src/lib/Others/CustomSidebarConfig.svelte`
- **`SIDE-07` — Character editor identity and sections (`R`, `A`, `L`, `B`)**
  - Variants: Editable/read-only/private-license state; profile fields; icon/CC assets/notification image; view-screen none/emotion/image-generation forms; additional asset empty/list/media preview/exclusion; lore/scripts/background; manage/export license restrictions; optional legacy fields; bias/personality/scenario/greetings/Hypa. Many legacy fields only surface when data already exists or `showUnrecommended` is enabled.
  - Owners: `src/lib/SideBars/CharConfig.svelte`
- **`SIDE-08` — Character TTS editor (`R`, `A`, `B`)**
  - Variants: None, Web Speech support/voice list, ElevenLabs, VOICEVOX styles, NovelAI preset/custom voice, OpenAI built-in/custom, HuggingFace, VITS, GPT-SoVITS nested audio/path/prompt controls, or FishSpeech model list. Catalogs add loading, empty, resolved, and error paths.
  - Owners: `src/lib/SideBars/CharConfig.svelte`; `src/ts/process/tts.ts`; provider-operation adapters under `src/ts/server/`
- **`SIDE-09` — Lorebook scope/hydration/editor (`R`, `A`, `L`)**
  - Variants: Global/external/character/chat source; character/chat/settings tabs; hydration loading/failure/retry; inherited versus custom settings; empty/list/folder filtering; folder versus entry; Lore Plus; always-active/selective/regex/probability/order/key/token controls; bulk enable state.
  - Owners: `src/lib/SideBars/LoreBook/LoreBookSetting.svelte`; `LoreBookList.svelte`; `LoreBookData.svelte`; `src/ts/server/chatMessageHydration.svelte.ts`
- **`SIDE-10` — Regex and trigger editors (`R`, `L`, `A`)**
  - Variants: Regex empty/list/collapsed/expanded/type/flags; Trigger Lua/V1/V2 format; V1 condition/effect-specific fields; V2 canvas/category/new/edit modes and dozens of `effect.type`-specific editors; unsupported/deprecated/low-level warnings. Stored deprecated types can remain visible even when creation menus hide them.
  - Owners: `src/lib/SideBars/Scripts/RegexList.svelte`; `RegexData.svelte`; `TriggerList.svelte`; `TriggerV1Data.svelte`; `TriggerV2List.svelte`
- **`SIDE-11` — Developer panel (`R`, `A`, `L`)**
  - Variants: Typed script-state inputs or empty state; async character/chat/prompt token results; autopilot rows; chat versus instruct preview; Jinja-only editor.
  - Owners: `src/lib/SideBars/DevTool.svelte`

## Settings

- **`SET-01` — Settings shell/navigation (`R`, `L`, `B`, `X`)**
  - Variants: Desktop split versus narrow list/detail; Lite-reduced menu; legacy bot-preset entry only when rows exist; page selected by `SettingsMenuIndex`; input-hook authoring; plugin menu rows; EasyPanel only with Pro Tools; lorebook picker overlay. Menu index `1` renders legacy Bot Settings when legacy presets exist and modern Model Settings otherwise.
  - Owners: `src/lib/Setting/Settings.svelte`; `src/ts/router.ts`
- **`SET-02` — Schema-driven setting rows (`R`, `L`)**
  - Variants: Each item can be omitted by a condition, choose one of 11 wrapper types, recursively render an accordion, show warning/experimental/help metadata, or render nothing for an unknown custom component. Context includes database, main/sub model capability, and preset mirror target.
  - Owners: `src/lib/Setting/SettingRenderer.svelte`; `src/ts/setting/types.ts`; `src/ts/setting/utils.ts`; `src/ts/setting/settingRegistry.ts`; `customComponents.ts`
- **`SET-03` — Conditional select/segmented options (`R`)**
  - Variants: Options are filtered by their own conditions. A persisted unavailable value is retained on first render; after a later option-set change it can be coerced to the explicit fallback or last available option, making visibility itself capable of causing a setting mutation.
  - Owners: `src/lib/Setting/Wrappers/SettingSelect.svelte`; `SettingSegmented.svelte`; `src/ts/setting/types.ts`
- **`SET-04` — Display and accessibility dependencies (`R`, `A`, `B`)**
  - Variants: Custom HTML and Waifu controls by theme; custom color/text/font editors by selection; memory-thickness and quote children by enabling parent; nullable color picker by value; pending/existing background asset; notification permission can turn a just-enabled toggle off; auto-scroll reveals always-scroll and placement children.
  - Owners: `src/ts/setting/displaySettingsData.svelte.ts`; `accessibilitySettingsData.ts`; `src/lib/Setting/Pages/Display/*`; `src/ts/server/pushNotificationSetting.ts`
- **`SET-05` — Language and translator configuration (`R`, `L`, `A`)**
  - Variants: Local restart warning after language change; translator disabled/enabled; provider-specific DeepL/DeepLX/Google/LLM fields; Google-specific language choices; LLM preset list/editor; single- or multi-step LLM pipelines; send-text-as-is Ax.Model steps with bounded history slots; auto/combine/legacy controls; and LLM cache/import/export actions. Missing selected translator preset yields no editor fields.
  - Owners: `src/ts/setting/languageSettingsData.svelte.ts`; `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte`; `src/lang/index.ts`
- **`SET-06` — Advanced and chat-format dependencies (`R`, `B`)**
  - Variants: Local-network timeout, experimental fields, unrecommended/deprecated fields, prompt-info text, regex-worker timeouts, dynamic-asset editor, Jinja instruction template, custom model list/expanded editor/flags. The request-location row is hard-hidden and is not a live surface.
  - Owners: `src/ts/setting/advancedSettingsData.ts`; `chatFormatSettingsData.ts`; `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte`
- **`SET-07` — Model-capability parameter schema (`R`)**
  - Variants: Seed and sampling/penalty/thinking/effort controls appear from resolved `modelInfo.parameters` and flags; Claude budget/adaptive, DeepSeek, and related nested controls also depend on the selected thinking mode.
  - Owners: `src/ts/setting/botSettingsParamsData.ts`; `src/ts/model/modellist.ts`
- **`SET-08` — Model Settings shell and conversion (`R`, `A`, `L`)**
  - Variants: Full legacy conversion prompt, compact declined notice, queued/error notice, Roles/Profiles tab, or legacy-only screen. Advanced Legacy Settings remains only while at least one resolved role lacks a durable-profile source.
  - Owners: `src/lib/Setting/Pages/Model/ModelSettingsShell.svelte`; `src/ts/model/modelProfileUiState.ts`; `modelProfileResolver.ts`
- **`SET-09` — Model role rows (`R`)**
  - Variants: Eight roles show binding mode, inherited source, effective/missing profile, provider/model/request model, ready/incomplete/compatibility/unsupported status and reason, fallback count, and dirty Apply/Cancel state. Only optional roles offer inherit/profile modes; missing referenced profiles remain visibly selectable as missing.
  - Owners: `src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte`; `src/ts/model/modelProfileResolver.ts`
- **`SET-10` — Model profile list/editor (`R`, `A`, `L`)**
  - Variants: Empty/list; provider/model/status/reason/fallback/usage badges; command pending/error; create/edit drawer. Compatibility/unsupported profiles lock provider fields; provider switches can warn that credentials will clear; runtime/fallback accordions exist only for editable first-class providers.
  - Owners: `src/lib/Setting/Pages/Model/ModelProfileList.svelte`; `ModelProfileEditorDrawer.svelte`
- **`SET-11` — Provider-specific model form (`R`, `A`, `B`)**
  - Variants: Entire form switches among OpenAI, Anthropic, Google, Vertex, Ollama, Custom API, Debug Echo, or compatibility notice. Nested variants include local/cloud Ollama, known/manual model, catalogs, Custom API URL warning/headers/params/flags, Vertex identity/private key, request format, and thinking support.
  - Owners: `src/lib/Setting/Pages/Model/ModelProviderPanel.svelte`; `KeyValueRowsEditor.svelte`; provider catalogs under `src/ts/model/`
- **`SET-12` — Secrets, fallbacks, and runtime defaults (`R`, `L`)**
  - Variants: Preserved saved secret versus replace/clear; profile versus raw fallback row; missing current profile; self/duplicate exclusions; empty fallback state; runtime default empty/count/edit/error/queued/reset/save states.
  - Owners: `src/lib/Setting/Pages/Model/SecretField.svelte`; `ModelFallbackEditor.svelte`; `ModelRuntimeDefaultsEditor.svelte`; `ModelRuntimeOptionsEditor.svelte`
- **`SET-13` — Model preset list (`R`, `L`)**
  - Variants: Empty/list; selected row; prompt-preset role-override notice; modern profile/runtime/legacy badges; missing-profile and fallback summaries; reorder/delete availability.
  - Owners: `src/lib/Setting/Pages/Model/ModelPresetList.svelte`; `src/lib/Setting/botpreset.svelte`
- **`SET-14` — Legacy Bot Settings/provider panels (`R`, `A`, `X`, `B`)**
  - Variants: Model/parameters/prompt/other tabs or legacy stacked layout; prompt presets may omit parameters; provider panels for Google/Vertex/Anthropic/Mistral/NovelAI/Reverse Proxy/Cohere/Ollama/NanoGPT/OpenRouter/plugins/Kobold/Echo/Horde/textgen/Ooba; loading catalog versus manual/result; subscription state; format-specific parameters; streaming/thinking nesting; prompt-template hydration; custom flags/assets/tools.
  - Owners: `src/lib/Setting/Pages/BotSettings.svelte`; `ModelGrid.svelte`; `NanoGPTDashboard.svelte`; `NanoGPTProviderPicker.svelte`; `ModelList.svelte`
- **`SET-15` — Prompt preset/template authoring (`R`, `A`, `L`)**
  - Variants: Standalone versus inline chrome; template/settings tab; hydration loading/error/retry; empty/list; validation warnings; token counts; optional COT/JSON schema/model override/fallback sections; fallback arrays. Prompt rows expand to type-specific forms for plain/jailbreak/COT, ChatML, cache, chat range, author note, persona, description, or memory.
  - Owners: `src/lib/Setting/Pages/PromptSettings.svelte`; `src/lib/UI/PromptDataItem.svelte`; `src/ts/server/promptTemplateHydration.ts`
- **`SET-16` — Agent library and Agent Preset composition/diagnostics (`R`, `A`, `L`)**
  - Variants: Empty/list; Agent usage and reusable behavior editor; default/enabled/disabled/invalid/incomplete/model-not-ready/ready preset status; phase/invocation/concurrency summaries; reorder/pending/error/drawer. Composition changes by attached Agent, phase, output/dependency/destination/failure policy, optional model/runtime override, validation, and saved state. Diagnostics changes through unavailable/loading/error/limited/empty/run-list/selected run and optional details.
  - Owners: `src/lib/Setting/Pages/AgentPresetSettings.svelte`; `AgentSettingsSection.svelte`; `AgentEditorDrawer.svelte`; `AgentPresetEditorDrawer.svelte`; `AgentPresetDiagnosticsPanel.svelte`; `src/ts/agents.ts`; `src/ts/agentPresetResolver.ts`
- **`SET-17` — Plugin management (`R`, `A`, `X`)**
  - Variants: Empty/list; name/version/hot-reload badge; safe custom links; enabled state; update status cycle; mutation pending/error. Expanded plugin metadata dynamically chooses divider, select, textarea, radio, checkbox, number, or text for every non-hidden argument.
  - Owners: `src/lib/Setting/Pages/PluginSettings.svelte`; `src/ts/plugins/plugins.svelte.ts`; `pluginPermissions.ts`
- **`SET-18` — Module management/editor (`R`, `A`, `X`)**
  - Variants: Empty/list/search result; ordinary versus MCP row; enabled/integration state; MCP import busy; create/edit/error/pending; basic/lore/regex/trigger/assets tabs; missing arrays initialized on entry; asset empty/list and preview by media extension. Search with no match currently yields a blank list instead of the global empty message.
  - Owners: `src/lib/Setting/Pages/Module/ModuleSettings.svelte`; `ModuleMenu.svelte`; `ModuleChatMenu.svelte`; `src/ts/process/modules.ts`
- **`SET-19` — Persona, lorebook, and regex record lists (`R`, `A`, `L`)**
  - Variants: Persona icon empty/loading/resolved and selected state; selected persona editor; display/rename picker modes; selected/global lorebook name; lore empty/list/folders and data-shaped editor; regex empty/list/expanded. Final-row deletion is guarded in logic for several lists but not always visibly disabled.
  - Owners: `src/lib/Setting/Pages/PersonaSettings.svelte`; `src/lib/Setting/listedPersona.svelte`; `lorepreset.svelte`; `src/lib/SideBars/LoreBook/*`; `src/lib/SideBars/Scripts/RegexList.svelte`; `RegexData.svelte`
- **`SET-20` — Media, TTS, emotion, and memory settings (`R`, `A`, `L`, `B`)**
  - Variants: Modern four-tab navigation versus legacy stacked accordions. The image form switches among WebUI, NovelAI, DALL-E, Stability, ComfyUI, Fal, Imagen, OpenAI-compatible, and WaveSpeed panels, then exposes model-only controls such as high-res, sampler, style, LoRA, vibe/image/character references, media previews, and async catalog/error fallbacks. Hypa V3 enablement adds preset and settings editors; WebGPU adds local models; max-memory calculation has result/error states; experimental mode swaps request controls; embedding provider adds its credential fields.
  - Owners: `src/lib/Setting/Pages/OtherBotSettings.svelte`; `src/ts/server/providerOperations.ts`; `src/ts/process/memory/hypav3.ts`
- **`SET-21` — Backup/support/external workflows (`R`, `A`, `L`)**
  - Variants: Backup controls all disable during a shared operation and report progress/errors via AlertComp. Supporter/Realm external navigation may add confirmation. Community/support content can therefore be preceded or replaced by a shared alert state.
  - Owners: `src/lib/Setting/Pages/UserSettings.svelte`; `ThanksPage.svelte`; `Communities.svelte`; `src/lib/Others/AlertComp.svelte`
- **`SET-22` — Custom GUI visual editor (`R`, `L`, `X`)**
  - Variants: Persisted `guiHTML` becomes a data-shaped visual tree. Node type/structure controls the canvas; selection and local menu state switch component/container/help editors and highlights.
  - Owners: `src/lib/Setting/Pages/CustomGUISettingMenu.svelte`; `src/ts/server/settingsBridge.svelte.ts`
- **`SET-23` — Input-hook authoring (`R`, `L`)**
  - Variants: Empty/list and add/delete states; each row selects draft or BTW behavior and edits a name and prompt. The server-backed settings draft saves the ordered hook collection, while chat-level selection remains separate.
  - Owners: `src/lib/Setting/Pages/InputHookSettings.svelte`; `src/ts/process/inputHooks.ts`; `src/ts/chatCommands.ts`

## Global overlays and workflow modals

These overlays are independently mounted after the main branch. They are not a
single exclusive switch, so multiple conditions can produce nested or stacked
UI.

- **`MODAL-01` — Overlay host (`L`, `R`, `A`)**
  - Variants: Alert, Realm detail, model/prompt/legacy preset picker, persona picker, bookmarks, Hypa modal/progress, plugin warning, arbitrary popup, EasyPanel, popup editor, loadout, Iris, and custom-sidebar config can mount over any main screen.
  - Owners: `src/App.svelte`
- **`MODAL-02` — Shared alert matrix (`L`, `R`, `A`, `X`)**
  - Variants: Main dialog variants for normal/error/wait/ask/input/select/TOS/Markdown/select-character/request-data/add-character/chat-options/progress; separate card export, toast, module selector, branch graph, and request-log inspector. `pluginconfirm` is dormant because it has no production caller.
  - Owners: `src/ts/alert.ts`; `src/lib/Others/AlertComp.svelte`
- **`MODAL-03` — Alert substate (`R`, `A`, `L`)**
  - Variants: Error network subtext/stack/translated details/copied status; determinate/legacy/indeterminate progress; encoded select display/options; input datalist; request-data tabs and missing/present log/prompt info; export choices/warnings by module/preset/character assets; request-log empty/list/success/failure/expanded/copied. Result-bearing dialogs queue while passive alerts defer.
  - Owners: `src/lib/Others/AlertComp.svelte`; `src/ts/alert.ts`
- **`MODAL-04` — Context popup/editor (`L`, `B`, `X`)**
  - Variants: Arbitrary snippet content from the caller; left/right and top/bottom placement from viewport/click; editor versus Monaco loading versus parser preview; preview token count and optional toggle panel; global chat variables can change preview without changing editor text.
  - Owners: `src/lib/UI/PopupList.svelte`; `src/lib/Others/PopupEditor.svelte`; `src/lib/UI/GUI/TextAreaInput.svelte`
- **`MODAL-05` — Character grid/catalog (`R`, `L`, `A`)**
  - Variants: Simple/grid/list/trash tabs; active/trash split and count; filtered empty state; image/fallback; selected marker; unnamed fallback; creator-note locale; trash versus restore/permanent-delete actions. The live simple view delegates to `MobileCharacters`.
  - Owners: `src/lib/Others/GridCatalog.svelte`
- **`MODAL-06` — Simple mobile character list (`R`, `L`, `B`)**
  - Variants: Trash exclusion, last-interaction/name ordering, search, chat count, selected row, and relative time from unknown/minutes through years. Relative text refreshes each minute.
  - Owners: `src/lib/Mobile/MobileCharacters.svelte`
- **`MODAL-07` — Bookmark and chat-list modals (`R`, `A`, `L`)**
  - Variants: Bookmark hydration loading/error/retry/empty/list; custom name or message excerpt; individual/all expansion into the full message renderer. Chat list varies by chat rows/edit/create/import/delete. Hydration results are fenced to the original character/chat.
  - Owners: `src/lib/Others/BookmarkList.svelte`; `ChatList.svelte`; `src/ts/server/chatMessageHydration.svelte.ts`
- **`MODAL-08` — Preset/persona/lore pickers (`R`, `L`, `A`)**
  - Variants: Picker kind and global versus active-chat target; empty/list/selected; legacy/model/prompt badges and missing references; persona note and target-specific highlight; lore display versus rename.
  - Owners: `src/lib/Setting/botpreset.svelte`; `listedPersona.svelte`; `lorepreset.svelte`; `src/ts/stores.svelte.ts`
- **`MODAL-09` — Loadout workflow (`R`, `A`, `L`)**
  - Variants: Overlapping recent/current-character/favorites/all groups, section omission when empty, all-empty state, preset name/favorite/last-used, operation-busy text, and hydrate/apply/save error.
  - Owners: `src/lib/Others/LoadoutModal.svelte`; `src/ts/loadout.ts`
- **`MODAL-10` — Iris dialogue (`R`, `A`, `L`, `B`)**
  - Variants: Device-saved or localized intro; typewriter/skip/tip/advance; waiting dots; end composer; backlog with speaker/current-row styling; unsupported `otherAx` warning and disabled send; LLM/tool response or error rollback.
  - Owners: `src/lib/Others/IrisModal.svelte`; `src/ts/iris.ts`
- **`MODAL-11` — Custom sidebar configuration (`R`, `L`)**
  - Variants: Empty/list, add-type chooser, or searchable settings submenu. Candidate rows and labels come from current setting metadata/language.
  - Owners: `src/lib/Others/CustomSidebarConfig.svelte`; `src/ts/setting/utils.ts`
- **`MODAL-12` — EasyPanel requirement gate (`R`, `L`)**
  - Variants: Requirements warning until six settings are enabled; then model, parameter, custom-model, and settings tabs. Parameter content switches between model-specific overrides and six role-specific editors.
  - Owners: `src/lib/Others/ProTools/EasyPanel.svelte`
- **`MODAL-13` — Plugin permission prompts (`A`, `X`, `L`)**
  - Variants: Runtime permission confirmation content changes for network, database, DOM, provider, send-chat, update, logs, or other V3 capability; cached grants suppress it until explicit/periodic reconfirmation.
  - Owners: `src/ts/plugins/pluginPermissions.ts`; `plugins.svelte.ts`
- **`MODAL-14` — Save and background progress (`R`, `A`, `L`)**
  - Variants: The save icon appears when `showSavingIcon` is enabled and aggregate persistence activity is true. Activity covers in-flight mutations, this writer's queued outbox intents, and a short completion linger; individual workflows retain busy/disabled and failure states without transient Saving/Queued layout rows. Hypa background progress switches compact `miniMsg` spinner and expanded message/submessage. Module import can replace AlertComp text with live asset completed/total progress.
  - Owners: `src/lib/Others/SavePopupIcon.svelte`; `src/ts/server/persistenceActivity.svelte.ts`; `HypaV3Progress.svelte`; `src/ts/process/modules.ts`

## Hypa V3 memory

- **`HYPA-01` — Memory mode/load state (`R`, `A`, `B`)**
  - Variants: Server-backed mode adds server job panel and summary loading/error/empty/list states; legacy mode exposes bulk/category tools that disappear in server mode.
  - Owners: `src/lib/Others/HypaV3Modal.svelte`
- **`HYPA-02` — Search/filter presentation (`R`, `L`)**
  - Variants: Search hidden/open with current/total; important/category filter; last-selected Important/Recent/Similar/Random metric buckets; filtered summary list.
  - Owners: `src/lib/Others/HypaV3Modal.svelte`
- **`HYPA-03` — Summary row (`R`, `A`, `L`)**
  - Variants: Bulk-selected/read-only; category/tags; metric labels; important; translation; rerolled result/translation; collapsed/expanded; chat memo chips; connected-message hydration, missing/orphan state, and translated expanded message.
  - Owners: `src/lib/Others/HypaV3Modal/modal-summary-item.svelte`
- **`HYPA-04` — Jobs and bulk operations (`R`, `A`, `L`)**
  - Variants: Refreshing/updated/waiting, error/empty/job list, status/attempt/cancelling; bulk edit by selection count; resummary processing/result/optional translation.
  - Owners: `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`; `bulk-edit-actions.svelte`; `bulk-resummary-result.svelte`
- **`HYPA-05` — Category/tag manager and footer (`R`, `A`, `L`)**
  - Variants: Category counts/edit/display/undeletable unclassified/empty; tag empty/list/edit for owned summary; async next-message, no-message, hydration error, and missing-first-greeting warning.
  - Owners: `src/lib/Others/HypaV3Modal/category-manager-modal.svelte`; `tag-manager-modal.svelte`; `modal-footer.svelte`

## Playground

- **`PLAY-01` — Tool routing (`L`, `B`)**
  - Variants: Menu or one of embedding, tokenizer, syntax, Jinja, image generation, parser, subtitles, image translation, translation, MCP, CBS docs, inlay explorer, or tool conversion. Index `2` intentionally uses the normal chat surface. Narrow width adds header offset; repeated easter-egg clicks change then blank a label.
  - Owners: `src/lib/Playground/PlaygroundMenu.svelte`; `src/ts/router.ts`
- **`PLAY-02` — Live text transformers/docs (`L`, `A`, `X`)**
  - Variants: Jinja/parser/syntax/tokenizer output continuously replaces with result or inline error; tokenizer changes IDs/count/timing by tokenizer. CBS docs derive searchable cards/aliases; a no-match search currently yields a blank list rather than its global empty message.
  - Owners: `src/lib/Playground/PlaygroundJinja.svelte`; `PlaygroundParser.svelte`; `PlaygroundSyntax.svelte`; `PlaygroundTokenizer.svelte`; `PlaygroundDocs.svelte`
- **`PLAY-03` — Embedding tool (`L`, `A`, `B`)**
  - Variants: WebGPU adds models; OpenAI/custom model adds credential/base fields; run disables inputs and shows spinner/results; any input/config change clears the old result.
  - Owners: `src/lib/Playground/PlaygroundEmbedding.svelte`
- **`PLAY-04` — Image generation (`L`, `A`)**
  - Variants: Generate label versus spinner; output image only while current positive/negative prompts still match the submitted values, so editing hides stale output.
  - Owners: `src/lib/Playground/PlaygroundImageGen.svelte`
- **`PLAY-05` — Image translation (`L`, `A`)**
  - Variants: Auto versus manual prompt/image/selection rectangle; mode-specific loading text and canvas blur; JSON editor only after output; redrawn parsed result.
  - Owners: `src/lib/Playground/PlaygroundImageTrans.svelte`
- **`PLAY-06` — Subtitle generation (`R`, `L`, `A`, `B`)**
  - Variants: Mode/source-language/default prompt; warnings from audio/video/streaming/WebGPU capability; live conversion/download/transcription progress; plain output, downloadable captioned media, Reset, and collapsible VTT.
  - Owners: `src/lib/Playground/PlaygroundSubtitle.svelte`
- **`PLAY-07` — Translation tool (`R`, `L`, `A`)**
  - Variants: Single versus bulk; keep-context; `(n of total)`/token progress; chunk-by-chunk output; preserved JSON row shape; visible partial failure list while successful chunks remain; stale output cleared by input/config change.
  - Owners: `src/lib/Playground/PlaygroundTranslation.svelte`
- **`PLAY-08` — MCP tool list (`A`, `X`, `L`)**
  - Variants: Refresh replaces server/tool cards whose schema, URL, description, and inputs are data-defined; refresh and per-tool execution have separate busy state; results surface through Markdown/error alerts.
  - Owners: `src/lib/Playground/PlaygroundMCP.svelte`; `src/ts/process/mcp/`
- **`PLAY-09` — Inlay explorer (`A`, `L`)**
  - Variants: Count and selection toolbar; load error/retry; initial loading; empty; paginated grid/load-more; image/video/audio/unavailable preview; distinct ID, dimensions, and size only when present.
  - Owners: `src/lib/Playground/PlaygroundInlayExplorer.svelte`; `src/ts/process/files/inlays.ts`
- **`PLAY-10` — Tool conversion (`L`, `A`)**
  - Variants: File list with detected type or red unsupported state; Run disabled until at least one supported input; converted downloads after processing.
  - Owners: `src/lib/Playground/ToolConversion.svelte`

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

Primary owners: `src/ts/plugins/apiV3/v3.svelte.ts`,
`src/ts/stores.svelte.ts`, and
`src/lib/Setting/Pages/PluginSettings.svelte`.

### Module-defined UI and parsing

Enabled global/chat modules can hide message icons, inject background markup,
add assets, lore, regex, triggers, custom toggles, and MCP definitions. The
visible result depends on enabled-module order plus character/chat ownership,
not only the component receiving the final value.

Primary owners: `src/ts/process/modules.ts`,
`src/ts/stores.svelte.ts`, `BackgroundDom.svelte`, `Toggles.svelte`, and
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

Start with `APP-10`, `CHAT-03`, `CHAT-08`, `CHAT-09`, `CHAT-12`, `SIDE-05`,
`SIDE-07`, `SIDE-10`, `SET-03`, `SET-05`, `SET-08` through `SET-20`,
`SET-23`, `MODAL-02`, `HYPA-01`, and the
cross-cutting sources. These combine the most independent data owners or have
final UI that cannot be determined from one component alone.
