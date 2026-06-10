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

The planned durable shape is one chat-owned generation settings object. Phase 0
may adjust the object name to match local conventions, but the contract must
preserve these fields:

```ts
type ChatGenerationSettings = {
  configured?: boolean
  personaId?: string
  presetId?: string
  jailbreakToggle?: boolean
  sidebarToggles?: Record<string, string>
}
```

`configured: true` records that the user explicitly confirmed this chat's
settings. It is not enough by itself. Readiness is always recomputed from the
current database:

- `personaId` resolves to an existing persona.
- `presetId` resolves to an existing preset.
- `jailbreakToggle` is present, including explicit `false`.
- `sidebarToggles` has an explicit raw value for every currently displayed
  prompt-affecting sidebar toggle for the chat. Explicit off values count when
  the key exists; missing keys do not.
- Unknown or stale toggle keys are ignored and pruned on the next save.

The exact toggle-definition resolver is a Phase 0 deliverable. It must resolve
the selected preset before checking preset-owned toggles, include active
module/sidebar toggles, and treat a newly added displayed toggle as required for
existing chats.

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

Planning is open. Start with Phase 0 before runtime implementation. Re-check
the cited symbols before editing; the investigation line numbers were current
when this plan was written but will drift.

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
