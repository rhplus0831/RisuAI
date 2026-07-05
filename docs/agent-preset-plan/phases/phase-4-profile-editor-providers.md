# Phase 4: Step Editor And Prepared Inputs

## Objective

Implement the full Agent Preset step editor and prepared-input execution
building blocks. The file name mirrors the archived skeleton; this phase is not
profile-provider UI work.

## Scope

- Complete step editing UI.
- Build deterministic prepared-input collectors.
- Add provider execution helpers for prompt-only and prepared-input steps.
- Support text and JSON object outputs.
- Support inherit-main-model and selected-model-profile execution.
- Keep provider tool-calling out of scope.

## Step Editor

The editor should expose:

- step name
- enabled toggle
- phase selector
- instruction prompt
- model choice: inherit main model or select model profile
- dependencies
- output key
- output format: free text or JSON object
- destination
- failure policy
- timeout
- max input chars
- max output chars
- temperature
- prepared input scopes

Use controls that match existing UI patterns:

- toggles/checkboxes for enabled and scope inclusion
- menus/selects for phase, model selection, output format, destination, failure
  policy
- numeric inputs for timeout/max input/max output/temperature
- text input for output key
- textarea/editor for instruction

The UI should prevent invalid dependency choices where practical, but server
validation remains authoritative.

## Prepared Input Collectors

Add server-side collectors for first-release scopes:

- recent chat tail
- chat search snippets
- selected lorebook context
- selected memory context
- character summary
- persona summary
- current user message
- previous agent outputs
- main draft for after-main steps

Collectors must:

- be read-only.
- be bounded by per-step max input.
- produce deterministic section order.
- include source labels for diagnostics.
- omit unavailable scopes with a diagnostic, not a crash, unless the step marks
  that input as required.

Prefer reusing existing prompt assembly helpers for lorebook and memory context
instead of duplicating selection semantics.

## Agent Step Prompt Shape

Construct messages consistently:

- system/developer row describes the step contract, output format, and failure
  constraints.
- user row contains the author instruction and prepared input sections.
- previous agent outputs are included as named sections.
- JSON output steps instruct the model to return one JSON object and no wrapper
  prose.

The prompt builder should be unit-testable without a provider call.

## Provider Execution

Build an executor that can call the same provider stack used for chat
generation, while applying the step's model/runtime choices.

Requirements:

- Inherit-main-model steps use the resolved main generation profile/runtime.
- Selected-model-profile steps resolve through existing durable profile
  readiness and provider dispatch.
- Max output and timeout are enforced per step.
- Output text is normalized and bounded.
- JSON object output is parsed after trimming and fails on invalid JSON.
- Streaming is not required for helper steps in the first release.
- Tool declarations are not sent.

Avoid adding a second provider dispatch system. Reuse existing generation
adapter boundaries where possible.

## Failure Handling

Executor results should distinguish:

- skipped disabled step
- dependency skipped
- optional failure
- required failure
- timeout
- provider error
- invalid JSON output
- empty output
- output truncated

Each result must carry diagnostics for Phase 5 storage and UI.

## Tests

Add focused tests for:

- editor renders all required fields.
- invalid dependency choices are unavailable or rejected.
- prepared input collector section order and bounds.
- prompt builder for text output.
- prompt builder for JSON object output.
- inherit-main-model profile resolution.
- selected-model-profile resolution.
- provider timeout handling.
- optional failure result shape.
- required failure result shape.
- invalid JSON output failure.
- max output truncation.
- no tool-calling fields are sent.

## Exit Criteria

- A user can fully author steps in the UI.
- Server-side helpers can collect prepared input and execute a single step in
  isolation.
- Execution is covered by unit tests or focused provider-adapter mocks.
- No generation path uses Agent Preset execution yet.
- Focused tests pass and status is updated.
