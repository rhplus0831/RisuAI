# Phase 3: Settings Agent Preset Shell

## Objective

Build the visible Agent Preset management shell and chat selection control. The
file name mirrors the archived skeleton; this phase is not model-settings work.

## Scope

- Replace the standalone Context Agent settings page with an Agent Presets page.
- Add the Agent Preset list and editor shell.
- Add chat-scoped Agent Preset selection beside model preset, prompt preset, and
  persona.
- Add language keys for all visible UI strings.
- Keep provider execution and full step editing for Phase 4.

## Settings Navigation

Update:

- `src/lib/Setting/Settings.svelte`
- `src/ts/router.ts`
- `src/ts/router.test.ts`
- `src/lang/*`

Planned behavior:

- Navigation label becomes Agent Presets.
- Route slug becomes `/settings/agent-presets`.
- The old `/settings/context-agent` slug can route to the same Settings index
  temporarily if needed for router stability, but it should not show Context
  Agent controls.
- Remove `ContextAgentSettings.svelte` from the active settings switch once the
  new shell exists.

## Settings Page Shell

Add a page under `src/lib/Setting/Pages/`, for example:

- `AgentPresetSettings.svelte`

Suggested component split:

- `AgentPresetSettingsShell.svelte`
- `AgentPresetList.svelte`
- `AgentPresetSummary.svelte`
- `AgentPresetEditorDrawer.svelte`
- `AgentPresetStepList.svelte`
- `AgentPresetDiagnosticsLink.svelte`

First shell capabilities:

- empty state for no presets
- create preset
- select preset for editing
- rename preset
- enable/disable preset
- duplicate preset
- delete preset
- reorder presets
- show step count and phase summary
- show invalid/disabled status from resolver helpers
- edit max concurrency
- explicit Save/Cancel for drafts

## Chat Selection Control

Update:

- `src/lib/SideBars/ChatGenerationSettingsControls.svelte`
- `src/ts/activeChatGenerationSettings.ts`
- preset/persona picker helpers or add a dedicated Agent Preset picker

Control behavior:

- Show selected Agent Preset name or "No Agent Preset".
- Allow clearing the selection.
- Save through chat generation settings commands.
- Do not make no selection an incomplete chat state.
- Show missing selected preset as an actionable error.

## Loadout UI

Update loadout save/apply surfaces only enough to preserve the new fields:

- `src/lib/Others/LoadoutModal.svelte`
- `src/ts/loadout.ts`
- loadout tests

If the modal does not display every saved selection today, do not expand the
loadout UX beyond what is needed to keep Agent Preset selection predictable.

## Diagnostics Entry Point

Add a placeholder affordance for future hidden outputs:

- disabled or empty diagnostics panel when no generation diagnostics exist.
- link/button placement decided with the chat message metadata UI or Settings
  page.

Full diagnostics rendering can land in Phase 5 if it depends on runtime output
shape.

## Language

Add keys under `src/lang` for:

- Agent Presets navigation label
- no Agent Preset selected
- create/duplicate/delete preset
- before-main and after-main labels
- step count summaries
- invalid/missing/disabled statuses
- max concurrency
- diagnostics
- Save/Cancel labels if not already shared

## Tests

Add focused tests for:

- Settings nav shows Agent Presets instead of Context Agent.
- `/settings/agent-presets` routes to the new page.
- old context-agent controls are not rendered from the active page.
- empty Agent Presets page renders without presets.
- create/update/delete actions call command helpers.
- chat selection control saves `agentPresetId`.
- clearing Agent Preset selection remains ready.
- missing selected Agent Preset is displayed as an error.
- language key coverage for new settings items.

## Exit Criteria

- Users can create and select Agent Presets without editing steps fully.
- Context Agent no longer has a visible standalone settings page.
- Chat generation settings can show and save an Agent Preset selection.
- Focused UI/lang tests pass and status is updated.
