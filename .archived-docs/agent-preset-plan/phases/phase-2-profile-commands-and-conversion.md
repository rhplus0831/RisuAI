# Phase 2: Agent Preset Commands And Context Cleanup

## Objective

Add command, projection, and client mutation surfaces for Agent Presets. The file
name mirrors the archived skeleton; there is no Context Agent migration or
conversion in this phase.

## Scope

- Add row-oriented Agent Preset commands.
- Add step-level command helpers or preset-patch commands with server-side
  validation.
- Add client command wrappers.
- Add projection/event resource handling.
- Extend chat generation settings save commands with `agentPresetId`.
- Extend loadout commands with Agent Preset id/name.
- Keep legacy Context Agent fields in place until final cleanup, but stop
  treating them as the future editing surface.

## Server Commands

Add a command module, likely:

- `server/fastify/src/commands/agentPresets.ts`

Commands:

- create Agent Preset
- update Agent Preset metadata
- duplicate Agent Preset
- delete Agent Preset
- reorder Agent Presets
- update preset enabled state
- update preset max concurrency
- create step
- update step
- duplicate step
- delete step
- reorder step
- set global default Agent Preset

Deletion rules:

- Deleting a preset clears `agentPresetDefaultId` when it points to that preset.
- Deleting a preset clears matching `Chat.generationSettings.agentPresetId`
  references in a single revisioned mutation or records a required follow-up
  command if full cleanup is too broad for one command.
- Deleting a preset clears or updates matching loadout references if loadouts
  are kept strongly referential.

## Routes

Extend `server/fastify/src/routes/commands.ts` with authenticated, active-writer
protected endpoints.

Suggested routes:

- `POST /api/v1/commands/agent-presets`
- `PATCH /api/v1/commands/agent-presets/:presetId`
- `DELETE /api/v1/commands/agent-presets/:presetId`
- `POST /api/v1/commands/agent-presets/:presetId/duplicate`
- `POST /api/v1/commands/agent-presets/reorder`
- `POST /api/v1/commands/agent-presets/default`
- `POST /api/v1/commands/agent-presets/:presetId/steps`
- `PATCH /api/v1/commands/agent-presets/:presetId/steps/:stepId`
- `DELETE /api/v1/commands/agent-presets/:presetId/steps/:stepId`
- `POST /api/v1/commands/agent-presets/:presetId/steps/:stepId/duplicate`
- `POST /api/v1/commands/agent-presets/:presetId/steps/reorder`

Every route needs a `routeManifest.ts` decision if the manifest covers command
routes at that granularity.

## Client Wrappers

Extend `src/ts/server/commands.ts` with typed wrappers and optimistic rollback
helpers as needed.

Likely helper module:

- `src/ts/agentPresets.ts`

It should own:

- local create/update/delete helpers
- optimistic list edits
- rollback entries
- command dispatch
- selector helpers for active chat generation settings

## Projection And Events

Add an `agentPreset` command event resource if targeted refresh is useful.

Projection should provide:

- database-level `agentPresets`
- `agentPresetDefaultId`
- chat generation settings carrying `agentPresetId`
- loadouts carrying `agentPresetId` / `agentPresetName`

Hydration should not require prompt-template-style body routes unless preset
steps become large enough to strip from bootstrap. First implementation can keep
bounded step records in normal projection.

## Context Agent No-Migration Rule

Do not create conversion commands from:

- `agentContextEnabled`
- `agentContextPrompt`
- `agentContextMaxOutput`
- `agentContextMaxToolRounds`

During this phase, leave old fields available so current runtime tests keep
passing. Remove or hide them in Phase 6 after Agent Preset runtime integration
is complete.

## Tests

Add focused tests for:

- create/update/delete Agent Preset commands.
- duplicate preserves step shape but creates new preset and step ids.
- step create/update/delete/reorder validation.
- deleting a preset clears default selection.
- deleting a selected preset clears or rejects affected chat/loadout references
  according to the chosen command contract.
- `saveChatGenerationSettings` accepts valid `agentPresetId`.
- command wrappers send expected payloads and roll back local optimistic edits.
- projection refresh includes Agent Preset changes.
- Context Agent fields are not converted into Agent Presets.

## Exit Criteria

- Agent Presets can be mutated through command-backed APIs.
- Chat and loadout selection can persist through commands.
- No migration from Context Agent exists.
- Focused command/projection/client-wrapper tests pass and status is updated.
