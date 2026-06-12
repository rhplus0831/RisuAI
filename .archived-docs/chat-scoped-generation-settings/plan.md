# Chat-Scoped Generation Settings

Date: 2026-06-10

## Goal

Make every chat own the generation setup that currently leaks through global
state: persona, bot preset, and all sidebar toggles. A chat is generation-ready
only after the user explicitly confirms a valid `personaId`, a valid
`presetId`, and explicit values for the sidebar toggles displayed for that
chat.

End state:

- Chat rows carry the generation setup needed for sends.
- Server generation, prompt preview, continue, and regenerate block incomplete
  chats before any user message append, prompt mutation, job creation, or
  provider call.
- Server prompt assembly applies the chat's preset/persona/toggles to an
  assembly-only effective database snapshot without persisting global changes.
- Sidebar persona, preset, jailbreak, and prompt/module toggles edit the active
  chat instead of global send scope.
- Imported chats are visible but incomplete until configured again by the user.
- Global persona/preset/toggle settings may remain for library editing and
  compatibility, but not as implicit chat-send defaults.

## Boundary Sources

- User decisions for this workstream:
  - "Toggles" means all toggles displayed in the sidebar.
  - Use `personaId`.
  - Track the selected preset only as `presetId`, not a preset snapshot.
  - Imported chats must also require explicit post-import configuration.
- [`README.md`](README.md) lists the primary source anchors.
- [`status.md`](status.md) owns the current phase router.
- The codebase remains the source of truth when line numbers or docs drift.

## Target Contract

Phase 0 locked the durable chat-owned object name as
`generationSettings`. The shared contract/helper lives at
`src/ts/chatGenerationSettings.ts`.

```ts
type ChatGenerationSettings = {
  configured?: boolean
  personaId?: string
  presetId?: string
  jailbreakToggle?: boolean
  sidebarToggles?: Record<string, string>
}
```

`sidebarToggles` is keyed by the unprefixed sidebar toggle key from toggle
syntax, for example `mode`, not `toggle_mode`. Its values are the raw strings
that will later overlay `globalChatVariables["toggle_<key>"]` for prompt
assembly.

`configured: true` records that the user explicitly confirmed this chat's
settings. It is not enough by itself. Readiness is always recomputed from the
current database:

- `personaId` resolves to an existing persona.
- `presetId` resolves to an existing preset.
- `jailbreakToggle` is present on the settings object, including explicit
  `false`. The shared resolver also reports whether the selected preset would
  currently display the jailbreak control, but readiness still requires an
  explicit chat-owned value so generation never falls back to the global toggle.
- `sidebarToggles` has an explicit raw value for every currently displayed
  prompt-affecting sidebar toggle for the chat. Explicit off values count when
  the key exists; missing keys do not.
- Unknown or stale toggle keys are ignored and pruned on the next save.

The required-toggle resolver is
`resolveChatGenerationControlRequirements()` /
`resolveRequiredSidebarToggles()`. It resolves the selected preset by
`presetId`, reads the selected preset's `customPromptTemplateToggle`, then adds
active module toggles. Active modules are the union of globally enabled module
ids, chat module ids, character module ids, and `moduleIntergration`
namespaces, matched against module `id` or `namespace` in module collection
order. Required toggle keys are deduped by storage key, preserving first
definition. A newly added displayed toggle is therefore required for existing
configured chats.

The stable incomplete-chat error body is:

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

## Invariants

- Server-side enforcement is the source of truth. Client guards improve UX but
  are not the security or correctness boundary.
- No send path may fall back to global `selectedPersona`, `personaPrompt`,
  `botPresetsId`, `globalChatVariables`, or global `jailbreakToggle`.
- Global preset and persona selection commands remain editing/library state;
  they do not alter any chat's configured send scope.
- Preset selection is ID-only. Generation uses the current preset referenced by
  `presetId`; it does not store or compare a preset snapshot.
- A deleted or missing persona, preset, or required toggle definition makes only
  the affected chat incomplete. It must not retarget to a different global or
  default selection.
- Imported chats are incomplete even when legacy globals or future-format
  values are present in the source payload. Import may preserve values for UI
  prefill, but completion requires local user confirmation.
- Fork/copy preserves the source chat's generation settings and completeness
  unless a caller supplies an explicit override.
- Blocked sends must not clear the composer, append an optimistic user message,
  stamp send lifecycle state, create a durable job, call a provider, or
  finalize generation output.

## Phase Overview

- [0. Contract](phases/phase-0-contract.md): lock the field shape, readiness
  resolver, structured errors, deletion/import policies, and helper placement.
- [1. Chat Metadata & Commands](phases/phase-1-chat-metadata-and-commands.md):
  persist, validate, project, and reconcile chat-owned generation settings.
- [2. Effective Generation Config](phases/phase-2-effective-generation-config.md):
  gate server assembly and provider dispatch, then build the scoped database
  overlay.
- [3. UI & Send Gating](phases/phase-3-ui-and-send-gating.md): make sidebar
  controls chat-specific and block before client-side append or lifecycle work.
- [4. Import, Delete & Fork Edges](phases/phase-4-import-delete-fork-edges.md):
  normalize imported/new chats and handle reference churn.
- [5. Verification](phases/phase-5-verification.md): prove server, client,
  import, projection, and TypeScript coverage.

## Execution Cursor

Phase 5 is complete. The closeout proof is recorded in
[`latest-verification.md`](latest-verification.md). This workstream was archived
on 2026-06-11 under `.archived-docs/chat-scoped-generation-settings/`.

## Not In This Plan

- No SQLite schema migration unless Phase 1 proves `chats.data_json` cannot
  carry the settings object.
- No preset snapshot or historical preset replay.
- No automatic backfill from global persona, preset, or toggle settings.
- No removal of legacy/global editor state unless a later cleanup explicitly
  schedules it.
- No broad UI redesign beyond the controls needed to configure the active chat.
- No browser-local generation path revival; server-side prompt assembly remains
  the supported send path.
