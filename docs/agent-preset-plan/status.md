# Agent Preset Status

Date: 2026-07-06

This workstream is complete. It expanded the original Agent Preset Q&A into an
implementation plan and delivered the durable schema, resolver/planner,
command/projection surfaces, Settings/chat-selection UI, step editor,
prepared-input execution, generation guardrails, and Phase 6 cleanup.

## Snapshot

- Plan state: Phase 6 implemented and verified.
- Current phase: Complete.
- Current implementation state:
  - `Database.agentPresets` and `Database.agentPresetDefaultId` normalize
    through server and client database default paths.
  - Shared Agent Preset record, step, normalizer, and validation helpers live in
    `src/ts/agentPresetRecords.ts`.
  - Shared Agent Preset resolver, DAG planner, prepared-input planner, model
    readiness adapter, and UI status helpers live in
    `src/ts/agentPresetResolver.ts`.
  - Chat generation settings carry optional `agentPresetId`; empty selection is
    valid, while non-empty unknown selections surface as errors when the preset
    collection is available.
  - Agent Presets can be created, updated, duplicated, deleted, reordered,
    selected as the global default, and edited at the step level through
    revision-checked Fastify command routes.
  - Agent Preset command events project normal preset/default edits through
    `agentPreset`, while delete cleanup projects through `agentPresetDeleted`
    because it can clear chat and loadout references.
  - Settings routes `/settings/agent-presets` to the Agent Presets authoring UI.
    The old `/settings/context-agent` and `/settings/contextagent` slugs now
    resolve to `not-found` instead of an alias.
  - The Settings navigation shows Agent Presets, and the legacy Context Agent
    page/data-driven settings files are deleted.
  - The Agent Presets shell and editor can create, edit metadata, enable/disable,
    duplicate, delete, reorder, set a global default, create/edit steps, and
    configure dependencies, model selection, output keys/formats/destinations,
    failure policies, runtime bounds, and prepared-input scopes.
  - Server-side Agent Preset execution can build single-step prompts, resolve
    inherit-main or selected model-profile execution, call the provider dispatch
    boundary with streaming disabled and tools omitted, enforce timeout/output
    bounds, parse JSON-object output, and return diagnostics/failure shapes.
  - Before-main steps run after submit transforms and before static/plain slot
    filling; prompt variable expansion supports `{{agent::name}}` from named
    before-main prompt outputs.
  - After-main steps run after `editOutput` and before assistant-row
    persistence, run-vars, and `onOutput`; the last valid final-output modifier
    can replace the assistant text.
  - Generation metadata stores hidden Agent Preset diagnostics under
    `generationInfo.agentPreset`, and required after-main failures surface a
    structured `postGeneration.agentPresetError`.
  - Chat generation settings show an Agent Preset selector alongside model
    preset, prompt preset, and persona.
  - Legacy bot presets and loadouts can save/apply Agent Preset fields through
    existing preset/loadout flows.
  - The legacy Context Agent runtime, Settings page, data-driven settings group,
    language keys, CBS `{{agent}}` entry, defaults, command allowlists, and old
    runtime tests are removed.
  - Optional `agentContext*` fields remain only in database/bot-preset TypeScript
    shapes so old saves can be imported and preserved as inert compatibility
    data. They are not defaulted, command-patchable, visible, or executable.
- Current verification state: Phase 6 closeout tests, full server/frontend
  Vitest suites, strict Fastify TypeScript, client TypeScript, Prettier check,
  `git diff --check`, and browser smoke passing. See
  `latest-verification.md`.

## Phase Router

| Phase                                  | Status   | Purpose                                                                                    |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Phase 0: Contract And Schema           | Complete | Add Agent Preset record types, step schema, chat selection, defaults, and validation.      |
| Phase 1: Resolver Runtime Status       | Complete | Add resolver/planner, DAG validation, prepared-input planning, and status helpers.         |
| Phase 2: Agent Preset Commands And Context Cleanup | Complete | Add command/projection surfaces and explicit Context Agent no-migration cleanup. |
| Phase 3: Settings Agent Preset Shell   | Complete | Build Settings and chat-selection shells for Agent Presets.                                |
| Phase 4: Step Editor And Prepared Inputs | Complete | Implement the step editor and prepared-input provider execution support.                   |
| Phase 5: Generation Guardrails         | Complete | Integrate before-main/after-main execution, prompt syntax, diagnostics, and failure behavior. |
| Phase 6: Verification And Cleanup      | Complete | Remove legacy Context Agent surfaces, update docs, and run closeout verification.          |

## Current Blockers

- None.

## Latest Completed Slice

- Implemented Phase 6 cleanup: deleted the old Context Agent runtime/settings
  surfaces, removed visible language/CBS/settings-command surfaces, made the
  retired settings route a `not-found`, updated active structure/workstream
  docs, preserved inert old-save `agentContext*` compatibility fields, and ran
  closeout verification.

## Compatibility Caveats

- The first Agent Preset release intentionally does not migrate Context Agent
  settings into Agent Presets.
- Imported old saves may still carry `agentContextEnabled`,
  `agentContextPrompt`, `agentContextMaxOutput`, and
  `agentContextMaxToolRounds`; those fields are inert compatibility data only.
- `{{agent}}` and `{{slot::agent}}` are removed legacy placeholders, not Agent
  Preset aliases. Use `{{agent::name}}`.
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
