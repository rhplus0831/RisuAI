# Phase 5: Lorebooks Stub

Date: 2026-05-30

Status: PLANNED. Needs Phase 2; shares the `lorebookBridge` rework with Phase 4.

## Goal

Stop sending lorebook bodies the client does not currently need: stub character
`globalLore` and module `lorebook`; hydrate on character-open / module-open. Keep
**enabled** modules' lorebook (and regex) resident.

The bodies stay in the single `db.json` (loaded in server memory); "stub" means
**omit from the projection** and serve on hydration from memory.

Stub/hydration model: [`../reference/stub-hydration.md`](../reference/stub-hydration.md).

## Why enabled modules stay resident

`getModuleLorebooks()` / `getModuleRegexScripts()` iterate `db.enabledModules`
(`src/ts/process/modules.ts:418,440,487`) during client-side message rendering /
CBS. Rendering is synchronous and cannot await hydration, so an enabled module's
display parts must be present. Disabled modules are fully stubbed.

## The real work: `lorebookBridge`

`src/ts/server/lorebookBridge.svelte.ts` is **live** and walks all characters'
`globalLore` + all chats' `localLore` + all modules' `lorebook`:
- entry-id assignment (`:89-97`),
- a snapshot/diff map (`:371-379`),
- find-chat-by-id across all characters (`:421-424`).

Unlike the dead asset GC (Phase 1), this runs. Stubbing lorebooks breaks it unless
it is reworked to operate per-entity on hydration. This rework — not the projection
change — is the bulk of the phase.

## Changes

- Bootstrap projection omits `globalLore` for non-open characters and `lorebook`
  for disabled modules (resident: enabled modules).
- Hydrate `globalLore` on character-open and module `lorebook` on module-open via
  the Phase 2 targeted-fetch primitive.
- Rework `lorebookBridge` character/module loops to per-entity-on-hydration.
- Verify the CBS `{{lorebook}}` matcher (`src/ts/cbs.ts:353`, reads
  `achara.globalLore` for a possibly-passed character) only ever hits a hydrated
  character — group chat is removed, so this is almost always the selected char,
  but confirm there is no live path passing a non-hydrated one.

## Seams

- `server/fastify/src/routes/bootstrap.ts` (projection), the in-memory `Database`
  (hydration source).
- `src/ts/server/lorebookBridge.svelte.ts`, `src/ts/cbs.ts`,
  `src/ts/process/modules.ts`.

## Risks / landmines

- `lorebookBridge` is live; its snapshot/diff map assumed full presence.
- Synchronous render-time cross-entity reads (CBS, enabled-module reads) cannot
  await — the resident set must cover them.

## Exit criteria

- Bootstrap omits lorebook bodies for non-open characters and disabled modules;
  editing and rendering remain correct.
- `lorebookBridge` operates per-entity on hydration with no full-corpus walk.
