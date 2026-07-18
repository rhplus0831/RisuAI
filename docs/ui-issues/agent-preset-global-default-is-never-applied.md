# Agent preset global default is never applied anywhere

## Summary

The Agent Preset settings page offers a "Global default" selector. The chosen
`agentPresetDefaultId` round-trips to SQLite and back, renders a "Default"
badge, contributes to the preset's usage count, and is cleared when the preset
is deleted — but no resolution path ever reads it. New chats, chat-setup
defaults, loadout application, and prompt assembly all consult only the
per-chat `generationSettings.agentPresetId`. The settings page claims the
preset is in use while the sidebar selector shows "Not selected" and server
generation runs with no agent preset.

## Location

- `src/lib/Setting/Pages/AgentPresetSettings.svelte:41-43,131-139,172-184,243-262,288-292`
  — default selector, "Default" badge, and usage count that counts the default
  as one use.
- `src/ts/agentPresets.ts:284-312` — `setAgentPresetDefault` dispatch.
- `server/fastify/src/commands/agentPresets.ts:243-278` — persists
  `agentPresetDefaultId` (and clears it on delete).
- Consumers that ignore the field:
  - `src/ts/agentPresetResolver.ts:266-283,817-820` — client resolution reads
    only `chat.generationSettings.agentPresetId`.
  - `server/fastify/src/prompt/assemble.ts:1206-1213` — server assembly does
    the same.
  - `src/ts/activeChatGenerationSettings.ts:245-255` — the reset-to-defaults
    patch writes only jailbreak/sidebar toggles, never the default preset.
  - `src/lib/SideBars/SideChatList.svelte:675-698` — new chats are created with
    no `generationSettings`.
- `src/lang/en.ts:2573` — help text: "New chats can start with this preset when
  chat setup applies defaults."

## Trigger

1. In Settings → Agent Presets, pick a preset as the global default.
2. Create a new chat, or generate in any chat that has no explicit per-chat
   agent-preset selection.

## Expected behavior

Per the help text and the usage column, the default should seed new chats'
generation settings or act as a fallback during resolution.

## Actual behavior

The field is persisted and displayed but functionally dead. Generation runs
with no agent preset; the sidebar selector shows "Not selected" while the
settings page shows the preset as the active default with a use count.

## Underlying cause

The persistence, display, and delete-cascade halves of the feature exist, but
no consumer was wired: neither chat creation, nor the defaults patch, nor
either resolver (client or server) reads `agentPresetDefaultId`.

## Affected data flow

1. **UI:** default selector → `setAgentPresetDefault`.
2. **Request:** `POST /agent-presets/default` persists the id; ack applies it.
3. **Displayed state:** settings page badge/usage reflect the default.
4. **Generation:** `resolveAgentPresetForChat`/`assemble.ts` read only the
   per-chat selection → no preset runs; sidebar disagrees with settings.

## Severity and likely user impact

**Medium.** A persisted no-op with actively misleading UI: two components
disagree about whether an agent preset is in use, and users who configure a
default silently get no agent-preset behavior. Confidence is high that nothing
consumes the field; medium-high that this is a regression rather than an
unbuilt hook, because the UI (badge, usage count, help text) claims live
behavior.

## Recommended fix

Either consume the default — seed `agentPresetId` when chat generation
settings are first configured, and/or fall back to it in `selectedAgentPresetId`
on both the client resolver and server `assemble.ts` in lock-step so readiness
and status displays stay consistent — or remove the selector, badge, usage
contribution, and help text.

## Test gap

Add a resolver test asserting that, with `agentPresetDefaultId` set and no
per-chat selection, client and server resolution agree on the effective preset
(currently both return none while the settings UI claims otherwise).
