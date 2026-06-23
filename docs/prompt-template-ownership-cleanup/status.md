# Prompt Template Ownership Cleanup Status

Date: 2026-06-23

This workstream has completed the runtime resolver slice, the prompt
preset-owner-aware prompt item command/projection/hydration slice, the Settings
UI ownership slice, the legacy bot-preset compatibility cleanup slice, the
narrow generation/loadout cleanup slice, and the final docs/verification
closeout.

## Snapshot

- Plan state: complete; Phase 0 decisions recorded and Phases 1-6 implemented.
- Current phase: workstream complete.
- Current implementation state:
  - Browser/server prompt assembly now resolves an effective prompt template
    through modern `promptPresets` before falling back to top-level
    `promptTemplate`.
  - Chat-scoped `generationSettings.promptPresetId` wins for generation reads.
  - A resolved prompt preset without `promptTemplate` disables template
    rendering instead of falling back to stale top-level data.
  - Prompt item commands can now target `promptPresets[].promptTemplate` by
    `promptPresetId`; scoped edits persist through the owning `prompt_presets`
    row and reject stale selected-preset races.
  - Top-level `promptTemplate` remains the legacy command path when
    `promptPresetId` is omitted and a compatibility projection/cache for the
    selected prompt preset.
  - Legacy `botPresets` can carry `promptTemplate` for import/export and prompt
    diff/extraction compatibility, but selecting/applying a legacy bot preset no
    longer copies that data into the active top-level collection.
  - Modern `promptPresets` can carry `promptTemplate` and also apply it into the
    active top-level collection.
  - Prompt Settings edits a local draft sourced from the selected modern prompt
    preset's `promptTemplate`, falling back to top-level `promptTemplate` only
    when no modern selected owner exists.
  - Prompt Settings keeps top-level `DBState.db.promptTemplate` aligned as a
    compatibility projection after explicit selected-preset template edits.
  - Bot Settings gates prompt-template editor visibility and enable/disable
    controls on selected prompt preset ownership, not stale top-level
    compatibility data.
  - Prompt item projection/hydration derives the selected/requested prompt
    preset body and clears stale compatibility template data when the selected
    prompt preset has no template.
  - Prompt Settings and Bot Settings kick owner-scoped prompt-template
    hydration when selected prompt presets change, so the editor gate does not
    stay on a stale owner after preset switching.
  - Legacy bot-preset save-current snapshots no longer copy top-level
    `promptTemplate` back into `botPresets[]`.
  - Legacy bot-preset hydration no longer uses `promptTemplate` as the sole
    loaded-data sentinel, so saved legacy presets without that field are not
    treated as unloaded forever.
  - Browser local/parity generation hydrates and checks the effective prompt
    template owner used by normalization: chat-scoped prompt preset first,
    selected/global prompt preset next, and legacy top-level ownership last.
    Non-current chat prompt preset hydration populates that prompt preset row
    without replacing the visible selected/global compatibility projection.
  - Generic top-level preset-field mirroring now skips `promptTemplate`, so
    prompt-template ownership moves through explicit owner-aware prompt-preset
    paths instead of accidental top-level writes.
  - Server prompt-preset select/update/delete writes to `prompt_templates`
    remain quarantined as a compatibility mirror for this phase.
- Current verification state: final Phase 6 regression matrix, TypeScript
  checks, Prettier, `git diff --check`, and browser smoke passed locally; see
  `latest-verification.md`.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Decision | Decided | Lock source-of-truth, precedence, compatibility, and migration behavior. |
| Phase 1: Effective Template Resolver | Implemented | Add shared browser/server resolver and use it in runtime read paths. |
| Phase 2: Prompt Preset Commands And Projection | Implemented | Move prompt-item edits and hydration toward prompt-preset ownership. |
| Phase 3: Settings UI And Bridge | Implemented | Make Prompt Settings and Bot Settings edit selected prompt presets directly. |
| Phase 4: Legacy BotPreset Compatibility | Implemented | Retire legacy bot-preset prompt-template apply/copy semantics. |
| Phase 5: Generation Loadout And Cleanup | Implemented | Align generation, loadouts, imports/exports, and remaining compatibility paths. |
| Phase 6: Verification And Docs | Complete | Run regression, browser smoke, docs, and closeout. |

## Current Blockers

- No Phase 1 blocker is known.
- No Phase 2 blocker is known.
- No Phase 3 blocker is known.
- No Phase 4 blocker is known.
- No Phase 5 blocker is known.
- No Phase 6 blocker is known.

## Latest Completed Slice

- Exploration completed through three read-only agents:
  - prompt assembly/runtime,
  - server persistence/projection,
  - frontend settings/storage/loadout.
- This planning folder was created from those findings.
- Phase 1 worker implementation added shared effective prompt template
  resolution for browser/server runtime reads and focused precedence tests.
- Focused resolver parity fix threads chat-scoped prompt preset IDs into server
  author-note defaults.
- Phase 2 worker extended prompt item commands with optional `promptPresetId`,
  scoped durable writes to `prompt_presets`, owner-aware projection/hydration,
  bridge stale-owner dropping for debounced row edits, and captured-owner guards
  for create/delete/reorder/enable command construction plus rollback.
- Phase 3 worker moved Prompt Settings draft/reset/mount/reconcile sources to
  selected prompt presets first, locally syncs selected prompt-preset ownership
  for template edits while keeping row edits on scoped prompt-item commands, and
  changed Bot Settings template gates/toggles to selected prompt preset
  ownership.
- Phase 4 worker removed legacy bot-preset prompt-template apply/snapshot
  behavior on the server, browser storage helpers, and loadout apply snapshots;
  preserved explicit extraction into modern prompt presets; and narrowed legacy
  preset select/delete reads and writes away from `prompt_templates`.
- Phase 5 worker aligned browser local/parity prompt-template hydration with the
  chat-scoped effective prompt preset owner and blocked generic
  `promptTemplate` top-level-to-prompt-preset mirroring while preserving other
  prompt preset mirrors. A follow-up fix retained explicit non-current
  chat-owner hydration in `promptTemplateHydration` for local assembly without
  poisoning the visible selected/global prompt-template projection.
- Phase 6 docs closeout updated structure/client documentation to describe
  modern prompt-preset ownership, top-level compatibility projection, legacy
  bot-preset compatibility, generation precedence, and loadout behavior. The
  final focused client/server regression matrix, TypeScript checks, Prettier,
  `git diff --check`, and browser smoke passed; the dev server was stopped and
  ports `6418`/`6419` were confirmed clear.

## Compatibility Caveats

- Legacy `botPresets` remain present in storage and UI.
- Legacy `.risu` import/export and prompt diff tooling still preserve/read
  `botPresets[].promptTemplate`.
- During transition, `DBState.db.promptTemplate` may remain visible as a
  compatibility/effective projection even after ownership moves to
  `promptPresets`.
- Modern prompt-preset apply may still write top-level `promptTemplate` as a
  compatibility projection.
- Server prompt-preset select/update/delete paths may still write
  `prompt_templates`; this is retained as a compatibility mirror until a later
  phase explicitly removes or permanently documents it.
