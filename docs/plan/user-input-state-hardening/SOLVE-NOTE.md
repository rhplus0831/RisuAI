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

## Explorer Result Summary

The explorer confirmed that Phase 0 is still open and implementation has not
formally started in this workstream. Some existing code already contains related
narrow rollback patterns; use those as baseline examples, not as proof that the
hardening work is complete.

Immediate scope:

1. Complete Phase 0 contract and baseline documentation.
2. Start Phase 1 shared stale-state primitives only after Phase 0 decisions are
   recorded.
3. Do not jump directly to upload, chat UI, generation, or collection-domain
   callbacks until shared helper contracts are in place.

Known path correction:

- Phase docs mention `src/ts/process/rerollNavigation.ts`; the current file is
  `src/ts/process/rerollNavigation.svelte.ts`.

## Phase 0 Plan

Finish Phase 0 as a documentation and contract slice.

Update:

- `docs/plan/user-input-state-hardening/phases/phase-0-contract-and-baseline.md`
- `docs/plan/user-input-state-hardening/status.md`
- `docs/plan/user-input-state-hardening/latest-verification.md`

Record:

- Helper owner and names:
  - `src/ts/server/staleStateGuards.ts`
  - latest-operation token helpers
  - attempted-value rollback helpers
  - keyed-list rollback helpers
  - dirty-draft projection merge helpers
  - explicit destructive refresh marker/helper
- Baseline source-row corrections from Phase 0.
- First P0 fixture targets:
  - dirty projection
  - composer/file callback
  - reroll active-chat guard
  - character asset upload
  - generation finalization freshness
- Existing tests to extend and new focused test names.

Phase 0 validation:

```bash
pnpm exec prettier --check 'docs/plan/user-input-state-hardening/**/*.md'
```

## Phase 1 Plan

After Phase 0 lands, add shared primitives and focused tests.

Likely files:

- `src/ts/server/staleStateGuards.ts`
- `src/ts/server/staleStateGuards.test.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/characterBridge.svelte.ts`
- `src/ts/chatCommands.ts`
- `src/ts/server/commands.test.ts`
- `src/ts/chatCommands.test.ts`

Implementation sequence:

1. Add pure helpers for latest operation tokens, attempted-field rollback,
   keyed-list rollback, and dirty-draft merge.
2. Cover helpers with focused tests before converting domain code.
3. Refactor settings and character rollback callers to use shared attempted
   rollback without intentional behavior expansion.
4. Add a Phase 1 adapter for chat/message rollback so whole-chat restore paths
   can move toward attempted-value checks.
5. Record any remaining broad rollback families in `status.md` with the phase
   that owns them.

Phase 1 validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Later Phase Order

Proceed in this order unless a verification result proves a dependency needs to
move earlier:

1. Phase 2 dirty draft projection.
2. Phase 3 upload, import, and fetch callbacks.
3. Phase 4 chat, message, reroll, trigger, suggestion, and generation
   freshness.
4. Phase 5 collection-domain rollback and projection hardening.
5. Phase 6 resync, memory, restore/import, and navigation fences.
6. Phase 7 final verification and closeout.

Each phase should end with focused tests or an explicit residual gap recorded in
`status.md` and latest proof recorded in `latest-verification.md`.
