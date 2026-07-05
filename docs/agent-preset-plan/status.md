# Agent Preset Status

Date: 2026-07-05

This workstream is open. It expands the original Agent Preset Q&A into an
implementation plan and has completed the durable contract/schema slice, the
pure resolver/planner/status slice, the command/projection mutation slice, and
the visible Settings/chat-selection shell slice.

## Snapshot

- Plan state: Phase 4 implemented.
- Current phase: Phase 5 pending.
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
  - Prepared-input scopes produce deterministic collection plans, and
    server-side Phase 4 helpers can collect bounded prepared-input sections in
    deterministic order for isolated step execution.
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
  - Settings now routes `/settings/agent-presets` to a visible Agent Presets
    shell, while the old `/settings/context-agent` slug remains a temporary
    index-19 alias.
  - The active Settings navigation shows Agent Presets instead of a standalone
    Context Agent page.
  - The Agent Presets shell can create, edit metadata, enable/disable,
    duplicate, delete, reorder, and set a global default through the Phase 2
    command helper layer.
  - The shell shows empty state, usage count, enabled step count, before-main /
    after-main summary, max concurrency, disabled/invalid/model-not-ready
    statuses, and a placeholder diagnostics affordance.
  - The editor drawer has explicit Save/Cancel draft handling for metadata and
    max concurrency, plus command-backed step create, edit, duplicate, delete,
    and reorder controls.
  - The step editor exposes name, enabled state, phase, instruction, model
    selection, dependencies, output key, output format, destination, failure
    policy, fallback text, timeout, max input/output chars, temperature, and
    prepared-input scopes.
  - Server-side Agent Preset execution helpers can build single-step prompts,
    resolve inherit-main or selected model-profile execution, call the existing
    provider dispatch boundary with streaming disabled and tools omitted,
    enforce timeout/max output bounds, parse JSON-object output, and return
    diagnostics/failure shapes.
  - Chat generation settings show an Agent Preset selector alongside model
    preset, prompt preset, and persona. Empty selection is visible and valid,
    missing non-empty selections display an error, and saves go through chat
    generation settings commands.
  - Legacy bot presets and loadouts can save/apply Agent Preset fields through
    existing preset/loadout flows.
  - Context Agent still exists as the live implementation.
  - `agentContextEnabled`, `agentContextPrompt`, `agentContextMaxOutput`, and
    `agentContextMaxToolRounds` still exist in defaults, settings commands,
    frontend database types, language keys, and the Settings UI; no command
    converts them into Agent Presets.
  - `server/fastify/src/prompt/contextAgent.ts` still detects and fills
    `{{agent}}` / `{{slot::agent}}`.
- Current verification state: focused Phase 3 Settings/chat-selection UI tests
  and client TypeScript checks passing.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Schema | Complete | Add Agent Preset record types, step schema, chat selection, defaults, and validation. |
| Phase 1: Resolver Runtime Status | Complete | Add resolver/planner, DAG validation, prepared-input planning, and status helpers. |
| Phase 2: Agent Preset Commands And Context Cleanup | Complete | Add command/projection surfaces and explicit Context Agent no-migration cleanup. |
| Phase 3: Settings Agent Preset Shell | Complete | Build Settings and chat-selection shells for Agent Presets. |
| Phase 4: Step Editor And Prepared Inputs | Complete | Implement the step editor and prepared-input provider execution support. |
| Phase 5: Generation Guardrails | Pending | Integrate before-main/after-main execution, prompt syntax, diagnostics, and failure behavior. |
| Phase 6: Verification And Cleanup | Pending | Remove legacy Context Agent surfaces, update structure docs, and run closeout verification. |

## Current Blockers

- None for Phase 4 planning.

## Latest Completed Slice

- Implemented Phase 4 step editor and isolated execution helpers: full
  command-backed step authoring UI, prepared-input collectors, single-step
  prompt builder, model-profile resolution, non-streaming provider execution
  wrapper, output bounding, JSON parsing, diagnostics, and focused UI/server
  coverage.

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
