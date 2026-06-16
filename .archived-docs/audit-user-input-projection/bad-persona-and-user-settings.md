# Persona And User Settings Audit

Status: bad

Scope audited:

- `src/lib/Setting/Pages/PersonaSettings.svelte`
- `src/lib/Setting/Pages/UserSettings.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/ts/persona.ts`
- `src/ts/server/commands.ts`
- `server/fastify/src/commands/personas.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/projection.ts`
- persona usage in server prompt assembly and client persona display helpers

## Findings

### P1: Persona text edits can race server-assembled sends and prompt previews

`PersonaSettings` user-input fields write through `updateSelectedPersonaField` for name, note, and persona prompt (`src/lib/Setting/Pages/PersonaSettings.svelte:175`, `src/lib/Setting/Pages/PersonaSettings.svelte:182`, `src/lib/Setting/Pages/PersonaSettings.svelte:189`). The component watcher detects those changes and calls `queueSelectedPersonaUpdate` (`src/lib/Setting/Pages/PersonaSettings.svelte:41`-`64`), but the command is delayed by a 250 ms debounce (`src/ts/persona.ts:271`-`296`).

During that delay, `updateSelectedPersonaField` has only updated the browser projection's legacy live scalar (`DBState.db.username`, `DBState.db.userNote`, or `DBState.db.personaPrompt`) (`src/ts/persona.ts:299`-`303`). The server database is still stale until the delayed `PATCH /api/v1/commands/personas/:personaId` lands.

That matters because normal Fastify chat sending is server-assembled. The browser routes server-backed generation through `/api/v1/generate/chat` (`src/ts/process/serverBackedSendChat.ts:212`-`215`), and the Fastify route assembles from persisted server state (`server/fastify/src/routes/generationChat.ts:2046`-`2058`, `server/fastify/src/routes/generationChat.ts:2084`-`2096`). Assembly reads `ctx.database.personaPrompt` (`server/fastify/src/prompt/staticSections.ts:67`-`70`). A user who edits persona prompt text and immediately sends or previews a prompt can therefore get a generation assembled with the previous saved persona prompt.

Likely impact:

- Immediate send/continue/regenerate or prompt preview after editing persona text may omit the latest persona edits.
- The same race can affect `username` and `userNote` where server-side variable expansion or metadata reads persisted legacy profile fields.
- The save eventually includes the edited values, but generation can already have used stale persisted values.

### P2: Text-field optimistic updates do not update the persona collection row

The selected persona text fields update only legacy live fields (`src/ts/persona.ts:299`-`303`). They do not immediately mirror the edited values into `DBState.db.personas[DBState.db.selectedPersona]`. The collection row is only updated later by server projection or explicit save/switch paths such as `saveUserPersona` (`src/ts/persona.ts:423`-`447`).

This leaves collection-backed UI and helpers stale after local typing:

- `listedPersona` renders names and notes from `DBState.db.personas` (`src/lib/Setting/listedPersona.svelte:69`-`87`), so quick persona lists can show old values until the server command/projection catches up.
- Bound chat persona helpers read from `db.personas.find(...)` (`src/ts/util.ts:67`-`81`) and then return that row's `name`, `icon`, and `personaPrompt` (`src/ts/util.ts:87`-`111`). If the edited persona is also selected as an active-chat persona, bound-chat display/prompt helpers can remain stale until the collection row is refreshed.

By contrast, image selection does optimistically update both the legacy scalar and selected persona row (`src/ts/persona.ts:388`-`420`), and `largePortrait` directly updates the selected row (`src/ts/persona.ts:305`-`311`). The inconsistency is specific to text fields.

## Positive Coverage

- Persona command wrappers send stable IDs and include `mirrorLegacyProfile` / `saveCurrent` controls for create, patch, delete, select, and reorder (`src/ts/server/commands.ts:1631`-`1705`).
- Server persona commands validate string fields, booleans, IDs, JSON serializability, and optional asset refs (`server/fastify/src/commands/personas.ts:58`-`79`, `server/fastify/src/commands/personas.ts:164`-`179`).
- Server patch/select/delete paths persist edited values into the persona table and mirror selected legacy profile fields when requested (`server/fastify/src/routes/commands.ts:2627`-`2666`, `server/fastify/src/routes/commands.ts:2679`-`2745`, `server/fastify/src/routes/commands.ts:2758`-`2800`).
- Targeted persona projection refresh includes `personas`, `selectedPersona`, `username`, `userIcon`, `personaPrompt`, and `userNote`, so cross-client/reconnect sync has the needed fields (`server/fastify/src/routes/projection.ts:75`-`77`).
- `listedPersona` active-chat mode saves the persona ID to chat generation settings instead of changing the global persona (`src/lib/Setting/listedPersona.svelte:32`-`44`).
- `UserSettings.svelte` is not a persona/user profile editor in this tree; it only exposes backup/restore/export/cold-storage actions (`src/lib/Setting/Pages/UserSettings.svelte:80`-`155`).

## Verification

- Passed: `pnpm exec vitest run src/ts/persona.test.ts src/ts/server/commands.test.ts`
- Passed: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts -t "persona commands"`
- Initial root-config server test attempt failed because the root Vitest config excludes `server/**`; rerun with `server/fastify/vitest.config.ts` passed.
