# Character Editor Persistence Audit

## Scope

Audited the Fastify-backed character editor UI and character command persistence path for user-input content changes. Focused on non-module character fields and adjacent character-owned collections: description, first message, alternate greetings, background HTML/background embedding naming, personality/scenario, creator notes, system/author-note-like text, default variables, nickname/depth prompt, additional asset metadata, image/emotion metadata, regex scripts/triggers, and character lorebook attachments.

Result: normal. I did not find a likely case where the character editor mutates a draft/local object but the persisted command payload or optimistic projection fails to include the changed content.

## Files Inspected

- `STRUCTURE.md`
- `src/lib/SideBars/CharConfig.svelte`
- `src/ts/server/characterBridge.svelte.ts`
- `src/ts/characterCommands.ts`
- `server/fastify/src/commands/characters.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/server/commands.ts`
- `src/ts/characters.ts`
- `src/ts/storage/database.svelte.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/realmImport/characterCard.ts`
- `src/ts/process/mcp/risuaccess/characters.ts`
- Related tests under `src/ts/server/*.test.ts`, `src/ts/server/commands.test.ts`, and `server/fastify/__tests__/*`.

## Findings

No issue found.

The character editor creates a server-backed draft with the editable character fields whitelisted at `src/lib/SideBars/CharConfig.svelte:87`. The list includes the requested content-bearing fields and adjacent metadata fields: `desc`, `firstMessage`, `additionalAssets`, `prebuiltAssetExclude`, `backgroundHTML`, `creatorNotes`, `systemPrompt`, `replaceGlobalNote`, `additionalText`, `personality`, `scenario`, `defaultVariables`, `translatorNote`, `additionalData`, `nickname`, `depth_prompt`, and `alternateGreetings` at `src/lib/SideBars/CharConfig.svelte:89`, `src/lib/SideBars/CharConfig.svelte:90`, `src/lib/SideBars/CharConfig.svelte:98`, `src/lib/SideBars/CharConfig.svelte:101`, `src/lib/SideBars/CharConfig.svelte:106`, and `src/lib/SideBars/CharConfig.svelte:121`.

The visible editor bindings write into those draft fields. Examples include description and first message at `src/lib/SideBars/CharConfig.svelte:509` and `src/lib/SideBars/CharConfig.svelte:512`, additional asset display-name metadata at `src/lib/SideBars/CharConfig.svelte:823`, background HTML at `src/lib/SideBars/CharConfig.svelte:878`, creator notes/system prompt/personality/scenario at `src/lib/SideBars/CharConfig.svelte:1312`, `src/lib/SideBars/CharConfig.svelte:1321`, `src/lib/SideBars/CharConfig.svelte:1334`, and `src/lib/SideBars/CharConfig.svelte:1339`, and alternate greetings at `src/lib/SideBars/CharConfig.svelte:1395`.

Draft changes are mirrored optimistically into `DBState.db.characters` by `createServerBackedCharacterDraft`, which snapshots `draft.value`, sanitizes the cloned draft, and assigns it onto the live character at `src/ts/server/characterBridge.svelte.ts:76`. `watchServerBackedCharacterProfile` then diffs the live character profile and queues an `updateCharacter` command at `src/ts/server/characterBridge.svelte.ts:166`. The diff excludes only server-owned collection fields such as `globalLore`, `customscript`, and `triggerscript`, not the requested scalar/nested editor fields, at `src/ts/characterCommands.ts:47` and `src/ts/server/characterBridge.svelte.ts:284`.

The command payload path preserves those fields. `dispatchUpdateCharacterWith` sanitizes the patch and calls `updateCharacterCommand` with the remaining fields at `src/ts/characterCommands.ts:317`. The command adapter sends the patch body to `PATCH /api/v1/commands/characters/:characterId` at `src/ts/server/commands.ts:1863`. On the server, `readCharacterPatch` accepts ordinary JSON character fields while rejecting only separately owned command slices at `server/fastify/src/commands/characters.ts:156` and `server/fastify/src/commands/characters.ts:322`. The route applies the patch to the target row and writes that row at `server/fastify/src/routes/commands.ts:3344` and `server/fastify/src/routes/commands.ts:3372`.

Character lorebook and regex/trigger attachments intentionally use separate commands rather than the character patch command. The character editor mounts the character-scoped script watcher at `src/lib/SideBars/CharConfig.svelte:145`, and local regex/trigger drafts are applied through `applyCharacterScriptDefinitionDraft` at `src/lib/SideBars/CharConfig.svelte:163`. That bridge sends replacement payloads through `replaceCharacterScriptsCommand` and `replaceCharacterTriggersCommand` at `src/ts/server/scriptDefinitionBridge.svelte.ts:151` and `src/ts/server/scriptDefinitionBridge.svelte.ts:178`; the server persists them with targeted row writes at `server/fastify/src/routes/commands.ts:6025` and `server/fastify/src/routes/commands.ts:6061`. Lorebook bridge APIs similarly replace or upsert character lorebook entries through `/characters/:id/lorebooks` endpoints, with targeted row writes at `server/fastify/src/routes/commands.ts:4912`, `server/fastify/src/routes/commands.ts:4957`, and `server/fastify/src/routes/commands.ts:5004`.

The `backgroundEmbedding` name did not indicate a character-editor persistence problem. Modules expose `backgroundEmbedding` in projection stubs at `server/fastify/src/repository.ts:1686`, while character UI/import/MCP use `backgroundHTML`: the character import path writes `backgroundHTML` at `server/fastify/src/realmImport/characterCard.ts:197`, and MCP remaps character `backgroundEmbedding` to `backgroundHTML` at `src/ts/process/mcp/risuaccess/characters.ts:412`.

Image and emotion editor actions that bypass `characterDraft` still dispatch compatible character updates. `selectCharImg`, `changeCharImage`, `addCharEmotion`, and `rmCharEmotion` snapshot the row, mutate the live character under a trusted projection write, then dispatch `dispatchCompatibleCharacterUpdateScoped` at `src/ts/characters.ts:113`, `src/ts/characters.ts:197`, `src/ts/characters.ts:213`, and `src/ts/characters.ts:236`.

## Why This Is Normal

The editable fields are represented in the draft seed list, nested draft edits are observed by the draft snapshot flow, the optimistic live-character update uses the sanitized draft, and the server command sanitizer excludes only fields that are persisted by their own command families. Character lorebooks and regex/trigger scripts are separated, but their bridges and server routes carry the edited collections explicitly. Asset display-name edits and asset exclude metadata are ordinary character patch fields, and uploaded asset ids are validated server-side before persistence.

Existing tests cover important parts of this flow: nested draft edits and sanitized character patch dispatch in `src/ts/server/characterBridge.svelte.test.ts:204`, command adapter patch payloads in `src/ts/server/commands.test.ts:1418`, targeted character patch writes in `server/fastify/__tests__/commandMutationReadNarrowing.test.ts:274`, and targeted script/trigger persistence in `server/fastify/__tests__/commandFloorUnblock.test.ts:267`.

## Suggested Fixes And Tests

No fix is recommended for this slice.

Suggested coverage additions:

- Add a focused character editor bridge test that edits `desc`, `firstMessage`, `backgroundHTML`, `personality`, `scenario`, `alternateGreetings`, `additionalData.creator`, `additionalData.character_version`, `additionalAssets[0][0]`, and `prebuiltAssetExclude`, then asserts the queued `updateCharacter` patch includes exactly those changed fields.
- Add a server command integration test for `PATCH /api/v1/commands/characters/:id` with `backgroundHTML`, `alternateGreetings`, `additionalAssets`, `prebuiltAssetExclude`, `personality`, and `scenario`, then read the character row back from SQLite.
- Add a UI or bridge regression test for character lorebook and regex edits from the character sidebar to assert they use the separate lorebook/script endpoints and do not leak into or get dropped by the generic character patch sanitizer.
