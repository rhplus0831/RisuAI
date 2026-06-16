# Character Editor

`src/lib/SideBars/CharConfig.svelte` is backed by `createServerBackedCharacterDraft` at `:87` and `watchServerBackedCharacterProfile` at `:143`; most bound fields persist through `src/ts/server/characterBridge.svelte.ts:148` and dispatch a character patch at `src/ts/server/characterBridge.svelte.ts:249`.

## Profile And Prompt Fields

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/CharConfig.svelte:509` | `characterDraft.value.name` | Character name `TextInput`. | Updates character `name`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:511` | `characterDraft.value.desc` | Description `TextAreaInput`. | Updates character description. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:514` | `characterDraft.value.firstMessage` | First message `TextAreaInput`. | Updates default greeting/first message. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:880` | `characterDraft.value.backgroundHTML` | Background HTML `TextAreaInput`. | Updates character background HTML. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:920` | `characterDraft.value.virtualscript` | Virtual script `TextAreaInput`. | Updates character virtual script. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1309` | `characterDraft.value.exampleMessage` | Example message `TextAreaInput`. | Updates example messages. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1313` | `characterDraft.value.creatorNotes` | Creator notes multilingual input. | Updates creator notes. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1323` | `characterDraft.value.systemPrompt` | System prompt `TextAreaInput`. | Updates system prompt. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1327` | `characterDraft.value.replaceGlobalNote` | Replace global note `TextAreaInput`. | Updates replacement global note. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1331` | `characterDraft.value.additionalText` | Additional text `TextAreaInput`. | Updates additional character prompt text. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1336` | `characterDraft.value.personality` | Personality `TextAreaInput`. | Updates personality prompt. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1341` | `characterDraft.value.scenario` | Scenario `TextAreaInput`. | Updates scenario prompt. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1346` | `characterDraft.value.defaultVariables` | Default variables `TextAreaInput`. | Updates character default variables. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1349` | `characterDraft.value.translatorNote` | Translator note `TextAreaInput`. | Updates character translator note. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1352` | `characterDraft.value.additionalData.creator` | Creator `TextInput`. | Updates creator metadata. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1355` | `characterDraft.value.additionalData.character_version` | Version `TextInput`. | Updates character version metadata. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1358` | `characterDraft.value.nickname` | Nickname `TextInput`. | Updates nickname. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1363` | `characterDraft.value.depth_prompt.prompt` | Depth prompt `TextInput`. | Updates depth prompt text. | `server/fastify/src/routes/commands.ts:3344`. |

## Images, Assets, And View Screens

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/CharConfig.svelte:558` | avatar image button | Existing avatar/CC asset button. | Changes selected character image or removes selected cc asset. | Character patch `server/fastify/src/routes/commands.ts:3344`; assets if image is uploaded: `server/fastify/src/routes/assets.ts:220`. |
| `src/lib/SideBars/CharConfig.svelte:586` | `removeCharacterCcAsset(i)` | CC asset remove button. | Removes character card asset reference. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:612` | `selectCharImg($selectedCharID)` | Select avatar button. | Uploads/selects character avatar and updates `image`/`ccAssets`. | Assets `server/fastify/src/routes/assets.ts:220`; character patch `commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:675` | `characterDraft.value.emotionImages[i][0]` | Emotion name `TextInput`. | Updates emotion image label. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:678` | `rmCharEmotion` | Remove emotion button. | Removes emotion image entry. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:693` | `addCharEmotion` | Add emotion image button. | Adds an emotion image entry and may upload an asset. | Assets `server/fastify/src/routes/assets.ts:220`; character patch `commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:707` | `characterDraft.value.newGenData.emotionInstructions` | Emotion instructions `TextAreaInput`. | Updates emotion view generation instructions. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:730`, `:732`, `:734` | `newGenData.prompt`, `negative`, `instructions` | Image-generation prompt textareas. | Updates character image generation prompt settings. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:763` | additional asset upload button | Add additional asset button. | Uploads asset bytes and appends to `additionalAssets`. | Assets `server/fastify/src/routes/assets.ts:220`; character patch `commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:822` | `characterDraft.value.additionalAssets[i][0]` | Additional asset name `TextInput`. | Renames asset reference. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:830` | remove additional asset button | Removes an additional asset reference. | Updates `additionalAssets`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:847` | prebuilt exclude button | Excludes/includes asset in prebuilt asset prompts. | Updates `prebuiltAssetExclude`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/ChatScreens/AssetInput.svelte:54` | quick asset add button | Chat/editor quick asset picker. | Uploads asset and adds it to character additional assets. | Assets `server/fastify/src/routes/assets.ts:220`; character patch `commands.ts:3344`. |

## Scripts And Triggers

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/CharConfig.svelte:884` | `RegexList bind:value={characterScriptsDraft}` | Regex/script list text fields and buttons. | Replaces character `customscript` definitions. | `server/fastify/src/routes/commands.ts:6039`; client bridge `src/ts/server/scriptDefinitionBridge.svelte.ts:254`. |
| `src/lib/SideBars/CharConfig.svelte:886` | add regex button | Adds regex/script row. | Replaces character scripts array. | `server/fastify/src/routes/commands.ts:6039`. |
| `src/lib/SideBars/CharConfig.svelte:906` | import regex button | Imports regex/script rows. | Replaces character scripts array. | `server/fastify/src/routes/commands.ts:6039`. |
| `src/lib/SideBars/CharConfig.svelte:914` | `TriggerList` | Trigger editor text fields and buttons. | Replaces character trigger definitions. | `server/fastify/src/routes/commands.ts:6075`; client bridge `src/ts/server/scriptDefinitionBridge.svelte.ts:318`. |
| `src/lib/SideBars/Scripts/RegexList.svelte:75`, `RegexData.svelte:109` | regex editor rows | Regex name/find/replace/script text fields and row buttons. | Mutates the bound script draft; parent persists to character/module/global scope. | Character scripts `commands.ts:6039`; module scripts `commands.ts:6111`; global settings `commands.ts:1319`. |
| `src/lib/SideBars/Scripts/TriggerV1Data.svelte:66` and later fields | trigger v1 fields | Trigger condition/effect text fields and row buttons. | Mutates bound trigger draft; parent persists to character/module scope. | Character triggers `commands.ts:6075`; module triggers `commands.ts:6155`. |
| `src/lib/SideBars/Scripts/TriggerV2List.svelte:2283`, `:2335`, `:2382` | trigger v2 add/remove/import/export controls | Trigger v2 editor buttons and text fields. | Mutates bound trigger draft; parent persists to character/module scope. | Character triggers `commands.ts:6075`; module triggers `commands.ts:6155`; deprecated-trigger display setting uses `commands.ts:1319`. |

## TTS, Bias, Greetings, And Misc Buttons

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/CharConfig.svelte:1047` | `naittsConfig.voice` | NovelAI custom voice `TextInput`. | Updates character TTS config. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1064`, `:1075`, `:1081`, `:1088` | `oaiTTSConfig.*` | OpenAI TTS voice/base URL/API key/model text fields. | Updates character OpenAI TTS config. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1102`, `:1105` | `hfTTS.model`, `hfTTS.language` | Hugging Face TTS text fields. | Updates character HF TTS config. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1112` | VITS select model button | Registers/selects VITS model on character. | Updates character `vits` field. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1125`, `:1132`, `:1182` | GPT-SoVITS URL/ref path/prompt | Text fields for GPT-SoVITS config. | Updates character GPT-SoVITS config. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1139` | GPT-SoVITS reference audio button | Uploads reference audio and stores asset id in TTS config. | Assets `server/fastify/src/routes/assets.ts:220`; character patch `commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1269` | add bias button | Adds a bias row. | Updates character `bias`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1287` | `characterDraft.value.bias[i][0]` | Bias string `TextInput`. | Updates character bias text. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1293` | remove bias button | Removes a bias row. | Updates character `bias`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1373` | add alternate greeting button | Adds an alternate greeting. | Updates character `alternateGreetings`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1395` | `alternateGreetings[i]` | Alternate greeting `TextAreaInput`. | Updates alternate greeting text. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:1403`, `:1406`, `:1412` | alternate greeting reorder/remove buttons | Reorders or removes alternate greetings. | Updates `alternateGreetings`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/CharConfig.svelte:933` | remove character button | Deletes/trashes selected character. | Updates/deletes character and related chats/messages. | `server/fastify/src/routes/commands.ts:3344` or `:3396`. |
| `src/lib/SideBars/CharConfig.svelte:1455`, `:1464` | module buttons | Applies module data to character/chat/global scope. | May update character/module/chat data depending on module operation. | Character patch `commands.ts:3344`, chat patch `:3599`, module handlers `:5284` through `:5473`. |
