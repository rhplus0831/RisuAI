# Saving a loadout conflates queued persistence with server acceptance

- **Severity:** Medium
- **Affected surface:** `MODAL-09` (Loadout modal)
- **Primary locations:** `src/lib/Others/LoadoutModal.svelte:102-121`; `src/ts/loadout.ts:1279-1319,2370-2378`

## Trigger

1. Enter a name and save the current state as a loadout.
2. The create command cannot reach Fastify or otherwise receives a retryable result, so the durable outbox retains the optimistic loadout projection.

## Expected behavior

The save action should distinguish a server-accepted create from a locally durable queued create, just as apply, favorite, and delete already do in the same modal. A queued save should remain visible but be labelled/notified as queued; a terminal failure should retain the entered name and show an error.

## Actual behavior

`saveCurrentLoadout` returns the new `Loadout` object for three different cases: no server command layer, an `ok` response, **or any non-OK response whose durable projection fence is still owned** (`src/ts/loadout.ts:2370-2378`). That last case is queued, not server-persisted.

The modal reduces the return value to truthy/falsy. A truthy result clears the name and exits the pending state without a queued notification (`src/lib/Others/LoadoutModal.svelte:102-121`). The optimistic row remains in every loadout list, so the UI presents the same completion state for accepted and queued saves.

This loses information that the command layer already computes. Favorite and delete use `settleLoadoutMutation` to return `accepted`, `queued`, `superseded`, or `failed` (`src/ts/loadout.ts:1397-1459`), and the modal explicitly reports their queued states (`src/lib/Others/LoadoutModal.svelte:123-171`). Apply likewise distinguishes `applied` from `queued` (`src/lib/Others/LoadoutModal.svelte:80-100`).

## Underlying cause

The create path predates the typed `LoadoutMutationStatus` used by the other loadout actions. It exposes `Loadout | null`, and treats ownership of a retained optimistic projection as equivalent to an accepted server response. The component cannot recover the discarded transport/disposition information.

## Affected data flow

1. `saveLoadout` captures the input name and calls `saveCurrentLoadout`.
2. `saveCurrentLoadout` builds the loadout, pushes it into the client `loadouts` collection optimistically, and captures the collection projection epoch (`src/ts/loadout.ts:2370-2377`).
3. `dispatchCreateLoadout` stages `POST /loadouts` in the durable mutation outbox and sends the revisioned create command (`src/ts/loadout.ts:1279-1309`).
4. Fastify validates uniqueness, appends the loadout, persists the collection, and returns a revision plus `loadout.created` event when accepted (`server/fastify/src/routes/commands.ts:4767-4804`).
5. For a non-OK result, the client reapplies the optimistic row if the retained projection fence is current, then returns `{ result, projectionOwned }` (`src/ts/loadout.ts:1310-1319`).
6. `saveCurrentLoadout` collapses `projectionOwned` into a successful object result. The modal clears `saveName`, while its rendered lists read the optimistic collection through `getResourceDatabase()` (`src/lib/Others/LoadoutModal.svelte:3,52-77,110-113`).

## User impact

Users are told implicitly that a loadout was saved even though it exists only in the local durable queue at that moment. Another client cannot read that loadout from Fastify until replay succeeds, despite the first client presenting it as complete. Save behavior is also inconsistent with the explicit queued messaging for the other actions in the same modal.

## Recommended fix

- Return a typed create result, for example `{ status: LoadoutMutationStatus, loadout }`, using the same settlement helper as favorite/delete.
- In the modal, clear the name for `accepted` and durably `queued` outcomes, but show a localized queued notice for the latter; preserve the name and display `loadoutSaveFailed` for terminal failure/supersession.
- Keep the optimistic row for a genuinely retained mutation, but mark it pending until a server receipt or later invalidation acknowledges it.
- Add tests that defer/reject the create request and assert distinct accepted, queued, and failed UI states.
