# Phase 0 - Removals

Date: 2026-05-20

Historical note: Phase 0 is closed. References below to keeping the
Express server describe Phase 0 scope only; Phase 3 later deleted
`server/node/`.

## Goal

Delete Group chat, peer-to-peer multi-user chat, Risu Account Sync,
Google Drive sync, and the Supa / Hypa V2 / Hanurai memory-engine entry
points from the live surface, so later phases port a smaller surface.

Status: complete as of 2026-05-20. The as-landed inventory was recorded in the
now-removed `status-removals.md`.

## Preconditions

None. Phase 0 is the start.

## Scope

Five removal targets. Land each as its own commit (or series of
commits) so a bisect can isolate any regression. Status per target was recorded
in the now-removed `status-removals.md`.

### 0.1 Group chat

Delete:

- `src/ts/process/group.ts`.
- The live chat-group `type === 'group'` branches under `src/ts/`
  (49 sites) and `src/lib/` (~20 sites). Each branch either:
  - was the only `'group'` user (delete the conditional), or
  - left a now-impossible code path (delete the whole branch).
- Prompt-toggle grouping syntax also uses the string `'group'` and
  is unrelated; leave that syntax alone.
- `groupOrder`, `addGroupChar`, `rmCharFromGroup` references.
- Group-creation UI in character config, mobile character lists, and
  chat-screen group views (`ChatScreen`, `BackgroundDom`, `Chats`,
  `AssetInput`, `Suggestion`).
- Group-only settings on the database / character types:
  `groupOtherBotRole`, `characterTalks`, `characterActive`,
  `characters`/`chats` arrays inside group rows, the
  `'group'` literal type itself.

Persisted databases that contain group rows should load. On load,
treat group rows as inert (no UI surface) and let the next save
drop them. Do not write a migration script - users either re-import
or the rows sit unused.

### 0.2 Peer multi-user chat

Delete:

- `src/ts/sync/multiuser.ts`.
- Imports and call sites in
  `src/ts/process/index.svelte.ts` (4 sites) and
  `src/lib/{ChatScreens, SideBars, Playground}/*.svelte`.
- `peerjs` from `package.json` dependencies and lockfile.
- Language strings: `joinMultiUserRoom`, `multiuser*` keys (their
  language files surface in `src/lang/*.ts`).

### 0.3 Risu Account Sync

Delete:

- `src/ts/storage/accountStorage.ts`.
- `src/ts/drive/accounter.ts`.
- `src/ts/sionyw.ts`.
- The "Risu Account" / "Sionyw" section of
  `src/lib/Setting/Pages/UserSettings.svelte`.
- OAuth handlers in `server/node/server.cjs`
  (`/api/oauth_login`, `/api/oauth_callback`,
  `getSionywAccessToken`, related caches and the
  `__sionyw_client_data.json` write).
- The "Account Save" / "Account Load" buttons in
  `src/lib/Others/SavePopupIcon.svelte`.
- `forageStorage.isAccount` branches in
  `src/ts/globalApi.svelte.ts`,
  `src/ts/storage/autoStorage.ts`,
  `src/ts/characterCards.ts`,
  `src/ts/bootstrap.ts`.

Then audit `openid-client` use across the repo; remove it from
`package.json` if and only if nothing else imports it.

### 0.4 Google Drive sync

Delete:

- `src/ts/drive/drive.ts`.
- "Save to Google Drive" / "Restore from Drive" UI entries.

Keep, with the `forageStorage.isAccount` dead branches stripped:

- `src/ts/drive/backuplocal.ts` is _not_ Drive-sync-coupled despite
  living under `drive/`. It implements the in-app "Save local
  backup" / "Load local backup" UI on top of `LocalWriter` +
  `risuSave.ts`. Move it to `src/ts/storage/backup.ts` and strip
  the Account-Sync dead branches inside it.

The Phase 2 Fastify backup routes (`/api/v1/backups`) are the
server-side snapshot replacement for _cloud_ backup during the
migration. Bundle export (`/api/v1/export/bundle`) is deferred to
Phase 9; local-file backup keeps working through `storage/backup.ts`
in the meantime.

### 0.5 Legacy memory engines

Delete:

- `src/ts/process/memory/supaMemory.ts`.
- `src/ts/process/memory/hypav2.ts`.
- `src/ts/process/memory/hanuraiMemory.ts`.
- The selection branches in `src/ts/process/index.svelte.ts`
  lines 1097-1142 that pick one of the four engines.
- The settings UI control that lets a user pick a memory engine
  (replace with a Hypa V3 on/off toggle if needed).
- Persisted `supaMemory: true` reads silently as "memory enabled"
  pointing at Hypa V3. Keep the per-chat `supaMemory` field as the
  V3 enable flag for now, and keep legacy `memo: 'supaMemory'` /
  `memo: 'hypaMemory'` protocol tags until the prompt-template
  consumer is renamed in a later phase.

## Boundaries

- **Do not edit `sendChat`'s control flow beyond removing dead
  branches.** Anything else that "looks refactorable" stays for
  Phase 5.
- **Do not add the Fastify server in this phase.** Phase 1 owns
  scaffold.
- **Do not migrate group data.** Old saves load; group rows are
  inert. No conversion path.
- **Do not delete legacy local mode-specific code.** It is out of migration
  scope; only delete a legacy local mode file when it depends on a removed
  feature and the dependency cannot be made optional.
- **Do not remove the Express server in Phase 0.** Phase 3 later
  retired and deleted it.

## Exit criteria

- No live Group-chat model, pipeline, or creation UI remains. Grep
  for `type === 'group'` is allowed to find only prompt-toggle
  grouping syntax, the database load filter, and the stale
  unreachable UI checks listed below.
- `rg "peerjs|multiuser" src/` returns no hits.
- `rg "accountStorage|RisuAccount|drive/drive|drive/backuplocal|drive/accounter|forageStorage\\.isAccount" src/`
  returns no hits. `sionyw.com` may still appear in unrelated
  terms/privacy links, plugin blacklist entries, or MCP OAuth helper
  placeholders.
- `src/ts/drive/` no longer exists.
- `src/ts/process/memory/` contains only Hypa V3 live-engine code plus
  shared embedding helpers that Hypa V3 imports, including legacy-named
  `hypamemory*.ts` modules.
- `peerjs` is removed from `package.json`; `openid-client` is
  removed if no consumer remains.
- `pnpm check`, `pnpm test`, `pnpm build` are green.
- The app still boots, chats with a non-group character, and shows
  a clean settings page.

Known cleanup debt: `type === 'group'` currently still appears in
the prompt-toggle parser/UI (`group` and `groupEnd` toggle syntax),
the one-shot database load filter that drops old group rows, and
stale unreachable UI checks in `src/lib/Others/ChatList.svelte` and
`src/lib/Others/GridCatalog.svelte`. Those do not reintroduce Group
chat, but they should be removed or renamed when touching those files.

## Reference

- The `move-to-fastify` branch does not perform these removals; it
  ports the features as-is, then masks them in the UI. We do the
  opposite: delete first, port less.
- `risuai-metatron` deleted peer sync entirely (see its
  `phase-9-client-removal.md`: "PeerJS retirement"). Same direction.
