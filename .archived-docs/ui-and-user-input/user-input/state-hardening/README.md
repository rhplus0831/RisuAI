# User Input State Hardening Plan

Date: 2026-06-17

This closed workstream turned the persistence verification and stale-state
sections in [`../audit-records/`](../audit-records/) into one implementation
plan. The verification sections say which user controls persist and through
which route or command; the stale-state sections prioritize the same surface by
delayed async overwrite risk.

This folder mirrors the workstream shape used by
`../../../generation-and-models/chat-scoped-generation-settings/`: a top-level router,
one contract plan, status and verification records, and phase files under
`phases/`.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then the
phase files under [`phases/`](phases/).
[`latest-verification.md`](latest-verification.md) records the final validation
proof.

## Read Order

1. [`status.md`](status.md) - final phase router and closeout state.
2. [`plan.md`](plan.md) - goal, contract, invariants, and non-goals.
3. [`latest-verification.md`](latest-verification.md) - latest proof and known
   gaps.
4. [`phases/README.md`](phases/README.md) - phase index.
5. [`phases/phase-0-contract-and-baseline.md`](phases/phase-0-contract-and-baseline.md)
   - lock stale-state safety terms and normalize audit-source drift.
6. [`phases/phase-1-shared-primitives-and-rollback.md`](phases/phase-1-shared-primitives-and-rollback.md)
   - shared async guards, command rollback policy, and narrow rollback helpers.
7. [`phases/phase-2-dirty-draft-projection.md`](phases/phase-2-dirty-draft-projection.md)
   - dirty draft ownership and projection merge rules.
8. [`phases/phase-3-upload-import-fetch-callbacks.md`](phases/phase-3-upload-import-fetch-callbacks.md)
   - file, upload, import, decode, and remote-fetch callback guards.
9. [`phases/phase-4-chat-messages-generation.md`](phases/phase-4-chat-messages-generation.md)
   - composer, reroll, message edits, triggers, and generation finalization.
10. [`phases/phase-5-collection-domains.md`](phases/phase-5-collection-domains.md)
    - presets, personas, loadouts, lorebooks, scripts, modules, plugins, and
      sidebar list rollback.
11. [`phases/phase-6-resync-memory-navigation.md`](phases/phase-6-resync-memory-navigation.md)
    - full resync, backup/restore/import refresh, memory events, and route
      selection edges.
12. [`phases/phase-7-verification.md`](phases/phase-7-verification.md) -
    regression, browser smoke, and TypeScript proof.

## Sub-Agent Inputs

This plan incorporates one parallel explorer synthesis over the archived plan
shape and both audit trees. The explorer recommended one umbrella remediation
plan, the same top-level file layout used here, and these cross-cutting
priorities: dirty projection guards, attempt-aware rollback, operation/entity
tokens, active-scope guards after `await`, collection rebase instead of
snapshot restore, full-resync fences, and ordered job/list updates.

The explorer suggested a compact six-phase route. This folder keeps the same
route but splits chat/generation, collection domains, and resync/navigation
into separate phase files so future implementation agents can take smaller
handoff slices.

## Source Audits

Each consolidated source contains a baseline inventory, verification audit,
and stale-state assessment:

- [`overview.md`](../audit-records/overview.md)
- [`chat-and-messages.md`](../audit-records/chat-and-messages.md)
- [`character-editor.md`](../audit-records/character-editor.md)
- [`sidebar-chat-lists.md`](../audit-records/sidebar-chat-lists.md)
- [`presets-personas-loadouts-prompts.md`](../audit-records/presets-personas-loadouts-prompts.md)
- [`lorebooks-scripts-modules-plugins.md`](../audit-records/lorebooks-scripts-modules-plugins.md)
- [`settings-and-provider-fields.md`](../audit-records/settings-and-provider-fields.md)
- [`assets-imports-backups-memory.md`](../audit-records/assets-imports-backups-memory.md)

## Source Anchors

- Shared command and settings paths:
  `src/ts/server/commands.ts`, `src/ts/server/settingsBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`, `src/ts/chatCommands.ts`,
  `server/fastify/src/routes/commands.ts`.
- Chat, message, generation, and reroll paths:
  `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/lib/ChatScreens/Chat.svelte`,
  `src/lib/ChatScreens/PartialEditController.svelte`,
  `src/lib/ChatScreens/RerollList.svelte`,
  `src/lib/ChatScreens/Suggestion.svelte`,
  `src/ts/process/request/serverChat.ts`,
  `server/fastify/src/routes/generationChat.ts`.
- Character and sidebar paths:
  `src/lib/SideBars/CharConfig.svelte`,
  `src/lib/SideBars/SideChatList.svelte`,
  `src/lib/Others/ChatList.svelte`,
  `src/ts/characters.ts`.
- Preset, persona, prompt, loadout, lore, module, plugin, and settings paths:
  `src/lib/Setting/`, `src/lib/UI/PromptDataItem.svelte`,
  `src/ts/process/modules.ts`, `src/ts/plugins/`.
- Asset, import, backup, memory, and projection paths:
  `src/ts/server/assets.ts`, `src/ts/server/backups.ts`,
  `src/ts/server/realmImport.ts`, `src/ts/server/projectionResync.ts`,
  `src/ts/process/request/serverMemory.ts`,
  `server/fastify/src/routes/save.ts`,
  `server/fastify/src/routes/backups.ts`,
  `server/fastify/src/routes/realmImport.ts`,
  `server/fastify/src/routes/memoryJobs.ts`.

For current repo navigation, read
[`../../../../STRUCTURE.md`](../../../../STRUCTURE.md) and the focused files
under [`../../../../docs/structure/`](../../../../docs/structure/).
