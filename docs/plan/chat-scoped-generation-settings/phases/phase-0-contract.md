# Phase 0: Contract

Status: complete. Contract only; avoid runtime behavior changes except narrow
type/helper scaffolding if needed to prove the contract.

Goal: lock the chat-owned generation settings contract before implementation.
This phase removes ambiguity around field names, readiness, displayed-toggle
resolution, import behavior, delete invalidation, and structured errors.

## Scope

- Choose the durable chat settings field name and exact nested field names.
- Define the readiness resolver shared by server and client tests.
- Define how to enumerate "all toggles displayed in the sidebar" for a chat.
- Define the structured error returned when a chat is incomplete.
- Decide whether persona/preset deletion clears matching chat references at
  write time or leaves them present but invalid at read time.
- Document import and fork policies before changing import code.

## Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/chatCommands.ts`
- `server/fastify/src/commands/chats.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/CustomSidebar.svelte`

## Target Shape

- Durable chat object:
  `generationSettings: { configured, personaId, presetId, jailbreakToggle, sidebarToggles }`.
- Shared helper:
  `src/ts/chatGenerationSettings.ts`.
- Shared tests:
  `src/ts/chatGenerationSettings.test.ts`.
- `configured: true` is a user-confirmation marker. It never bypasses live
  validation against the current persona, preset, and toggle definitions.
- Sidebar toggle values are stored as raw strings equivalent to the existing
  `globalChatVariables["toggle_<key>"]` values. The `sidebarToggles` keys are
  unprefixed syntax keys such as `mode`, not `toggle_mode`. `jailbreakToggle`
  is stored separately.
- Readiness returns both a boolean and missing reasons so UI and server errors
  can agree without parsing text.
- The server error shape is fixed as `409 chat_generation_settings_incomplete`
  with missing field/reason codes.

## Phase 0 Decisions

The readiness helper exports:

- `CHAT_GENERATION_SETTINGS_FIELD = 'generationSettings'`.
- `ChatGenerationSettings`.
- `resolveChatGenerationControlRequirements()`.
- `resolveRequiredSidebarToggles()`.
- `resolveChatGenerationSettingsReadiness()`.
- `createChatGenerationSettingsIncompleteError()`.

`resolveChatGenerationSettingsReadiness()` returns:

```ts
{
  ready: boolean,
  missing: ChatGenerationSettingsMissingReason[],
  requirements: ChatGenerationControlRequirements,
  staleSidebarToggleKeys: string[]
}
```

Missing reason codes are stable:

```ts
settings_missing
settings_not_configured
persona_id_missing
persona_missing
preset_id_missing
preset_missing
jailbreak_toggle_missing
jailbreak_toggle_invalid
sidebar_toggles_missing
sidebar_toggle_missing
sidebar_toggle_invalid
```

The incomplete-chat error body is:

```ts
{
  statusCode: 409,
  error: 'chat_generation_settings_incomplete',
  message: 'Chat generation settings are incomplete',
  chatId?: string,
  missing: ChatGenerationSettingsMissingReason[],
  staleSidebarToggleKeys: string[]
}
```

The required sidebar control resolver has one owner in the shared helper. It:

- resolves the selected preset by `generationSettings.presetId`;
- reads only the selected preset's `customPromptTemplateToggle` for preset
  toggles;
- appends active module toggles from global enabled module ids, chat module
  ids, character module ids, and `moduleIntergration` namespaces;
- matches modules by `id` or `namespace` in module collection order;
- ignores group, groupEnd, caption, and divider rows because they are not
  prompt-affecting stored controls;
- dedupes required toggle definitions by unprefixed storage key, preserving the
  first definition;
- treats explicit raw off values such as `'0'` and `''` as complete only when
  the key exists;
- reports unknown stored keys as `staleSidebarToggleKeys` without making the
  chat incomplete.

`jailbreakToggle` remains a separate required chat-owned field. The helper also
reports whether the selected preset would currently display the jailbreak
control, using the existing sidebar rule: a missing prompt template falls back
to non-empty `preset.jailbreak`, while a prompt template displays the control
when it has a `jailbreak` card or uses `{{jbtoggled}}` in a supported text
field.

## Lifecycle Policies

- New chats start incomplete unless their creator supplies an explicit
  configured `generationSettings` payload.
- Persona and preset deletion does not rewrite every affected chat. Existing
  references remain stored and become incomplete at read time via
  `persona_missing` or `preset_missing`; only the affected chat is repaired
  when the user saves new settings for it.
- Module or sidebar toggle deletion leaves stale `sidebarToggles` keys inert.
  They are ignored for readiness and pruned on the next settings save. Toggle
  rename is delete plus add, so existing chats become incomplete until the new
  key is confirmed.
- Imports of `.risu`, bundles, JSON database payloads, character cards, and
  Realm-created chats may preserve source values for UI prefill, but imported
  chats must be incomplete until local user confirmation. Import must not infer
  readiness from source or local global `botPresetsId`, `selectedPersona`,
  `globalChatVariables`, or `jailbreakToggle`.
- Fork/copy preserves the source chat's `generationSettings`, including
  completeness, unless a caller supplies an explicit override.
- Exact backup restore preserves the repository state, including configured
  chat settings, because restore is not an import. Any user-facing
  backup-like path that merges content as an import follows the import policy
  and requires confirmation.

## Invariants

- Missing and explicit off are different. `false`, `0`, `""`, or the raw off
  value count only when the relevant key exists on the chat settings object.
- Legacy `bindedPersona` can prefill UI but does not make a chat complete.
- No global field is a fallback for readiness.
- A preset change can change the required toggle set; existing chats become
  incomplete until reviewed if they lack a newly required displayed toggle.
- Imported chats are incomplete until local user confirmation.

## Exit Criteria

- The exact TypeScript shape is named in code or in a final Phase 0 note.
- The required-toggle resolver has one owner and test fixtures for preset,
  module, jailbreak, missing, stale, and explicit-off cases.
- The incomplete-chat error shape is fixed for server and client tests.
- Delete, import, fork, and backup-restore policies are written down in this
  phase file or linked follow-up notes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts
pnpm exec vitest run src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Use the smallest useful subset while the phase is contract-only, then run the
full TypeScript workflow before closing any scaffolding patch.

## Risks

- Toggle enumeration can drift if UI and server each invent their own resolver.
  Prefer one shared contract plus mirrored focused tests.
- A stored `configured` flag can become misleading. Every caller must treat it
  as confirmation history, not as readiness by itself.
