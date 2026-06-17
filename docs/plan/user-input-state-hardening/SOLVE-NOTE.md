# User Input State Hardening Solve Note

Date: 2026-06-17

## Manager Instruction

The current agent is acting as manager for this workstream. Keep this role even
if context is compressed.

Required process:

1. Read `README.md` and the phase router before choosing work.
2. Spawn an explorer agent to verify task details and determine how to solve the
   next slice.
3. After receiving the explorer result, spawn a worker agent to complete the
   implementation.
4. Once the worker finishes, spawn a verification agent to validate the work.
5. If verification succeeds, run Prettier, run the relevant validation commands,
   commit the changes, close finished agents, and move to the next task.
6. If verification fails, close the failed verification agent and spawn or reuse
   a worker agent to fix the reported issues.
7. Close every sub-agent after its work is complete.

Repository reminders:

- Use `pnpm`.
- Start by reading `STRUCTURE.md` when a new agent needs repo grounding.
- Use `pnpm dev:agent` only when browser/full-stack validation is needed, and
  stop it before finishing.
- Before committing, run Prettier.
- Server type checking requires:

```bash
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Current State

Phase 0, Phase 1, and Phase 2 are complete. Phase 0 locked the contract and
baseline documentation. Phase 1 added shared stale-state helpers with focused
coverage and landed settings, character, and chat row metadata rollback
adopters. Phase 2 landed dirty projection protection for character profile
drafts, prompt-template item rows, generic settings drafts, selected persona
profile fields, translator preset `name`/`prompt`/`maxResponse` fields,
lorebook entry drafts, and selected-character script/trigger draft rows while
keeping clean projection fields refreshed. Phase 3 is in progress; custom
background upload/cancel/error callback freshness has landed.

Next manager loop:

1. Read `README.md`, `STRUCTURE.md`, `status.md`, `latest-verification.md`, and
   `phases/phase-3-upload-import-fetch-callbacks.md`.
2. Spawn an explorer agent for the next Phase 3 upload/import/fetch callback
   slice.
3. Spawn a worker agent for the selected Phase 3 slice, then a verification agent
   after the worker completes.
4. If verification succeeds, run Prettier, run the relevant validation commands,
   commit, close finished agents, and move to the next task.
5. If verification fails, close the failed verification agent and spawn or reuse
   a worker agent to fix the reported issues.

Known path correction:

- Phase docs mention `src/ts/process/rerollNavigation.ts`; the current file is
  `src/ts/process/rerollNavigation.svelte.ts`.

## Completed Phase Proof

Phase 1 closeout validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results: the client focused Vitest set passed 3 files and 94 tests; the Fastify
command Vitest set passed 2 files and 138 tests; both TypeScript checks passed.

Phase 2 closeout validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/lib/Setting/Pages/PersonaSettings.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results: closeout explorer returned PASS/CLOSEABLE on 2026-06-17. The latest
implementation proof for the final Phase 2 live local draft slice passed 3
files and 109 tests, and both TypeScript checks passed.

Explicit deferrals:

- `restoreChatScopedState` remains Phase 4 work.
- Message update/delete/truncate/replace freshness remains Phase 4 work.
- Upload/import/fetch callbacks remain Phase 3 work.
- Chat/message/generation freshness remains Phase 4 work.
- Create/delete/reorder/import/select and broad collection rollback remain Phase
  5 work.
- Module/plugin broad rollback, collection, storage, provider, and argument
  behavior remain Phase 5 work; module/plugin import/update/fetch/upload
  callbacks remain Phase 3 work. Submit-only module drafts do not block Phase 2.
- Resync/import/restore/navigation/memory remain Phase 6 work.
- Projection-absent optional clean-field deletion remains outside Phase 2 because
  the shared merge helper refreshes fields present in the projection surface.

No known code gap blocks Phase 1 or Phase 2 completion.

## Later Phase Order

Proceed in this order unless a verification result proves a dependency needs to
move earlier:

1. Phase 3 upload, import, and fetch callbacks.
2. Phase 4 chat, message, reroll, trigger, suggestion, and generation
   freshness.
3. Phase 5 collection-domain rollback and projection hardening.
4. Phase 6 resync, memory, restore/import, and navigation fences.
5. Phase 7 final verification and closeout.

Each phase should end with focused tests or an explicit residual gap recorded in
`status.md` and latest proof recorded in `latest-verification.md`.
