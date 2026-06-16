# Asset, Import, and Realm Flow Audit

Result: **bad**

Scope covered:

- Character asset uploads and metadata edits.
- `RealmMain.svelte` / `RealmPopUp.svelte` and Realm import bridge.
- Server routes: `assets`, `save`, `realmImport`, `hub`.
- Client helpers: `src/ts/server/assets.ts`, `src/ts/server/realmImport.ts`, `src/ts/characterCards.ts`.

## Findings

### 1. Server Realm JSON import stores `risuRealmImportId` where conversion deletes it

- Likely issue.
- References:
  - `server/fastify/src/routes/realmImport.ts:369`
  - `server/fastify/src/routes/realmImport.ts:371`
  - `server/fastify/src/realmImport/characterCard.ts:149`
  - `server/fastify/src/realmImport/characterCard.ts:150`
  - `server/fastify/src/realmImport/characterCard.ts:203`
  - `src/ts/characterCards.ts:1743`

The server Realm JSON path ensures `card.data.extensions.risuai` exists, then writes `risuai.risuRealmImportId = args.id`. `convertRealmCharacterCard()` later clones `extensions` into `passthroughExtensions`, deletes `passthroughExtensions.risuai`, and persists only that stripped object as `character.extentions`.

That means the server-side import id is transformed onto the incoming card but never reaches the persisted character projection. The older browser fallback writes the same logical marker to `data.data.extensions.risuRealmImportId`, outside `risuai`, so it survives the browser import path. Server and fallback imports therefore persist different metadata for the same Realm character.

Impact: imported Realm characters created through the primary server route can lose the Realm import id metadata, which may break later flows that identify, update, fork, or inspect the Realm origin from `character.extentions`.

### 2. V2 character-card export never populates the asset fields it later tries to embed

- Likely issue.
- References:
  - `src/ts/characterCards.ts:1117`
  - `src/ts/characterCards.ts:1123`
  - `src/ts/characterCards.ts:1188`
  - `src/ts/characterCards.ts:1190`
  - `src/ts/characterCards.ts:1206`
  - `src/ts/characterCards.ts:1467`
  - `src/ts/characterCards.ts:1478`

`createBaseV2()` builds the v2 export payload but leaves `risuai.emotions` and `risuai.additionalAssets` commented out. Later, the v2 export branch calls `createBaseV2(char)` and loops over `risuai.emotions` and `risuai.additionalAssets` to rewrite those asset ids to `__asset:<n>` and write embedded `chara-ext-asset_` chunks.

Because the fields are not copied into the v2 card, those loops are skipped and selected character emotion/additional assets are omitted from v2 PNG/JSON export. The v3 export path does copy `char.additionalAssets` and `char.emotionImages` into `card.data.assets`, so this appears to be a v2-specific dropped projection rather than intentional lack of asset support.

Impact: user-selected/exported character assets can disappear from v2 exports even though the export code contains a transformation path intended to embed them.

## Notes

- Character asset uploads through `saveAsset()` / `saveAssets()` return server asset ids and advance the cached command revision (`src/ts/globalApi.svelte.ts:157`, `src/ts/globalApi.svelte.ts:162`, `src/ts/server/assets.ts:71`). Character image, emotion, and additional-asset edits then flow through either scoped character updates or the server-backed character draft watcher (`src/ts/characters.ts:165`, `src/ts/characters.ts:220`, `src/lib/SideBars/CharConfig.svelte:87`, `src/ts/server/characterBridge.svelte.ts:113`, `src/ts/server/characterBridge.svelte.ts:188`).
- Server `.risu` and bundle import/export use repository snapshots and the asset report walker covers `image`, `emotionImages`, `additionalAssets`, `ccAssets`, VITS files, and inlay references (`server/fastify/src/routes/save.ts:85`, `server/fastify/src/routes/save.ts:124`, `server/fastify/src/risuSave/assetReferences.ts:164`).
- Realm UI selection passes the selected/input id into `downloadRisuHub()` and then the server import bridge; no separate UI-side projection write was found in `RealmMain.svelte` or `RealmPopUp.svelte` (`src/lib/UI/Realm/RealmMain.svelte:232`, `src/lib/UI/Realm/RealmPopUp.svelte:155`, `src/ts/characterCards.ts:1671`).
