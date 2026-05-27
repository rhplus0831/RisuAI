# Phase 9 - Scalar Trigger / Scripting / UI Projection Writes

Date: 2026-05-27

Status: closed.

## Finding

The 2026-05-27 Phases 0-9 audit found reachable server-backed direct
`DBState.db` mutations that bypass commands and throw under the read-only
projection guard. The scalar character / persona writes plus two
client-only UI writes are closed here; the remaining trigger collection /
chat writes are tracked in
[`phase-9-trigger-projection-writes.md`](phase-9-trigger-projection-writes.md).

## Closeout

Routed each durable write through the command-dispatching helpers
(`setCharacterByIndex` -> `dispatchUpdateCharacter`; `saveUserPersona` ->
`updatePersonaCommand`), which wrap writes in
`withTrustedServerProjectionWrite` and emit a typed command in
server-backed mode while the now-removed local/Tauri paths remained
historical no-port behavior.

Sites closed:

- `src/ts/process/scriptings.ts`: `setName`, `setDescription`,
  `setCharacterFirstMessage`, `setBackgroundEmbedding` now snapshot the
  character, mutate, and call `setCharacterByIndex`.
- `src/ts/process/triggers.ts` `v2SetPersonaDesc`: sets `personaPrompt`
  inside a trusted write, then calls `saveUserPersona()` to mirror the
  persona record and dispatch `updatePersonaCommand`.
- `src/ts/process/triggers.ts` `v2SetCharacterDesc` and
  `v2SetReplaceGlobalNote`: removed the redundant live-projection write
  that ran before the existing `setCurrentCharacter(char)`; the helper
  already persists the scalar field (no local-mode behavior change).
- `src/lib/UI/Realm/RealmFrame.svelte`: post-upload `realmId` write routed
  through `setCharacterByIndex`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte`: creator-quote dismiss
  (`removedQuotes`) routed through `setCharacterByIndex`.

These scalar fields are not in `CHARACTER_PATCH_EXCLUDED_KEYS`, so the
character command persists them; the lorebook (`globalLore`) and
author-note (`chats`) trigger effects are excluded and remain open in the
linked follow-up.

## Regression test

`src/ts/process/__tests__/triggers.projectionGuard.test.ts` drives the
real `runTrigger` under the enabled guard and asserts a raw `DBState.db`
write throws while `v2SetCharacterDesc` and `v2SetPersonaDesc` route to
`PATCH /api/v1/commands/characters/:id` and `.../personas/:id`.

## Verification

- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 70 files, 749 passed, 4 skipped.
- `pnpm build`: passed with nonblocking build warnings.

(`pnpm api:test` unaffected; changes are client-only.)
