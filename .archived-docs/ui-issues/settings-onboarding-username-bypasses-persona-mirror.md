# Onboarding username bypasses the selected persona profile

## Summary

First-run onboarding saves the entered name as the legacy `username` settings
scalar only. A fresh Fastify database already contains a selected
`default-persona` row whose name was initialized to `User`. Onboarding never
updates that row through the persona command's mirror-aware path.

After entering a name such as Ada, chat/onboarding and the selected-persona name
input read `username = "Ada"`, while persona lists and pickers read the selected
row and show `personas[0].name = "User"`. The server architecture otherwise
treats the selected persona row and the four legacy profile scalars as a mirrored
projection.

## Location

- `src/lib/Others/WelcomeRisu.svelte:142-149` advances from the name step after
  calling `applyServerBackedSetting("username", input)`.
- `src/ts/server/settingsGroups.ts:333` maps `username` to the `account` settings
  group.
- `src/ts/server/settingsBridge.svelte.ts:192-193,643-652` optimistically updates
  and dispatches only that settings field.
- `server/fastify/src/databaseDefaults.ts:677-704` creates/selects
  `default-persona`, using the then-current default username (`User`) as its row
  name.
- `server/fastify/src/routes/commands.ts:2008-2071` persists the account setting
  without touching the persona collection.
- `src/lib/Setting/Pages/PersonaSettings.svelte:159-167` identifies persona rows
  from `persona.name`, while `src/lib/Setting/Pages/PersonaSettings.svelte:236-249`
  renders the selected profile name from `getDatabase().username`.
- `src/lib/Setting/listedPersona.svelte:131-151` displays picker rows from the
  persona collection's name/display name.
- `server/fastify/src/prompt/effectiveGenerationConfig.ts:77-150` resolves a
  chat-scoped `personaId` to the collection row and mirrors that row into the
  effective generation database.
- `src/ts/persona.ts:1879-1904` and
  `server/fastify/src/commands/personas.ts:180-198` define the intended row/legacy
  profile mirroring.
- `server/fastify/src/routes/commands.ts:4235-4283` updates a persona row and,
  when requested for the selected persona, writes the mirrored legacy settings
  in the same mutation.

## Trigger

1. Start with a fresh server database and enter onboarding before first setup.
2. Enter any username other than `User`, for example `Ada`.
3. Complete onboarding successfully.
4. Open Persona Settings or the persona picker used by the global/chat
   generation settings.

No failed request is required; the inconsistent state is the result of the
successful command path.

## Expected behavior

Changing the active user's name during onboarding should update the selected
persona row and its legacy projection atomically. Every consumer of the active
persona should display Ada, and selecting that persona should preserve the same
identity.

## Actual behavior

The `username` setting becomes Ada, but the selected `default-persona` remains
named User. Components disagree depending on which side of the profile they
read:

- chat messages and the Persona Settings name input use Ada;
- persona-picker rows, row labels, and chat-scoped persona references use the
  selected persona record, which is still User.

If a chat's generation settings reference that persona ID, Fastify resolves the
collection row and calls `mirrorLegacyProfile()` on the effective generation
database. Prompt assembly therefore uses User even while legacy/global UI fields
show Ada.

Subsequent persona operations may incidentally repair the row by saving the
legacy profile before switching, or may mirror a row back into the legacy
fields. Until such an operation occurs, the durable database itself contains
two versions of the active identity, so behavior depends on the next code path.

## Underlying cause

The migration introduced separate mutation ownership for settings scalars and
persona collection rows. Ordinary persona editing uses a persona PATCH with
`mirrorLegacyProfile`, allowing Fastify to co-write the collection row and
settings record. Welcome onboarding kept the old frontend-era assumption that
assigning `Database.username` was sufficient and now routes that assignment
through the generic account settings bridge.

The account settings command has no knowledge of persona identity and correctly
writes only settings. No post-write reconciliation copies `username` into the
selected persona row.

## Affected data flow

1. **UI interaction:** `WelcomeRisu.send()` accepts the entered name and advances
   immediately to provider selection.
2. **Client projection:** `applyServerBackedSetting()` changes the database-shaped
   resource projection's `username` field to Ada.
3. **Request:** The settings bridge sends
   `PATCH /api/v1/commands/settings/account` with `{ username: "Ada" }`.
4. **Server persistence:** Fastify applies the settings patch and calls
   `writeSettingsOnly()`. The `personas` collection table is not part of this
   mutation, so `default-persona.name` remains User.
5. **Acknowledgement:** The response acknowledges `username` and emits a settings
   update; the client keeps Ada in its legacy settings projection.
6. **Displayed state:** Legacy-profile consumers read Ada. Collection-backed
   persona list/picker consumers read User. No shared resource reconciliation can
   choose one without an explicit mirror operation because both values are
   authoritatively persisted.
7. **Generation projection:** For a chat configured with the default persona ID,
   `buildEffectiveGenerationConfig()` resolves the stale row and mirrors its
   name/profile into the request-scoped database, so server prompt generation
   uses User rather than the onboarding name.

## Severity and likely user impact

**High.** This is deterministic for every fresh user who chooses a non-default
name and produces different versions of the same identity across settings and
generation UI. It can also cause later apparent reversion when a persona mirror
operation makes one side overwrite the other, and can put the wrong name into
chat-scoped persona selection and server prompt generation.

## Recommended fix

Do not persist the onboarding name through the generic account field alone.
Use one of these ownership-correct approaches:

1. Add a dedicated onboarding server command that updates the selected persona
   row and mirrors `username`, `userIcon`, `personaPrompt`, and `userNote` in the
   same SQLite transaction; or
2. Resolve the selected persona ID and call the existing persona update command
   with `{ name }` and `mirrorLegacyProfile: true`, awaiting its exact outcome
   before advancing.

The first option is preferable if onboarding is also made atomic with its other
first-run values. Avoid a follow-up best-effort persona PATCH after the account
PATCH, because failure between them recreates the same split state.

## Test gap

Seed the real fresh-database defaults, complete onboarding with `Ada`, and assert
both `username` and the selected persona row name equal Ada in the client
projection and SQLite. Mount both `PersonaSettings.svelte` and
`listedPersona.svelte` to verify their labels agree. Build an effective
generation config referencing that persona ID and assert its mirrored username
is Ada. Add a command-failure test that proves neither side advances alone.
