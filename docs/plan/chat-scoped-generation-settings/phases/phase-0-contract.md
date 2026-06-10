# Phase 0: Contract

Status: planned. Contract only; avoid runtime behavior changes except narrow
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

- Candidate chat object:
  `generationSettings: { configured, personaId, presetId, jailbreakToggle, sidebarToggles }`.
- `configured: true` is a user-confirmation marker. It never bypasses live
  validation against the current persona, preset, and toggle definitions.
- Sidebar toggle values are stored as raw strings equivalent to the existing
  `globalChatVariables["toggle_<key>"]` values. `jailbreakToggle` is stored
  separately unless Phase 0 proves it should be normalized into the same map.
- Readiness returns both a boolean and missing reasons so UI and server errors
  can agree without parsing text.
- The server error shape should be stable enough for client UX, for example:
  `409 chat_generation_settings_incomplete` with missing field/reason codes.

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
