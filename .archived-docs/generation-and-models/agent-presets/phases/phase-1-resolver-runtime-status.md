# Phase 1: Resolver Runtime Status

## Objective

Add the Agent Preset resolver, planner, status helpers, and prepared-input plan
without executing provider calls from generation yet.

## Scope

- Resolve selected Agent Preset for a chat.
- Validate enabled steps as an executable DAG.
- Build phase plans for before-main and after-main execution.
- Resolve model/profile readiness for each step.
- Plan prepared input scopes.
- Produce UI-friendly status summaries.

## Resolver Contract

Create a focused resolver module, likely under `src/ts/agentPreset/` or
`server/fastify/src/prompt/agentPreset/` with shared pure helpers where needed.

Inputs:

- effective database
- current character
- current chat
- selected chat generation settings
- resolved main model profile info when available

Outputs:

- no preset selected
- selected preset ready
- selected preset disabled
- selected preset missing
- selected preset invalid
- selected preset has unsupported step model/profile
- selected preset has invalid after-main direct modifier ordering

The resolver should not silently ignore a non-empty missing or invalid selected
preset.

## Planner Contract

For a ready preset, produce:

- `beforeMain` execution plan
- `afterMain` execution plan
- stable ordered step list
- dependency levels for possible parallel execution
- max concurrency value
- named output registry
- final-output modifier step id, if any

Planning rules:

- Disabled presets result in no steps but should be visible as disabled status.
- Disabled steps are removed before dependency validation.
- Dependencies on disabled or missing steps are invalid unless the UI rewrites
  them before save.
- Stable preset order is used for merge order.
- Same-phase independent steps can share a dependency level.
- Before-main and after-main phases never depend on each other.

## Prepared Input Planning

Add a deterministic plan for each input scope:

- recent chat tail: count and max chars
- chat search: query source, limit, and max chars
- selected lorebook context: source selection and max chars
- selected memory context: reuse existing memory selection where possible
- character summary: selected safe fields
- persona summary: selected safe fields
- current user message
- previous agent outputs
- main draft for after-main steps

The planner should only describe what to collect. Actual data collection and
provider execution land in later phases.

## Model/Profile Readiness

Each step can inherit the main model or select a model profile.

Status should report:

- inherit-main ready
- selected profile ready
- selected profile missing
- selected profile incomplete
- selected profile unsupported for agent execution

Use existing model profile resolver semantics instead of introducing a separate
provider configuration system.

## UI Status Helpers

Add helpers that settings UI can display:

- preset enabled/disabled
- number of before-main and after-main steps
- invalid dependency count
- missing output key count
- direct modifier status
- estimated maximum calls per generation
- model/profile readiness per step

## Tests

Add focused tests for:

- no selected preset resolves to no-op ready.
- missing selected preset reports an error.
- disabled selected preset resolves as disabled no-op.
- dependency levels are stable.
- independent steps can be planned in parallel.
- cycles are rejected.
- duplicate output keys are rejected where not allowed.
- invalid direct after-main modifier ordering is rejected.
- inherit-main and selected-profile readiness statuses.
- prepared-input scope plans are bounded and deterministic.

## Exit Criteria

- Resolver and planner are pure enough to test without running a dev server.
- UI-facing statuses are available before building UI.
- No provider calls run from Agent Presets yet.
- Focused resolver/planner tests pass and status is updated.
