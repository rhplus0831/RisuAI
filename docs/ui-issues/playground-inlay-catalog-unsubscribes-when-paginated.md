# Paginated inlay explorer unsubscribes from the authoritative catalog

- **Severity:** Medium
- **Affected surface:** `PLAY-09` (Inlay Explorer)
- **Primary location:** `src/lib/Playground/PlaygroundInlayExplorer.svelte:138-184`

## Trigger

1. Open the Inlay Explorer when the server catalog contains more than `PAGE_SIZE` (36) assets.
2. The first page loads, `hasMore` becomes true, and the load-more sentinel is mounted.
3. Add or remove an inlay through another UI path, another browser, or another client session while the explorer remains open.

## Expected behavior

The explorer should stay subscribed to the revisioned server inlay catalog for its entire mounted lifetime. A receipt from a local catalog mutation, or a refreshed resource produced by another client's command event, should cause the displayed count and cards to reload.

## Actual behavior

As soon as pagination is active, the intersection-observer effect calls `unsubscribeCatalog()` (`src/lib/Playground/PlaygroundInlayExplorer.svelte:156-158`). The explorer consequently stops receiving catalog notifications. Its `allAssets` projection remains stale until the component is remounted or the user encounters another path that explicitly calls `loadAssets()`.

Catalogs of 36 or fewer assets do not hit that branch, but their subscription has the inverse lifecycle bug: `onDestroy` disconnects the intersection observer without calling `unsubscribeCatalog()` (`src/lib/Playground/PlaygroundInlayExplorer.svelte:178-184`).

## Underlying cause

The catalog unsubscribe function was placed in the pagination observer setup instead of the component teardown. Pagination and catalog-subscription lifetimes are independent, but the code currently couples them.

The existing synchronization test uses a one-item catalog for its notification assertion (`src/lib/Playground/PlaygroundInlayExplorer.svelte.test.ts:92-105`), while the pagination fixture contains 40 items but never fires the catalog listener (`src/lib/Playground/PlaygroundInlayExplorer.svelte.test.ts:65-70,137-150`). That leaves the failing combination uncovered.

## Affected data flow

1. An inlay writer uploads bytes and calls `rememberServerInlayAsset`, which sends a revisioned upsert command (`src/ts/process/files/inlays.ts:107-153`). Deletions use `deleteServerInlayCatalogCommand` (`src/ts/process/files/inlays.ts:547-568`).
2. Fastify persists the catalog row and returns a revision plus `inlayCatalog.upserted` or `inlayCatalog.deleted` event (`server/fastify/src/routes/commands.ts:8003-8037,8040-8072`).
3. A local receipt or a foreign-client invalidation applies the refreshed catalog through `applyServerInlayCatalogResource`. The foreign-client path plans an inlay read (`src/ts/server/resourceInvalidation.ts:432-438`), fetches `GET /api/v1/inlay-assets` (`src/ts/server/resourceInvalidation.ts:779-786`; `server/fastify/src/routes/resourceReads.ts:99-105`), and applies it (`src/ts/server/resourceInvalidation.ts:997-1008`).
4. Applying a catalog resource notifies every registered listener (`src/ts/server/inlayCatalog.ts:31-42`).
5. The explorer's listener is supposed to call `loadAssets()` and replace `allAssets` (`src/lib/Playground/PlaygroundInlayExplorer.svelte:186-212`). In a paginated catalog, that listener has already been removed, so the displayed grid and total never receive the authoritative update.

## User impact

Users with larger media libraries can see different versions of the inlay catalog in different surfaces or clients. Newly created assets may appear missing, and assets deleted elsewhere may remain selectable. Remounting the explorer appears to "fix" the discrepancy, making the failure look intermittent.

## Recommended fix

- Remove `unsubscribeCatalog()` from the intersection-observer effect.
- Call it exactly once from `onDestroy`; leave the effect cleanup responsible only for `IntersectionObserver` cleanup.
- Add a component test with more than 36 assets that fires the catalog listener after the sentinel is mounted and asserts a second authoritative load.
- Add an unmount assertion that the subscription is released exactly once for both paginated and non-paginated catalogs.
