# Agent Preset

Date: 2026-07-05

## Goal

Replace the narrow Context Agent feature with a durable, inspectable Agent
Preset system for auxiliary agent calls around chat generation.

Status: planned. Implementation has not started.

End state:

- `Database.agentPresets` stores reusable Agent Preset records.
- New chats may start with no Agent Preset, or with a user-selected global
  default when one is configured.
- Existing chats can select an Agent Preset through chat-scoped generation
  settings.
- Loadouts can save and restore Agent Preset selection.
- Before-main agent steps run after submit transforms and before static/plain
  prompt slot filling.
- Prompt templates can reference named before-main outputs with
  `{{agent::name}}`.
- After-main agent steps run after the existing `editOutput` pass and before
  the existing Lua `onOutput` trigger.
- Only the last enabled after-main step in the chain may directly modify the
  assistant output.
- Agent step outputs and diagnostics are hidden during normal chat but remain
  inspectable from generation metadata or a diagnostics panel.
- Context Agent settings, standalone navigation, `{{agent}}`, and
  `{{slot::agent}}` are removed rather than migrated.

## Locked Product Contract

These decisions are treated as locked unless `status.md` records a deliberate
change.

- Selection is chat-scoped through `Chat.generationSettings.agentPresetId`.
  A global default may initialize new chats, and loadouts should eventually save
  and restore the selected Agent Preset.
- The first release supports prepared-input agent steps, not provider
  tool-calling.
- Prompt-only steps are a prepared-input subset with no selected scopes.
- Each step chooses its output key. Prompt templates reference before-main
  outputs with `{{agent::name}}`, where `name` is the step output key.
- Existing `{{agent}}` and `{{slot::agent}}` syntax is not carried forward as a
  compatibility alias.
- Context Agent migration is dropped. Do not create migrated Agent Presets or a
  disabled default preset for every user.
- Agent outputs are hidden in the normal chat transcript.
- Step output format is selectable per step. Free text is the default; JSON
  object output is supported and invalid JSON is a step failure.
- Each step can configure max input, max output, timeout, and failure policy.
- Presets may optionally configure max concurrency. Dependency order is always
  enforced.
- After-main output modification in the first release runs after `editOutput`
  and before `onOutput`. If an output-modification chain fails in the middle,
  generation stops at that point while preserving the original main output text
  for future restart-from-agent work.

## Historical Starting Problem Shape

The current Context Agent is a single global read-only helper:

- `server/fastify/src/prompt/contextAgent.ts` detects `{{agent}}` or
  `{{slot::agent}}` through a regex over prompt-related fields.
- `runContextAgentStage()` in `server/fastify/src/prompt/assemble.ts` runs the
  agent before static/plain slot filling and injects text into `ctx.slot.agent`.
- Settings live as flat global fields:
  - `agentContextEnabled`
  - `agentContextPrompt`
  - `agentContextMaxOutput`
  - `agentContextMaxToolRounds`
- The visible UI is `src/lib/Setting/Pages/ContextAgentSettings.svelte`, backed
  by `src/ts/setting/contextAgentSettingsData.ts`.
- The feature only works with the current main model/profile route and a small
  tool-calling path for OpenAI-compatible and Ollama-style providers.
- There is no durable preset resource, no chat-scoped selection, no named
  outputs, no multi-step graph, no after-main phase, and no inspectable
  per-step result history.

## Target Data Contract

### Database Fields

Add durable fields:

- `agentPresets: AgentPresetRecord[]`
- `agentPresetDefaultId?: string`

Extend chat generation settings:

- `ChatGenerationSettings.agentPresetId?: string`

Extend loadouts:

- `Loadout.agentPresetId?: string`
- `Loadout.agentPresetName?: string`

No Agent Preset should be created automatically for existing users. Empty
`agentPresets` plus no selected preset is valid.

### Agent Preset Record

The record is stable-id keyed:

- `id`: opaque `ap_` style stable id.
- `name`: human-readable label.
- `description?`: optional note for authors.
- `enabled`: preset-level switch.
- `version`: integer schema version for future migration.
- `maxConcurrency?`: optional per-generation agent-call limit.
- `steps`: ordered `AgentPresetStepRecord[]`.
- `createdAt?` / `updatedAt?`: optional timestamps if command helpers already
  need them for list sorting.

The record order is the stable merge order for independent parallel outputs.

### Agent Step Record

Each step owns:

- `id`: opaque `aps_` style stable id inside the preset.
- `name`: display label.
- `enabled`: step-level switch.
- `phase`: `beforeMain` or `afterMain`.
- `dependencies`: step ids that must finish before this step starts.
- `instruction`: user-authored step prompt.
- `model`: either inherit the main resolved model/profile or use a selected
  model profile id.
- `runtime`: temperature, max input chars, max output chars, timeout ms, and
  optional structured-output strictness.
- `inputScopes`: prepared input sources made available to the step.
- `outputKey`: stable key for prompt references and dependency reads.
- `outputFormat`: `text` or `jsonObject`.
- `destination`: named prompt output, intermediate output, or final output
  modifier.
- `failurePolicy`: optional, required, fallback text, or stop generation.

Validation rules:

- Enabled step ids are unique within a preset.
- Enabled output keys are unique within the phase unless a later synthesizer
  step explicitly reads multiple outputs.
- Dependencies must point to enabled steps in the same preset.
- Cycles are invalid.
- A before-main step cannot depend on an after-main step.
- An after-main final-output modifier must be the last enabled direct modifier.
- Direct modification by earlier after-main or parallel steps is invalid.
- JSON output steps must parse to a JSON object.
- Timeout and max output values must be bounded.

### Prepared Input Scope Contract

First-release scopes are deterministic server-selected inputs:

- recent chat tail
- chat search snippets
- selected lorebook context
- selected memory context
- character summary fields
- persona summary fields
- current user message
- previous agent outputs
- main draft for after-main steps

Prepared inputs are assembled by the server. Mutation tools are out of scope.
Provider tool-calling is out of scope for this first release.

## Execution Contract

### Planning

The executor treats enabled steps as a small directed acyclic graph grouped by
phase. Within a phase:

- A step starts after all dependencies complete successfully or resolve through
  a failure policy.
- Independent steps may run in parallel.
- `maxConcurrency` limits simultaneous calls when configured.
- Outputs are merged by stable preset order, not completion order.

### Before-Main Phase

Before-main steps run after submit transforms:

1. input trigger
2. append user message
3. `editinput`
4. run-var pass
5. Agent Preset before-main stage
6. static/plain slot filling
7. lorebook, history, memory, final render, and budget

Before-main outputs are available to variable expansion as `{{agent::key}}`.
Missing optional outputs expand to an empty string. Missing required outputs
block generation with a clear error.

### Main Provider Call

The main provider call remains owned by the existing generation flow. Agent
Preset execution must not change provider dispatch semantics except through
explicit prompt outputs inserted into prompt assembly.

### After-Main Phase

After-main steps run during server post-generation:

1. provider completion text is received
2. existing `editOutput`/`editoutput` pass runs
3. Agent Preset after-main stage runs
4. assistant row is appended or updated with the resulting text
5. run-var pass over assistant text runs
6. existing Lua `onOutput` trigger runs
7. generation result persists

Advisory after-main outputs remain diagnostics or dependency inputs. The last
enabled direct modifier may replace the text passed into assistant-row
persistence.

If a required after-main step fails, the route should stop the generation at the
agent failure point and preserve the original post-`editOutput` text in
diagnostics for later restart-from-agent support.

## Command And Projection Contract

Generic settings patches are not the primary UI path. Add row-oriented commands:

- create Agent Preset
- update Agent Preset metadata
- duplicate Agent Preset
- delete Agent Preset and clear affected selections/defaults
- reorder Agent Presets
- create/update/delete/reorder step inside a preset
- update preset max concurrency
- select global default Agent Preset
- save chat generation settings with `agentPresetId`

Projection should include an `agentPreset` targeted resource when command-event
patterns need a focused refresh. Chat generation settings remain part of chat
projection.

## UI Contract

Settings should replace the Context Agent page with an Agent Presets page:

- preset list with name, enabled state, step count, phase summary, and usage
  count
- create, duplicate, delete, and reorder actions
- editor drawer/modal with explicit Save/Cancel
- step list grouped by before-main and after-main
- dependency controls that only offer valid earlier/same-phase step ids
- output key and output format controls
- prepared-input scope controls
- model choice controls: inherit main model or select model profile
- failure policy, timeout, max input, and max output controls visible in the
  first release
- diagnostics link or panel for recent hidden agent outputs

Chat controls should show the selected Agent Preset alongside model preset,
prompt preset, and persona. No selection is a valid visible state.

Language keys under `src/lang` are required for new visible UI strings.

## Generation Diagnostics

Each generation should record enough information to debug hidden agents:

- preset id and name
- preset version or hash
- step id, name, phase, and output key
- dependency wait/skipped reason
- start/end timestamps or duration
- provider/model/profile used
- input/output character counts
- output format
- parse status for JSON output
- failure reason and failure policy
- bounded output preview or full output when already bounded by step max output
- whether the final assistant text was modified by an after-main step

Diagnostics can be stored on generated message metadata, generation trace
sidecars, or both. The UI should not show them inline in the chat transcript.

## Prompt Syntax Contract

Add `{{agent::name}}` for named before-main outputs.

Rules:

- `name` matches a step `outputKey`.
- Whitespace around the whole token is tolerated.
- Output keys should be limited to stable identifier characters to avoid parser
  ambiguity.
- `{{agent}}` and `{{slot::agent}}` do not map to Agent Preset output.
- Existing CBS docs should remove or deprecate the old Context Agent entry.

## Non-Goals

- Migrating existing Context Agent settings.
- Creating a default disabled Agent Preset for every user.
- Provider tool-calling from Agent Presets.
- Write-capable tools.
- Automatic multi-pass main-agent revision loops.
- Prompt Preset ownership of Agent Presets in the first release.
- Agent result messages in the visible transcript by default.
- Profile import/export for Agent Presets.
- Marketplace or shared preset distribution.

## Open Implementation Details

These are implementation choices, not product blockers:

- Whether `agentPresetDefaultId` should initialize new chats only or also act as
  a runtime fallback when a chat has no explicit selection. The safer first
  version is initialize-only.
- Whether diagnostics live entirely on message metadata or use a sidecar when
  output previews become too large.
- Whether the preset editor should be a drawer like model profiles or a full
  page inside Settings.
- Whether prompt preview should expose expanded Agent Preset outputs by default
  or hide them behind diagnostics.

## Risk Register

| Risk | Impact | Planned mitigation |
| --- | --- | --- |
| Agent outputs make prompt assembly nondeterministic | Same inputs can produce different final prompt ordering | Merge outputs by stable preset order and explicit destinations, not completion order. |
| Missing selected Agent Preset is silently ignored | Chats can generate with unexpected prompt support missing | Treat non-empty missing `agentPresetId` as a readiness/generation error; no id remains valid. |
| After-main modifiers conflict with Lua output triggers | Final text can differ from user expectations | Run after-main modifiers after `editOutput` and before `onOutput`; document the ordering and test it. |
| Optional step failures are invisible | Users cannot debug weak outputs | Store inspectable per-step diagnostics and surface a diagnostics affordance. |
| Required step failures lose the main output | Users lose useful generated text | Preserve the post-`editOutput` main output text in diagnostics on failure. |
| Old `{{agent}}` syntax keeps working accidentally | Legacy behavior remains hidden and confusing | Remove Context Agent runner and add regression tests that old placeholders are not expanded by agents. |
| Agent calls inflate cost/latency | A preset can unexpectedly launch many calls | Show step count and max concurrency in UI; support per-step timeout/max output/max input. |
| Tool-calling assumptions leak into MVP | Providers without tool calling become unsupported | First release uses prepared inputs only; provider tool-calling remains a future extension. |
