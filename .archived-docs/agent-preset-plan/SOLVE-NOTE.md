# Solve Note

Date: 2026-07-05

This note is for the implementation agent who picks up the Agent Preset
workstream.

## Start Here

1. Read `status.md`.
2. Read `plan.md`.
3. Read `phases/README.md`.
4. Start with `phases/phase-0-contract-and-schema.md`.

Do not begin by deleting Context Agent. Add the new contract first, then replace
runtime and UI paths, then remove legacy surfaces during cleanup.

## Non-Negotiables

- No migration from Context Agent settings in the first release.
- No automatic default Agent Preset for every user.
- `{{agent::name}}` is the new prompt syntax.
- `{{agent}}` and `{{slot::agent}}` are not compatibility aliases.
- First release uses prepared inputs only, not provider tool-calling.
- Agent outputs stay hidden in normal chat and must be inspectable through
  diagnostics.
- After-main modifiers run after `editOutput` and before `onOutput`.
- Only the last enabled after-main direct modifier may change final assistant
  text.

## Likely Hard Parts

- Extending `ChatGenerationSettings` without making no-Agent-Preset chats
  incomplete.
- Avoiding a silent fallback when a chat references a missing Agent Preset.
- Keeping before-main execution early enough that `{{agent::name}}` can expand
  inside prompt slots.
- Keeping after-main execution in the exact post-generation order:
  `editOutput` -> Agent Preset after-main -> append/update assistant row ->
  run-vars -> `onOutput`.
- Recording diagnostics without cluttering the chat transcript.
- Removing the old Context Agent page and route without breaking settings
  navigation tests.

## Suggested First Implementation Slice

Implement Phase 0 with no UI:

- Add `AgentPresetRecord` and `AgentPresetStepRecord` types.
- Add normalizers and defaults for `agentPresets` and `agentPresetDefaultId`.
- Extend `ChatGenerationSettings` with optional `agentPresetId`.
- Extend loadout snapshots with optional Agent Preset references.
- Add validation helpers for output keys, dependencies, phases, and budgets.
- Add tests that empty `agentPresets` and missing `agentPresetId` are valid.
- Add tests that a non-empty unknown `agentPresetId` is invalid once command
  validation has enough context.

## Verification Reminder

Before committing implementation work, run Prettier. Use `pnpm`. Use
`pnpm dev:agent` only when browser smoke is needed, and stop it after use.
