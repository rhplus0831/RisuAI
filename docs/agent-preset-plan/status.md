# Agent Preset Status

Date: 2026-07-05

This workstream is open. It expands the original Agent Preset Q&A into an
implementation plan and has completed the durable contract/schema slice, the
pure resolver/planner/status slice, and the command/projection mutation slice.

## Snapshot

- Plan state: Phase 2 implemented.
- Current phase: Phase 3 pending.
- Current implementation state:
  - `Database.agentPresets` and `Database.agentPresetDefaultId` now normalize
    through server and client database default paths.
  - Shared Agent Preset record, step, normalizer, and validation helpers exist
    in `src/ts/agentPresetRecords.ts`.
  - Shared Agent Preset resolver, DAG planner, prepared-input planner, model
    readiness adapter, and UI status summary helpers exist in
    `src/ts/agentPresetResolver.ts`.
  - Chat generation settings can carry optional `agentPresetId`; empty or
    omitted selection remains valid, while non-empty unknown ids are reported
    when the preset collection is available.
  - Agent Preset selection can now resolve to no selected preset, ready preset,
    disabled no-op, missing preset, invalid preset, or model-not-ready preset
    without running provider calls.
  - Enabled steps can be planned into before-main and after-main dependency
    levels with stable merge ordering, named output registry, max concurrency,
    and final-output modifier metadata.
  - Prepared-input scopes now produce deterministic collection plans only;
    actual prepared-input collection and provider execution remain pending.
  - Step model readiness reuses existing model profile resolver semantics for
    inherit-main and explicit model profile selections.
  - Agent Presets can now be created, updated, duplicated, deleted, reordered,
    selected as the global default, and edited at the step level through
    revision-checked Fastify command routes.
  - Agent Preset command events project normal preset/default edits through the
    narrow `agentPreset` resource, while delete cleanup projects through
    `agentPresetDeleted` because it can clear chat and loadout references.
  - Deleting an Agent Preset clears matching `agentPresetDefaultId`,
    `Chat.generationSettings.agentPresetId`, and loadout
    `agentPresetId`/`agentPresetName` references in one revisioned mutation.
  - Browser command wrappers and a small local Agent Preset helper module now
    exist for command-backed Settings/chat UI work.
  - Legacy bot presets and loadouts can save/apply Agent Preset fields through
    existing preset/loadout flows.
  - Context Agent still exists as the live implementation.
  - `agentContextEnabled`, `agentContextPrompt`, `agentContextMaxOutput`, and
    `agentContextMaxToolRounds` still exist in defaults, settings commands,
    frontend database types, language keys, and the Settings UI; no command
    converts them into Agent Presets.
  - `server/fastify/src/prompt/contextAgent.ts` still detects and fills
    `{{agent}}` / `{{slot::agent}}`.
- Current verification state: focused Phase 2 command/projection/client-wrapper
  tests, Phase 1 resolver/planner tests, and strict client/server TypeScript
  checks passing.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Schema | Complete | Add Agent Preset record types, step schema, chat selection, defaults, and validation. |
| Phase 1: Resolver Runtime Status | Complete | Add resolver/planner, DAG validation, prepared-input planning, and status helpers. |
| Phase 2: Agent Preset Commands And Context Cleanup | Complete | Add command/projection surfaces and explicit Context Agent no-migration cleanup. |
| Phase 3: Settings Agent Preset Shell | Pending | Build Settings and chat-selection shells for Agent Presets. |
| Phase 4: Step Editor And Prepared Inputs | Pending | Implement the step editor and prepared-input provider execution support. |
| Phase 5: Generation Guardrails | Pending | Integrate before-main/after-main execution, prompt syntax, diagnostics, and failure behavior. |
| Phase 6: Verification And Cleanup | Pending | Remove legacy Context Agent surfaces, update structure docs, and run closeout verification. |

## Current Blockers

- None for Phase 3 planning.

## Latest Completed Slice

- Implemented Phase 2 Agent Preset command routes, targeted projection
  resources, browser command wrappers/local helpers, delete cleanup, and focused
  command/projection/client-wrapper coverage.

## Compatibility Caveats

- Context Agent remains live until the implementation reaches cleanup.
- The first Agent Preset release intentionally does not migrate Context Agent
  settings.
- `{{agent}}` and `{{slot::agent}}` should be treated as legacy placeholders,
  not future Agent Preset syntax.
- Provider tool-calling from Agent Presets is out of scope for the first
  release.

## Latest Decisions Captured

- Agent Preset selection is chat-scoped.
- New users and existing users start with no selected Agent Preset unless they
  explicitly create or select one.
- Agent outputs are hidden during normal chat but inspectable through
  diagnostics.
- Free-text output is default; JSON object output is supported and invalid JSON
  fails the step.
- Prepared-input execution is the first-release scope.
- After-main output modification runs after `editOutput` and before `onOutput`,
  with only the last after-main modifier allowed to directly change the final
  assistant text.
