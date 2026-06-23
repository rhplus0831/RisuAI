# Prompt Template Ownership Cleanup

Date: 2026-06-23

## Goal

Make prompt template ownership match the newer split-preset architecture:
prompt templates should normally belong to `promptPresets`, not to legacy
`botPresets`, and not to a durable top-level `DBState.db.promptTemplate` copy
that is overwritten when presets are selected.

This plan exists because a direct move to "read from legacy `botPresets`
instead of copying" would clean up one copy while reinforcing the wrong
long-term owner. For architectural cleanup, the better direction is to make
modern prompt presets authoritative and demote legacy bot presets to
compatibility data.

## Current Problem Shape

The current system has three overlapping prompt-template locations:

- `botPresets[].promptTemplate`: legacy combined model/prompt preset body.
- `promptPresets[].promptTemplate`: modern split prompt preset body.
- `DBState.db.promptTemplate` / server `database.promptTemplate`: active
  top-level collection persisted in `prompt_templates`.

Today, applying a legacy bot preset copies its `promptTemplate` into the active
top-level field. Applying a modern prompt preset also copies its
`promptTemplate` into the active top-level field. Prompt assembly, prompt item
commands, lazy hydration, and the editor mostly treat that top-level collection
as the active truth.

That makes the active prompt template easy to render, but it creates drift and
unclear ownership:

- A preset row can differ from the top-level active copy.
- The prompt editor writes top-level data and mirrors to selected prompt preset.
- Legacy bot preset selection can overwrite prompt-preset-driven state.
- Loadouts and chat generation settings can select prompt presets while the
  global legacy bot preset pointer still exists.
- Lazy projection strips both preset bodies and top-level prompt templates, so
  "missing" can mean unloaded rather than disabled.

## Target Contract

### Durable Owner

`promptPresets[].promptTemplate` is the durable owner for normal prompt template
editing and generation.

### Effective Projection

During migration, `DBState.db.promptTemplate` may remain as an effective
projection/cache for compatibility with rendering and older helper code. It
should become derived from the selected or chat-effective prompt preset, not a
separate source that commands mutate directly.

The end state should either remove the top-level durable `prompt_templates`
write path or leave it as a compatibility mirror with clear ownership and tests
that prevent it from becoming stale truth.

### Legacy Bot Presets

Legacy `botPresets` remain supported for imported saves, exports, and the
Legacy Bot Presets UI. Their `promptTemplate` data should be convertible or
extractable into `promptPresets`. Selecting a legacy bot preset should not be
the normal way to choose prompt template ownership after this workstream.

### Prompt Selection

Prompt template selection should follow the split-preset model:

- Settings editing uses `promptPresetsId`.
- Chat generation can use chat-scoped `generationSettings.promptPresetId`.
- Loadouts save and apply prompt preset ids.
- Legacy bot preset selection can still apply legacy model/prompt scalars where
  explicitly supported, but should not silently overwrite prompt preset
  templates.

## Non-Goals

- Building a new visual prompt-template editor from scratch.
- Removing all legacy `botPresets` support.
- Designing a database migration system. The Fastify variant is unreleased, so
  table reshaping can be handled as normal source changes with defaults/tests.
- Changing prompt-template card semantics, ordering, tokenization, cache points,
  utility-bot override behavior, or author-note behavior beyond ownership.
- Removing modern `promptPresets`.
- Changing provider/model preset behavior except where loadout or generation
  composition depends on prompt-preset ownership.

## Design Principles

- Prefer modern split presets over legacy combined presets.
- Keep prompt rendering behavior stable while changing ownership.
- Make every write path name the owner it edits.
- Avoid selection races for debounced prompt-template edits by including stable
  preset ids in commands where needed.
- Do not rely on missing `promptTemplate` to mean disabled unless hydration state
  proves the data is loaded.
- Keep legacy imports/export readable, then convert or extract into modern
  prompt presets intentionally.

## Required Decisions

These decisions should be locked in Phase 0 before implementation:

- Whether top-level `prompt_templates` is removed entirely or retained as an
  effective compatibility mirror.
- Whether Prompt Settings always edits selected `promptPresetsId`, or whether a
  compatibility mode allows editing legacy `botPresets` rows directly.
- How chat-scoped `generationSettings.promptPresetId` overrides global
  `promptPresetsId`.
- How legacy bot preset selection behaves when both legacy and modern prompt
  preset selections exist.
- Whether legacy `botPresets[].promptTemplate` is preserved on export, extracted
  into prompt presets, or both.

Recommended default answers:

- Retain top-level `promptTemplate` only as a derived compatibility cache during
  transition.
- Prompt Settings edits selected modern `promptPresetsId`.
- Chat-scoped prompt preset wins for generation when present; global prompt
  preset is the settings default.
- Legacy bot preset selection does not overwrite modern prompt preset templates
  unless an explicit compatibility action requests extraction/apply.
- Legacy exports may preserve old fields, but normal app state should have a
  modern prompt preset representing that template.

## Phase Plan

| Phase | Purpose |
| --- | --- |
| Phase 0: Contract And Decision | Lock source-of-truth, precedence, compatibility, and migration behavior. |
| Phase 1: Effective Template Resolver | Add shared browser/server resolver and use it in runtime read paths. |
| Phase 2: Prompt Preset Commands And Projection | Move prompt-item edits/hydration from top-level collection to prompt preset ownership. |
| Phase 3: Settings UI And Bridge | Make Prompt Settings and Bot Settings edit selected prompt presets directly. |
| Phase 4: Legacy BotPreset Compatibility | Stop legacy bot presets from copying template into the active top-level field. |
| Phase 5: Generation Loadout And Cleanup | Align generation, loadouts, imports/exports, and remove stale top-level ownership assumptions. |
| Phase 6: Verification And Docs | Run regression, browser smoke, and update structure docs. |

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Prompt rendering parity changes | Prompt card behavior affects memory, cache, utility bots, and author notes | Phase 1 resolver must have focused parity tests before UI/command changes. |
| Debounced edits hit the wrong preset after selection changes | User edits can persist into a newly selected preset | Prompt item commands should carry `promptPresetId` and reject stale selection. |
| Top-level compatibility cache drifts from prompt preset | Generation or UI reads stale data | Treat cache as derived and update it only through resolver/projection paths with tests. |
| Legacy imports lose template data | Existing saves may appear to lose prompt formatting | Preserve legacy fields on import/export and add explicit extraction into prompt presets. |
| Modern prompt presets and legacy bot presets both claim ownership | Users see one template but generation uses another | Phase 0 locks precedence and Phase 4 removes silent legacy overwrites. |
| Lazy hydration confuses unloaded with disabled | Prompt editor can display empty template incorrectly | Hydration APIs must distinguish absent, unloaded, and loaded-empty states. |
| Large test churn hides regressions | Ownership touches many suites | Keep phase slices small and require focused tests plus TypeScript per phase. |

## Success Criteria

- Prompt Settings edits selected `promptPresets[].promptTemplate` directly.
- Prompt item commands are prompt-preset-scoped or otherwise owner-aware.
- Applying a legacy `botPreset` no longer silently writes the durable top-level
  `promptTemplate` collection.
- Server and browser prompt assembly resolve the same effective prompt template
  from split preset selection.
- Loadouts and chat generation settings use prompt preset ids as the normal
  prompt-template selection mechanism.
- Legacy bot preset imports keep template data and offer a clear extraction or
  compatibility path.
- Tests cover prompt preset selection, editing, hydration, generation assembly,
  legacy bot preset apply, loadout apply, and rollback/race behavior.

## Estimated Effort

- Phase 0 and Phase 1: 1-2 days.
- Phase 2 and Phase 3: 3-5 days.
- Phase 4 and Phase 5: 2-4 days.
- Phase 6 and stabilization: 1-2 days.

Total: roughly 1-2 engineering weeks for a clean end-to-end architecture shift.

## Historical Exploration Summary

The exploration found that prompt rendering itself is not the main challenge.
The hard part is replacing the active top-level collection contract used by:

- prompt item commands,
- prompt-template bridge rollback,
- lazy projection and hydration,
- Prompt Settings draft reconciliation,
- legacy bot preset apply/save,
- loadout application,
- split prompt preset selection,
- browser/server prompt assembly tests.

A direct legacy-bot-preset source would be smaller than a full cleanup, but it
would move ownership backward. This plan intentionally moves ownership forward
to `promptPresets`.
