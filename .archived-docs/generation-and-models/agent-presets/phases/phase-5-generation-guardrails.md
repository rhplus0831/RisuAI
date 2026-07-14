# Phase 5: Generation Guardrails

## Objective

Integrate Agent Preset execution into chat generation with deterministic prompt
syntax, after-main ordering, diagnostics, and failure behavior.

## Scope

- Run before-main steps from prompt assembly.
- Expand `{{agent::name}}`.
- Run after-main steps during server post-generation.
- Store and surface diagnostics.
- Add SSE or terminal-frame fields only when needed.
- Add guardrails for missing presets, invalid steps, timeouts, and failures.
- Add regression coverage for removing old Context Agent behavior.

## Before-Main Integration

Update `server/fastify/src/prompt/assemble.ts`:

- Replace `context_agent` stage with an Agent Preset before-main stage or add a
  new stage name.
- Run after submit transforms and before static/plain slot filling.
- Resolve the selected Agent Preset from effective chat generation settings.
- Execute planned before-main steps.
- Add outputs to a named expansion map for prompt rendering.
- Preserve deterministic merge order when independent steps run in parallel.

Update prompt variable expansion:

- Add `{{agent::name}}` support.
- Do not map `{{agent}}` or `{{slot::agent}}` to Agent Preset output.
- Missing optional outputs expand to empty string.
- Missing required outputs block generation with a structured error.

## After-Main Integration

Update `runServerPostGeneration()` in `server/fastify/src/prompt/assemble.ts`:

Current rough flow:

1. reformat provider completion
2. apply `editOutput` / `editoutput`
3. append/update assistant row
4. run-vars
5. run `onOutput`
6. build mutation payload

Target flow:

1. reformat provider completion
2. apply `editOutput` / `editoutput`
3. run Agent Preset after-main stage
4. append/update assistant row with the final agent-modified text
5. run-vars
6. run `onOutput`
7. build mutation payload

Rules:

- Advisory after-main outputs are diagnostics or dependency inputs.
- Only the last direct modifier can replace assistant text.
- Optional after-main failures omit that step output and continue.
- Required after-main failures stop at the failure point.
- The post-`editOutput` main output text is preserved in diagnostics on failure.
- `onOutput` sees the text after Agent Preset modification.

## Diagnostics Storage

Record per-generation diagnostics:

- preset id/name/version
- plan status
- step result rows
- timings
- provider/model/profile
- input/output lengths
- output keys
- output format and JSON parse status
- skipped/failure reasons
- final text modification flag
- bounded output preview or output body

Candidate storage:

- generated assistant message `generationInfo.agentPreset`
- generation trace sidecar when traces are enabled
- optional UI diagnostics panel that reads message metadata

Keep normal chat display uncluttered.

## Error And SSE Behavior

Before-main required failures should fail before the provider call with a clear
error event/body.

After-main required failures should:

- stop finalization at the agent failure point.
- avoid pretending the modified output succeeded.
- preserve the original main output in diagnostics.
- return a structured error that the browser can display.

If adding SSE event fields, update:

- `server/fastify/src/prompt/sseEvents.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/process/request/serverChat.ts`
- `src/ts/process/serverBackedSendChat.ts`

Prefer additive fields over renaming existing terminal frames.

## Legacy Context Agent Regression

Remove runtime dependence on:

- `shouldRunPromptContextAgent`
- `runPromptContextAgent`
- `ctx.slot.agent`

Tests should prove:

- `{{agent::context}}` expands from a named before-main output.
- `{{agent}}` remains literal, empty, or otherwise non-agent depending on the
  final prompt parser choice, but it must not run Context Agent.
- `{{slot::agent}}` is not an Agent Preset alias.
- old `agentContext*` settings do not trigger helper calls.

## Guardrails

Add checks for:

- selected Agent Preset missing.
- selected Agent Preset invalid.
- selected Agent Preset disabled.
- selected model profile missing/incomplete for a step.
- max concurrency bounds.
- step timeout.
- invalid JSON output.
- duplicate output keys.
- after-main modifier rule violation.
- dependency skipped/failure propagation.

Guardrail errors should identify the preset and step where possible.

## Tests

Add focused tests for:

- before-main execution order.
- independent before-main parallel merge order.
- dependency failure propagation.
- prompt assembly with `{{agent::name}}`.
- old `{{agent}}` and `{{slot::agent}}` no longer trigger Context Agent.
- optional before-main failure continues generation.
- required before-main failure blocks provider dispatch.
- after-main runs after `editOutput`.
- `onOutput` sees after-main modified text.
- only last after-main direct modifier can mutate final output.
- required after-main failure preserves original main output diagnostics.
- timeout diagnostics.
- generation metadata stores hidden output diagnostics.
- browser client applies terminal frames without showing hidden outputs in chat.

## Exit Criteria

- Agent Presets affect real chat generation in before-main and after-main
  phases.
- Legacy Context Agent runtime behavior is no longer active.
- Diagnostics are inspectable without cluttering chat.
- Focused generation/client/server tests pass and status is updated.
