# Phase 0: Contract And Schema

## Objective

Add the durable Agent Preset data contract without changing live generation
behavior yet.

## Scope

- Define Agent Preset and Agent Preset step records.
- Add database defaults and normalization.
- Extend chat generation settings with optional Agent Preset selection.
- Extend loadout snapshots with optional Agent Preset selection.
- Add validation helpers shared by commands, resolver, and UI.
- Keep Context Agent runtime and UI untouched in this phase.

## Data Changes

Add frontend/server-shared types near the existing database and preset model
types:

- `AgentPresetRecord`
- `AgentPresetStepRecord`
- `AgentPresetStepPhase`
- `AgentPresetStepOutputFormat`
- `AgentPresetStepFailurePolicy`
- `AgentPresetStepInputScope`
- `AgentPresetStepDestination`
- `AgentPresetStepModelSelection`
- `AgentPresetStepRuntimeOptions`

Recommended storage:

- `Database.agentPresets: AgentPresetRecord[]`
- `Database.agentPresetDefaultId?: string`
- `ChatGenerationSettings.agentPresetId?: string`
- `Loadout.agentPresetId?: string`
- `Loadout.agentPresetName?: string`

## Record Requirements

Agent Preset:

- stable opaque id, preferably `ap_` prefixed
- name
- optional description
- enabled state
- schema version
- optional max concurrency
- ordered steps

Agent step:

- stable opaque id, preferably `aps_` prefixed
- name
- enabled state
- phase: `beforeMain` or `afterMain`
- dependencies
- instruction
- model selection: inherit main or model profile id
- runtime options: temperature, max input chars, max output chars, timeout ms
- input scopes
- output key
- output format: text or JSON object
- destination
- failure policy

## Validation Rules

Add pure helpers that can be used without Svelte stores:

- normalize missing `agentPresets` to `[]`.
- normalize absent `agentPresetDefaultId` to no default.
- clear or flag `agentPresetDefaultId` when it points to a missing preset.
- validate output keys with a conservative identifier pattern.
- validate phase values.
- validate output format values.
- validate dependency ids and cycle freedom.
- validate timeout, max input, max output, and max concurrency bounds.
- validate that only one enabled after-main step can directly modify output,
  and it is the last enabled direct modifier in stable order.
- validate that before-main steps do not depend on after-main steps.

## Chat Generation Settings

Extend `src/ts/chatGenerationSettings.ts`:

- Add optional `agentPresetId` to `ChatGenerationSettings`.
- Add missing/error reason types only for non-empty invalid selections.
- No `agentPresetId` should not make settings incomplete.
- A non-empty unknown `agentPresetId` should be reported clearly once the
  resolver/command validation has the `agentPresets` collection.

Update server validation in `server/fastify/src/commands/chats.ts`:

- Accept `generationSettings.agentPresetId`.
- Validate it as a string when present.
- Reject unknown non-empty ids.
- Preserve empty string or omitted value as "no Agent Preset".

## Loadout Contract

Extend:

- `src/ts/loadout.ts`
- `server/fastify/src/commands/loadouts.ts`
- `src/ts/server/commands.ts`

Loadouts should save:

- selected Agent Preset id
- selected Agent Preset name for human-readable fallback

Applying a loadout should:

- select the matching Agent Preset by id when present.
- optionally fall back by name only if that is already consistent with the
  loadout split-preset pattern.
- clear the selection when the loadout explicitly records no Agent Preset.

## Defaults And Normalization Anchors

Update:

- `server/fastify/src/databaseDefaults.ts`
- `src/ts/storage/database.svelte.ts`
- import/export or preset snapshot paths that preserve database-level settings

Do not add a default Agent Preset. Empty arrays are the default.

## Tests

Add focused tests for:

- default database contains `agentPresets: []`.
- no selected Agent Preset keeps chat generation settings ready.
- unknown non-empty `agentPresetId` is rejected by command validation.
- valid `agentPresetId` is accepted.
- output key validation.
- dependency validation and cycle detection.
- after-main direct-modifier validation.
- loadout save/apply preserves Agent Preset id/name.

## Exit Criteria

- Types, defaults, and validators exist.
- Empty Agent Preset state is valid.
- Chat generation settings and loadouts can carry Agent Preset selection.
- Context Agent behavior remains unchanged until later phases.
- Focused tests pass and status is updated.
