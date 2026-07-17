# Inlay explorer catalog is not synchronized with server assets

## Summary

Inlay bytes were migrated to Fastify's asset repository, but the catalog that powers the Inlay Assets Explorer was left in browser-local IndexedDB. Uploading an inlay therefore creates authoritative bytes on the server and only a device-local name/type/dimension record. A fresh browser, another client, or a client after server backup replacement can render an inlay whose hash is already known, but cannot discover it in the explorer. Conversely, the explorer can keep rows for assets that no longer exist after a restore. Its Delete action removes only local aliases even though the UI reports that the asset was deleted.

## Location

- `src/ts/process/files/inlays.ts:34-37,74-95,173-209,215-264,325-385,406-446`
- `src/lib/Playground/PlaygroundInlayExplorer.svelte:13-29,63-118,181-200,203-320`
- `src/ts/server/assets.ts:34-43,62-95,107-135`
- `server/fastify/src/routes/assets.ts:205-354`
- `src/ts/server/backups.ts:108-169,274-360`
- `src/ts/server/resourceRefresh.ts:43-84`
- `server/fastify/src/repository.ts:2194-2247,2262-2287,2391-2451`
- `src/ts/process/files/tests/inlays.test.ts:333-400`

## Trigger

Any of the following exposes the split ownership:

1. Upload or generate an inlay in one browser, then open the same server in a fresh browser profile and navigate to Playground -> Inlay Assets Explorer.
2. Restore/import a server backup whose referenced asset set differs from the current server, then reopen or retry the explorer in the same browser.
3. Click Delete in the explorer, then access the same server asset by its content hash from another client or a still-persisted chat reference.

## Expected behavior

The explorer should be a projection of an authoritative catalog associated with the server asset repository. A successful upload should become discoverable by every client after acknowledgement/refresh, backup replacement should reconcile the list, and Delete should have a clearly defined durable meaning. If raw content-addressed bytes must remain while referenced, deleting a catalog entry should still be a server mutation and garbage collection should own eventual byte removal.

## Actual behavior

The explorer lists only entries present in the current browser's `localforage` instance. A second browser reports zero saved inlays even though Fastify holds and serves the bytes. After a restore, old local rows remain and can show “Preview unavailable,” while restored server inlays that have no local row are omitted. Delete immediately removes the row from this browser, but sends no request to Fastify and leaves the authoritative asset untouched.

## Underlying cause

`uploadServerAssetBytes()` correctly sends the bytes to `POST /api/v1/assets` and consumes the returned content hash/revision. `rememberServerInlayAsset()` then stores the only catalog metadata (`name`, media type, extension, dimensions, and optional friendly-id alias) in the browser-local `inlayStorage` store with the bytes removed.

Before the Fastify migration, each localforage entry owned both this metadata and its bytes, so listing and deletion at least operated on one coherent device-local collection. Moving only the bytes to the server split that former owner without adding a catalog resource or synchronization bridge.

`listInlayAssets()` iterates only that local store; it never requests a server resource. `removeInlayAsset()` similarly deletes only local keys that alias the same server hash. The Fastify asset routes expose upload, bulk upload, read/head, and existence checks, but no inlay catalog/list/remove command. Full resource refresh after backup restore has no inlay hook, so replacing the server database and asset files cannot invalidate or rebuild the device-local index.

Direct rendering partly hides the problem: when a message contains a server hash, `getInlayAssetBlob()` can read `/api/v1/assets/:id` without a local catalog entry and synthesize fallback metadata. Discovery still cannot work because there is no source from which the explorer can enumerate those ids.

## Affected data flow

1. **UI/generation action:** An imported, attached, or generated image/audio/video calls `postInlayAsset()`, `writeInlayImage()`, or `setInlayAsset()`.
2. **Server request:** `uploadServerAssetBytes()` posts raw bytes to `/api/v1/assets` with active-writer ownership.
3. **Server persistence:** Fastify stores the content-addressed file and metadata and returns `{ assetId, revision }`. Direct immutable-asset uploads deliberately return the current domain revision without advancing it and emit no command event.
4. **Client-side catalog:** The browser acknowledges that response by writing metadata only to the local `inlay` IndexedDB store. No server catalog record or command event is created.
5. **Explorer read:** `PlaygroundInlayExplorer.loadAssets()` calls `listInlayAssets()`, which enumerates only this browser's local entries. Preview reads can then fetch each known hash from Fastify.
6. **Explorer delete:** The component confirms deletion, `removeInlayAsset()` deletes local aliases, and `allAssets` immediately filters out the row. No Fastify request or acknowledgement participates.
7. **Restore/synchronization:** Backup restore/import replaces server data/assets and calls `forceServerResourceRefresh()`, but that refresh neither clears nor repopulates `inlayStorage`, leaving the displayed catalog divergent from server state.

## Severity and user impact

**Medium-high.** The explorer claims to show and delete saved inlay assets but is actually per-browser history. Users cannot find server-owned assets from another device, backup restore can leave a mix of missing ghost rows and undiscoverable valid rows, and deletion can appear successful without affecting the underlying data. Friendly names and dimensions are also lost with browser storage, while unreferenced uploads can remain server-side without a durable catalog owner.

## Recommended fix

Add a server-owned, revisioned inlay catalog separate from immutable asset bytes:

- Persist catalog entries containing asset id, display metadata, and any legacy/friendly aliases after a successful upload.
- Expose list/create/remove commands with normal active-writer, base-revision, event, and invalidation semantics.
- Make the explorer load that resource and reconcile acknowledgements by catalog-entry id, while retaining request epochs for stale list/preview responses.
- Define Delete as removing the catalog entry. Keep content-addressed bytes while database references exist and let the existing asset-reference/GC layer decide when bytes are safe to collect.
- Include the catalog in backup/restore, or deterministically rebuild it and explicitly clear device-local legacy indexes after database replacement.
- Migrate existing local entries by upserting their metadata against their known server asset ids, then retire the local catalog except for a bounded compatibility cache.

## Test coverage gap

The inlay unit tests intentionally seed a mocked localforage map and assert that listing/deletion changes only that map. Component tests mock `listInlayAssets()` and therefore cannot exercise ownership. Add route-backed tests with two independent client storage contexts: upload in one, list in the other, delete through one, and verify the other receives the catalog invalidation while referenced bytes remain readable. Add backup-replacement tests proving that stale rows disappear and restored entries become discoverable without retaining the original browser's IndexedDB.
