# Agent Preset Planning Q&A

Last updated: 2026-07-05.

This note captures the proposed replacement for the current Context Agent feature.
It is meant to help align on product behavior, migration expectations, and
implementation boundaries before schema or UI work starts.

## Summary

Agent Preset is a higher-level feature for configuring auxiliary agent calls
around the main prompt execution. The goal is not to expose agents for their own
sake, but to improve the final output of the main agent by letting configured
pre-agents and post-agents gather context, transform inputs, validate results, or
produce additional guidance.

The current Context Agent should become a migration source and compatibility
case, not the long-term user-facing feature.

## Q&A

### What problem are we solving?

The current Context Agent is narrow: it is a single optional read-only agent that
runs before prompt assembly only when `{{agent}}` or `{{slot::agent}}` appears in
the prompt. It can search chat and lorebook data, then injects one text result
into that slot.

Agent Preset should generalize this into a configurable agent pipeline. Instead
of asking users to think in terms of one special slot, users should be able to
choose or build a preset that defines what supporting agents run, when they run,
what inputs they see, and how their outputs are used to improve the main
generation.

### What is being removed?

The user-facing Context Agent feature should be removed as its own feature:

- The standalone Context Agent settings page should go away.
- The global `agentContext*` settings should stop being the primary editing
  surface.
- `{{agent}}` should no longer be the only conceptual output destination.

The existing capability does not need to be discarded immediately. Its behavior
can be migrated into an Agent Preset step, especially for users who already have
Context Agent enabled.

### What is an Agent Preset?

An Agent Preset is a saved configuration for auxiliary agent behavior around a
chat generation. At minimum, it should answer:

- Which helper agents run?
- Do they run before or after the main response?
- Which model/profile/runtime settings do they use?
- What prompt or instruction does each helper agent receive?
- What data and prior outputs can each helper agent read?
- Where does each output go?
- What happens if a helper agent fails, times out, or returns empty output?

The name "Agent Preset" is reasonable, but we should be aware that RisuAI already
has model presets, prompt presets, translator presets, Hypa V3 presets, and
legacy bot presets. The UI should make the distinction clear.

### How does this relate to Prompt Presets and Model Presets?

Agent Preset should not replace Prompt Presets or Model Presets. A useful
boundary is:

- Model Preset: model/provider/runtime configuration for generation.
- Prompt Preset: prompt template and prompt content ownership.
- Agent Preset: orchestration of auxiliary agent calls that support generation.

Agent Preset steps may reference model profiles or inherit the main generation
model, but the preset itself should describe the agent pipeline rather than own
the whole model/prompt configuration.

One alignment decision remains: should an Agent Preset be selected independently
per chat, attached to a Prompt Preset, included in loadouts, or some combination
of those?

### What can an auxiliary agent do before the main prompt?

Pre-agents run before the main response is generated. Examples:

- Build a concise context block from recent chat, lorebooks, memory, or user
  instructions.
- Classify the user's intent and choose which prompt guidance matters.
- Summarize relevant continuity from previous messages.
- Produce style, tone, or formatting guidance.
- Check whether required character, world, or memory facts are missing.
- Rewrite or normalize an internal instruction that will be supplied to the main
  prompt.

The output should be explicitly routed. For example, a pre-agent might write to a
named prompt variable, append a hidden instruction section, or provide structured
metadata consumed by prompt assembly.

### What can an auxiliary agent do after the main prompt?

Post-agents run after the main response is generated. Examples:

- Critique the draft for continuity, instruction adherence, or missing context.
- Produce a revision instruction for a second main-agent pass.
- Extract memory candidates, tags, summaries, or diagnostics.
- Validate that the response matches format constraints.
- Generate a user-visible note only when the preset explicitly asks for that.

The key alignment point is authority. A post-agent can be advisory, can trigger a
revision pass, or can directly transform the final output. Those are different
product promises and should be modeled separately.

### Do these agents require tool calling?

No. An auxiliary agent should be able to work without provider tool-calling
support. Tool calling should be optional.

There are at least three useful modes:

- Prompt-only: the agent receives prepared context and returns text or JSON.
- Prepared-input: the system gathers deterministic data, such as chat tail or
  selected lorebook snippets, and includes it in the agent prompt.
- Tool-enabled: the provider can call approved tools during the agent run.

This distinction matters because some providers do not support tool calls, and
some tasks do not need tools at all.

### How do multiple agents run?

Each Agent Preset can contain multiple agent steps. A step should declare:

- A stable id and display name.
- A phase, such as `beforeMain` or `afterMain`.
- Its input dependencies.
- Its output key or destination.
- Its required/optional failure policy.
- Its runtime budget, including timeout and max output.

Steps with dependencies must run after their dependencies. Steps without
dependencies can run in parallel when they are in the same phase and do not
mutate shared state.

The execution planner should treat this as a small directed graph, not only as a
linear list. The UI can still present it as an ordered list with dependency
controls.

### How should parallel outputs be merged?

Parallel execution should not make prompt assembly nondeterministic. Even when
steps finish in different orders, their outputs should merge by stable preset
order or explicit output destination.

If multiple steps target the same destination, the preset needs a merge policy:

- Append in preset order.
- Use named sections.
- Let a later synthesizer step combine previous outputs.
- Treat same-destination writes as a validation error.

For a first version, named outputs plus explicit prompt placement are easier to
reason about than implicit merging.

### How should outputs reach the main agent?

This is one of the most important design decisions. Possible output destinations:

- Named prompt variables, such as an Agent Preset successor to `{{agent}}`.
- Hidden prompt sections inserted by server prompt assembly.
- Structured metadata consumed by memory selection or prompt planning.
- Draft messages used only inside a revision loop.
- User-visible side results, if explicitly enabled.

The safest initial model is to let each pre-agent produce a named output and let
the preset or prompt template decide where that output is inserted.

### What happens to `{{agent}}` and `{{slot::agent}}`?

They can be compatibility aliases during migration. A reasonable path:

1. Existing Context Agent settings migrate into an Agent Preset with one
   before-main step.
2. That step writes to a default output key, such as `context`.
3. Existing `{{agent}}` and `{{slot::agent}}` slots resolve to that output while
   compatibility is supported.
4. New UI and docs teach named Agent Preset outputs instead of the old Context
   Agent slot.

We should decide whether compatibility slots are permanent, deprecated with a
warning, or removed after migration.

### Where should Agent Presets be selected?

Open decision. Plausible options:

- Global default in settings.
- Chat-scoped selection alongside persona, model preset, prompt preset, and
  sidebar toggles.
- Prompt Preset attachment for authors who want a prompt to define its own
  support pipeline.
- Loadout inclusion so a saved character/chat setup restores the intended agent
  behavior.

The likely long-term answer is chat-scoped selection plus loadout support, with
an optional global default. Prompt Preset attachment is powerful but could blur
ownership unless it is very explicit.

### What settings should each agent step support?

A first useful step definition likely needs:

- Name and enabled state.
- Phase: before main or after main.
- Instruction prompt.
- Model/profile choice, with an inherit-main-model option.
- Temperature, max output, and timeout.
- Output key or destination.
- Input scope, such as recent chat, current character, selected lorebooks, memory
  results, previous agent outputs, main draft, or final output.
- Tool policy: disabled, prepared-input only, or approved tools.
- Failure policy: optional, required, fallback text, or skip main generation.

Advanced options can come later, but the first version should not hide failure
policy or output destination. Those define the user's mental model.

### How should failures work?

Agent calls are supporting work, so fail-open should be the default for optional
steps. A failed optional step should produce diagnostics and omit its output
without blocking the main generation.

Some steps may be required. A required pre-agent failure should block the main
generation with a clear error. A required post-agent failure should either keep
the original main output or fail the whole generation, depending on the post-step
authority.

Timeouts, provider errors, invalid structured output, and empty output should be
reported separately in traces.

### How should post-agent revision loops be bounded?

If post-agents can ask the main agent to revise, the preset needs strict limits:

- Maximum revision passes.
- Which post-agent can request a revision.
- Whether revisions replace the final response or remain advisory.
- Whether the user can inspect the draft, critique, and revised output.

For an initial implementation, it may be better to support advisory post-agents
and structured diagnostics first, then add automatic revision loops once the
execution model is proven.

### What tools should be available?

The current Context Agent has read-only tools for chat search, lorebook search,
and chat tail. Those are good candidates for the first Agent Preset tool group.

Potential tool groups:

- Current chat tail.
- Chat search.
- Lorebook search.
- Memory search or selected memory context.
- Character and persona summaries.
- Prompt preview fragments.

Mutation tools should be out of scope at first. If write-capable tools are ever
added, they should go through existing command mutation boundaries and require
explicit user-facing permissions.

### What should the MVP include?

A practical first slice could include:

- A new Agent Preset resource with one selected preset.
- Before-main steps only, plus a clear design placeholder for after-main steps.
- Multiple steps with explicit dependencies and parallel execution where safe.
- Prompt-only and prepared-input execution modes.
- The existing Context Agent behavior migrated into a one-step preset.
- Named outputs with compatibility support for `{{agent}}`.
- Basic traces showing each step, duration, provider/model, skipped reason, and
  output length.

After that, add post-main advisory steps, then bounded revision loops.

### What needs product alignment before implementation?

The main open decisions are:

- Whether Agent Presets are selected globally, per chat, through Prompt Presets,
  through loadouts, or all of those.
- Whether post-agents can directly change final output in the first release.
- Whether `{{agent}}` remains as a permanent alias or becomes a deprecated
  compatibility slot.
- How visible agent outputs should be to users during normal chat.
- Whether steps should require structured JSON output, free text output, or both.
- How much existing Context Agent data should be migrated automatically.
- Which providers are supported for tool-enabled steps.
- What concurrency and cost limits should apply per generation.

### What should be tested?

Implementation should include tests for:

- Context Agent settings migration into Agent Presets.
- Prompt assembly using named pre-agent outputs.
- Compatibility behavior for `{{agent}}` and `{{slot::agent}}`.
- Dependency ordering and parallel execution of independent steps.
- Prompt-only agents on providers without tool calling.
- Tool-enabled agents using read-only chat/lorebook tools.
- Optional versus required failure behavior.
- Timeout handling and trace output.
- Post-agent advisory behavior once that phase is implemented.

## Proposed Terminology

| Term | Meaning |
| ---- | ------- |
| Agent Preset | Saved configuration for auxiliary agent behavior around main generation. |
| Agent step | One configured helper agent run inside a preset. |
| Phase | When a step runs, such as before the main call or after the main call. |
| Dependency | Another step whose output must exist before this step runs. |
| Output key | Stable name for a step result that prompt assembly or another step can read. |
| Destination | Where a step output is inserted or consumed. |
| Required step | A step whose failure blocks or invalidates the generation according to policy. |
| Optional step | A step whose failure is traced but does not block the main generation. |

## Recommended Next Alignment Pass

Before implementation, align on the MVP answers to these questions:

1. Where is the selected Agent Preset stored?
2. Are after-main agents advisory only in the first release?
3. What is the replacement syntax for `{{agent}}`, if any?
4. Does the first release support tool-enabled steps, or only prepared-input
   steps using server-selected context?
5. Should migration create an Agent Preset only when Context Agent was enabled,
   or should every user get a disabled default preset?
