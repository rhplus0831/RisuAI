# Phase 1: Asset GC → Server

Date: 2026-05-30

Status: PLANNED. Independent of the other phases; low-risk enabler.

## Goal

Reclaim orphaned content-addressed assets on the server, periodically. Delete the
dead client-side GC. There is currently **no asset GC at all** in Fastify mode.

## Why first

It is independent and cheap, and it retires a "walk all characters to collect
references" hazard before stub-loading lands. The client GC that did this is
**already dead code**: `cleanChunks()` (`src/ts/bootstrap.ts:425`) has no caller,
and its helper `getUncleanables()` (`src/ts/globalApi.svelte.ts:935`) is reachable
only from it (plus a test mock). So this phase is "delete dead code + build the
server GC that does not yet exist," not "unwind live behavior."

## Changes

- Delete `cleanChunks` / `getUncleanables` from the client.
- Add a server GC that walks the in-memory `Database` (all characters/chats/modules)
  to compute the referenced asset set, reference-counts across the whole corpus
  (assets are `sha256`-addressed and shared/deduped), and deletes only at zero
  references.
- Run it periodically (timer and/or startup), not in the request hot path.

## Seams

- `server/fastify/src/repository.ts` — asset storage + the data-dir inventory.
- The in-memory `Database` (the reference source) and the asset reference walker
  already used by command validation.

## Risks / landmines

- **Upload→reference race.** An asset is uploaded slightly before the mutation
  that references it. Use a grace rule ("unreferenced for > N minutes") or an
  epoch so a just-uploaded asset is not swept.
- **Backups.** Backups copy `assets/` into the backup dir, so live GC must not be
  driven by backup contents and must not strand assets a retained backup needs —
  confirm the two are independent.
- **Shared assets.** Reference-count across all owners; never delete on first
  zero-in-one-character.

## Exit criteria

- Orphaned assets are reclaimed server-side on a schedule.
- The client carries no asset-GC code.
- A referenced/just-uploaded asset is never deleted (covered by a test of the
  grace rule).
