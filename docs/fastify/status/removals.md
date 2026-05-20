# Removals Status

Date: 2026-05-20

Tracks Phase 0 progress. Update each row as code is deleted. The
canonical scope lives in
[`../phases/phase-0-removals.md`](../phases/phase-0-removals.md).

Last updated: 2026-05-20 (Peer multi-user chat landed).

## Group chat

Status: not started.

Code surface:

- `src/ts/process/group.ts` (100 LOC) - speaker selection, group
  membership helpers.
- `src/ts/process/index.svelte.ts` - 5 sites referencing
  `groupOrder` / `nowChatroom.type === 'group'` /
  `isGroupChat`.
- `src/ts/` - 49 `type === 'group'` branches across `tokenizer.ts`,
  `util.ts`, `cbs.ts`, `stores.svelte.ts`, `characterCards.ts`,
  `process/{command, scriptings, tts, mcp/risuaccess/chats}.ts`,
  `storage/exportAsDataset.ts`.
- `src/lib/` - ~20 `type === 'group'` branches in
  `ChatScreens/`, `Mobile/`, `Others/`, `SideBars/`.
- Settings: `groupOtherBotRole`, `characterTalks`,
  `characterActive` on character/database types.

Exit when:

- No `type === 'group'` reference remains in `src/ts/` or
  `src/lib/`.
- `Database.characters[].type` no longer accepts `'group'`.
- `pnpm check`, `pnpm test`, `pnpm build` stay green.

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

Status: not started.

Code surface:

- `src/ts/storage/accountStorage.ts` (211 LOC).
- `src/ts/drive/accounter.ts` (137 LOC) - Risu account profile /
  login flow.
- `src/ts/sionyw.ts` (342 LOC) - sionyw OAuth client.
- `server/node/server.cjs` - `/api/oauth_login`,
  `/api/oauth_callback`, `getSionywAccessToken`, related state.
- `src/lib/Setting/Pages/UserSettings.svelte` - sync settings UI.
- `src/ts/globalApi.svelte.ts`, `src/ts/bootstrap.ts`,
  `src/ts/storage/autoStorage.ts`,
  `src/ts/characterCards.ts`,
  `src/lib/Others/SavePopupIcon.svelte` - call sites that go away
  once `forageStorage.isAccount` cannot be true.
- `openid-client` dependency in `package.json` (audit other
  consumers before removing).

Exit when:

- Grep for `accountStorage`, `Sionyw`, `sionyw`,
  `RisuAccount` returns no hits in `src/`.
- The user-settings page no longer offers the Risu Account section.
- `openid-client` is removed if and only if nothing else needs it.

## Google Drive sync

Status: not started.

Code surface:

- `src/ts/drive/drive.ts` (453 LOC).
- `src/ts/drive/backuplocal.ts` (512 LOC) - the user-triggered
  local backup helpers that share the Drive code path.
- Settings UI entries for "Save to Google Drive" / "Restore from
  Drive".

Exit when:

- `src/ts/drive/` is empty or only contains files unrelated to
  Drive sync.
- No UI surface offers Drive sync.

Note: replacement backups will be provided by the Fastify server
(`/api/v1/backups` + `/api/v1/export/bundle`) once Phase 2 lands.
Phase 0 only deletes; it does not add replacements.

## Legacy memory engines (Supa, Hypa V2, Hanurai)

Status: not started.

Code surface:

- `src/ts/process/memory/supaMemory.ts`.
- `src/ts/process/memory/hypav2.ts`.
- `src/ts/process/memory/hanuraiMemory.ts`.
- `src/ts/process/index.svelte.ts` lines 1097-1142 - the
  selection branches that pick one of the four engines.
- Settings UI: "supaMemory enabled" toggle and engine selector.

Exit when:

- Only Hypa V3 remains under `src/ts/process/memory/`.
- The settings UI no longer offers a memory-engine selector;
  Hypa V3 is the only option (or memory off).
- Persisted databases that record `supaMemory: true` continue to
  load (drop the setting silently on read; do not write it back).
