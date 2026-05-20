# Removals Status

Date: 2026-05-20

Tracks Phase 0 progress. Update each row as code is deleted. The
canonical scope lives in
[`../phases/phase-0-removals.md`](../phases/phase-0-removals.md).

Last updated: 2026-05-20 (Group chat landed — Phase 0 complete).

## Group chat

Status: done (2026-05-20). Phase 0 closes with this slice.

Removed:

- `src/ts/process/group.ts` deleted (`addGroupChar`,
  `rmCharFromGroup`, `groupOrder` + private `getWords`). `createNewGroup`
  in `characters.ts` plus the `'createGroup'` switch arm that calls it
  also gone. `makeGroupImage` deleted from `characters.ts`.
- `interface groupChat` dropped from `database.svelte.ts`;
  `Database.characters` narrowed to `character[]`; helper signatures
  (`getCurrentCharacter`, `setCurrentCharacter`, `getCharacterByIndex`,
  `setCharacterByIndex`) follow. `setDatabase` filters out any
  persisted `type !== 'character'` rows at load time — old saves
  load cleanly and the group rows disappear on the next save (no
  migration script, per Phase 0 policy).
- `Database.groupOtherBotRole`, `Database.groupTemplate`,
  `botPreset.groupOtherBotRole`, `botPreset.groupTemplate` and
  their init/import/export sites in `database.svelte.ts` dropped.
- `sendChat` (`process/index.svelte.ts`) lost the group dispatch
  block (former 263-307), the post-everything "speaker hint"
  injection at the former 441-447, the `type !== 'group'` guard
  around the first-message push, and the group-template chat
  formatting at the former 934-955. `isGroupChat` is kept on the
  script-runtime payload as a back-compat shim, hard-coded to
  `false`.
- All `'group'` runtime branches stripped across `src/ts/`:
  `tokenizer.ts`, `util.ts`, `cbs.ts`, `stores.svelte.ts`,
  `characterCards.ts`, `parser/parser.svelte.ts`, `characters.ts`,
  `translator/translator.ts`, `storage/{exportAsDataset,backup}.ts`,
  `process/{command,scriptings,tts,scripts,modules,request/request,
  memory/hypav3,mcp/risuaccess/{characters,chats,utils}}.ts`. The
  13 uniform `'Error: The id pointed to a group chat'` blocks in
  `mcp/risuaccess/characters.ts` removed in bulk.
- `lightningRealmImport` — already gone in 0.3+0.4; no further
  action.
- UI cleanup across `src/lib/`: `Setting/Pages/PromptSettings.svelte`
  (Group Other Bot Role selector + Group Inner Format textarea),
  `Others/AlertComp.svelte` ("Create Group Chat" button +
  `selectChar` group filter), `Others/BookmarkList.svelte` (group
  speaker resolution path), `SideBars/CharConfig.svelte` (group
  member grid, `addGroupChar`/`rmCharFromGroup` imports,
  `makeGroupImage` button, `orderByOrder` toggle, group lowLevelAccess
  branch), `SideBars/SideChatList.svelte` (group new-chat seeding,
  `orderByOrder` toggle, unused `findCharacterbyId` import),
  `SideBars/Toggles.svelte` (type union), `SideBars/LoreBook/
  LoreBookSetting.svelte` (group lore label / info), `ChatScreens/
  {ChatScreen, DefaultChatScreen, Chat, BackgroundDom, Chats,
  AssetInput, Suggestion}.svelte` (type unions + the
  `runAutoMode`/`autoMode` group-only state in
  `DefaultChatScreen`), `Mobile/MobileCharacters.svelte` (sortChar
  param type).
- Lang keys removed across all 7 lang files: `errors.alreadyCharInGroup`,
  `groupInnerFormat` desc, `groupOtherBotRole` desc + label,
  `group`, `groupLoreInfo`, `removeGroup`, `createGroup`,
  `groupIcon`, `askLoadFirstMsg`, `createGroupImg`, `talkness`.

Verification: `pnpm check` (0 errors / 0 warnings), `pnpm test`
(152 passed, 4 pre-existing skips), `pnpm build` succeeded.
Grep for `groupChat|type === 'group'|type !== 'group'` in `src/`
returns no hits outside the `'group'/'groupEnd'/'divider'`
sidebar-template tokens in `util.ts:1101` (unrelated to chat groups)
and the one-shot load filter in `database.svelte.ts`.

## Peer multi-user chat

Status: done (2026-05-20).

Removed:

- `src/ts/sync/multiuser.ts` deleted.
- `src/ts/process/index.svelte.ts` import (line 41), the
  `connectionOpen` guard / `peerSafeCheck` / `peerRevertChat` /
  `peerSync` block (was lines 221-230), and the trailing
  `peerSync()` call (was line 1980) deleted.
- UI consumers cleaned: `src/lib/Playground/PlaygroundMenu.svelte`
  (Join MultiUser Room button gone),
  `src/lib/SideBars/SideChatList.svelte` (both `case 2:` /
  `createMultiuserRoom()` branches gone),
  `src/lib/SideBars/Sidebar.svelte` (`{:else if $ConnectionOpenStore}`
  branch gone), `src/lib/ChatScreens/Chat.svelte`
  (`{#if !$ConnectionOpenStore}` wrapper unwrapped),
  `src/lib/ChatScreens/DefaultChatScreen.svelte`
  (`$ConnectionOpenStore ? DBState.db.username : null` collapsed
  to `null`), `src/lib/Others/AlertComp.svelte`
  (`useExperimental` "Create Multiuser Room" button gone).
- Language strings deleted from `src/lang/{en,ko,cn,de,es,vi}.ts`:
  `joinMultiUserRoom`, `connectionOpen`, `connectionOpenInfo`,
  `createMultiuserRoom`, `connectionHost`, `connectionGuest`,
  `otherUserRequesting`.
- `peerjs` dropped from `package.json` and `pnpm-lock.yaml`
  (verified via `pnpm install`).

Verification: `pnpm check` (0 errors / 0 warnings), `pnpm test`
(152 passed, 4 skipped), `pnpm build` succeeded. Grep for
`multiuser|peerjs|peerSync|peerSafeCheck|peerRevertChat|connectionOpen`
in `src/` returns no hits.

## Risu Account Sync

Status: done (2026-05-20). Landed in the same commit as Google
Drive sync below.

Removed:

- `src/ts/storage/accountStorage.ts` (211 LOC), `src/ts/drive/accounter.ts`
  (137 LOC), `src/ts/sionyw.ts` (342 LOC) deleted.
- `src/ts/storage/autoStorage.ts` lost the `AccountStorage`
  instantiation path (`checkAccountSync`, `isAccount` field, all
  four `isAccount = true` write sites). `realStorage` now always
  falls through to localforage/OPFS/NodeStorage.
- `src/ts/globalApi.svelte.ts` lost six `forageStorage.isAccount`
  branches plus the `loadRisuAccountData` / `AccountStorage` /
  `checkDriverInit` / `syncDrive` imports.
- `src/ts/bootstrap.ts` lost the `checkAccountSync` boot block,
  the `loadRisuAccountData()` call, and the `AccountStorage` cast
  used to read the remote save bin.
- `src/ts/characterCards.ts` lost the `instanceof AccountStorage`
  CharX-skippable preflight, the `lightningRealmImport` hub-fetch
  fallback (queueFetch path), and the function-parameter / Realm
  call sites that fed it.
- `src/ts/process/coldstorage.svelte.ts` lost the four
  `fetchProtectedResource('/hub/account/coldstorage', ...)`
  branches in get/set/list/remove.
- `src/ts/process/stableDiff.ts` lost the `fallbackRisuToken`
  localStorage rehydrate inside the kei SD provider.
- `src/ts/plugins/apiV3/v3.svelte.ts` collapsed `saveMethod` to
  `tauri | local`.
- `src/lib/Setting/Pages/UserSettings.svelte` rewritten - only
  local backup / cold-storage / export buttons remain.
- `src/lib/Others/SavePopupIcon.svelte` lost the
  `AccountWarning` icon path.
- `Database.account` shape pruned to `{ token, id, kei? }` (Realm +
  kei consumers still need `token`/`id`). `data` and `useSync`
  dropped. `Database.lightningRealmImport` dropped along with its
  `advancedSettingsData.ts` entry.
- `server/node/server.cjs` lost `const openid = require('openid-client')`,
  `getSionywAccessToken` and its access-token cache, `/api/oauth_login`,
  `/api/oauth_callback`, the `__sionyw_client_data.json` reads/writes,
  the `__authcode` path constant and reader, and the
  `Authorization === 'X-Node-Server-Auth'` Bearer-injection branch
  inside `hubProxyFunc`.
- `openid-client` dropped from `package.json`; `pnpm install`
  pruned 5 packages (the dependency tree).

## Google Drive sync

Status: done (2026-05-20). Landed alongside Account Sync.

Removed:

- `src/ts/drive/drive.ts` (453 LOC) deleted; `src/ts/drive/`
  directory removed entirely.
- `src/ts/drive/backuplocal.ts` (512 LOC) was *moved* to
  `src/ts/storage/backup.ts` with the seven `forageStorage.isAccount`
  branches stripped. The user-facing "Save / Save Partial / Load
  local backup" UI in UserSettings.svelte continues to work; only
  the Account-sync dead branches inside it were dropped.
- `src/lib/Setting/Pages/FilesSettings.svelte` deleted - it was a
  pure Drive sync settings page (and unreachable from the settings
  menu chips already). The `case 5: FilesSettings` branch in
  `src/lib/Setting/Settings.svelte` was removed.
- `src/ts/globalApi.svelte.ts` lost the `syncDrive()` kickoff at
  the top of `saveDb`.

Verification: `pnpm check` (0 errors / 0 warnings), `pnpm test`
(152 passed, 4 pre-existing skips), `pnpm build` succeeded. Grep
for `accountStorage|sionyw|RisuAccount|drive/drive|drive/backuplocal|drive/accounter|forageStorage\.isAccount`
in `src/` returns no hits.

Note: replacement backups will be provided by the Fastify server
(`/api/v1/backups` + `/api/v1/export/bundle`) once Phase 2 lands.
Phase 0 only deletes; it does not add replacements.

## Legacy memory engines (Supa, Hypa V2, Hanurai)

Status: done (2026-05-20). Landed as two commits:

- Commit A: decoupled Hypa V3 from the shared `supaMemoryKey`
  database field by introducing `hypaV3Key` with a one-shot read
  fallback; renamed all V3 + shared-infra read sites and the
  V3-specific settings input.
- Commit B (this entry): the bulk removal below.

Removed:

- `src/ts/process/memory/{supaMemory.ts, hypav2.ts,
hanuraiMemory.ts}` deleted. Shared infra `hypamemory.ts` and
  `hypamemoryv2.ts` kept (despite the V2 name, V3 imports from
  the latter).
- `src/ts/process/index.svelte.ts`: legacy imports gone; engine
  cascade at the former 1082-1178 collapsed to a single V3
  branch; `supaMemoryCardUsed` renamed to `memoryCardUsed` (the
  prompt-template "memory" card mechanism is preserved - V3 still
  uses it).
- Settings UI: 4-option engine selector replaced with a single
  V3 on/off toggle in `OtherBotSettings.svelte`; all V2/Supa/Hanurai
  config sub-blocks deleted.
- V2 modal infrastructure removed: `showHypaV2Alert` + the
  `'hypaV2'` alert type in `src/ts/alert.ts`; the V2 alert block
  in `AlertComp.svelte`; the V2 toggle entries in
  `DefaultChatScreen.svelte`, `CharConfig.svelte`,
  `SideBars/Toggles.svelte`.
- V2-to-V3 migration code in `HypaV3Modal.svelte`
  (`isHypaV2ConversionPossible` / `convertHypaV2ToV3` + the
  conversion button) deleted; consistent with Phase 0's "no
  migration scripts" policy. Saved V2 chunks remain in JSON but
  are no longer surfaced.
- `coldstorage.svelte.ts` no longer round-trips `hypaV2Data`.
- `PlaygroundEmbedding.svelte` rebound to `hypaV3Key`.
- Database type pruned: dropped `supaMemoryPrompt`,
  `supaModelType`, `hypav2`, `hypaMemory`, `memoryAlgorithmType`,
  `maxSupaChunkSize`, `hypaAllocatedTokens`, `hypaChunkSize`,
  `hanuraiTokens`, `hanuraiSplit`, `hanuraiEnable`; dropped
  `supaMemoryData` and `hypaV2Data` from Chat; dropped the
  `SerializableHypaV2Data` import. Init defaults for those fields
  removed.
- Kept: per-chatroom `supaMemory: boolean` (repurposed as the V3
  enable flag per Phase 0.5 plan); `supaMemoryKey` retained as
  optional source for the one-shot `hypaV3Key` fallback;
  `memo: 'supaMemory'` / `memo: 'hypaMemory'` protocol tags
  (shared with the prompt-template consumer; renamed later).
- Lang keys removed across `en/ko/cn/de/es/vi`:
  `ToggleSuperMemory`, `maxSupaChunkSize`, `hanuraiMemory`,
  `hypaAllocatedTokens`, `hypaChunkSize`, `hypaV2Desc`,
  `supaDesc`, `hanuraiDesc`, `hypaMemoryV2Modal`.

Verification: `pnpm check` (0 errors / 0 warnings), `pnpm test`
(152 passed, 4 pre-existing skips), `pnpm build` succeeded.
Grep for `supaMemoryData|hypaV2Data|hanurai|hypav2|memoryAlgorithmType`
in `src/` returns no production-code hits outside `database.svelte.ts`'s
single localized cast for the V3 preset migration.
