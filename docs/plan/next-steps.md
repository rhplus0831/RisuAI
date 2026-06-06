# Next Steps

Date: 2026-06-06

Phases 1-3 and Phase 8 are implemented and proof-refreshed in this branch.
The next remaining branch-local fix batch is Phase 4.

## Completed Batch: Phase 8 (Server Jobs, Memory & Import Bounds)

Server-bound work is complete and proof-refreshed: L1, L2, L15, and L17-L31
are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 8 proof refresh
passed focused server-bound suites (17 files / 297 tests), the v2 gate
(18 tests), `pnpm api:test` (1846 passed / 1 skipped), and both TypeScript
checks. See [`latest-verification.md`](latest-verification.md).

## Next Batch: Phase 4 (Client Clone Narrowing Ring 2)

Client clone narrowing ring 2 is defined in
[`phases/phase-4-client-clone-ring-2.md`](phases/phase-4-client-clone-ring-2.md):

1. M7 replace-all message patch no clone
   ([slice](phases/slices/phase-4-client-clone-ring-2/replace-all-message-patch-no-clone.md)):
   assign private `replace_all` message arrays without recloning the
   transcript.
2. M8 plugin storage key read snapshot
   ([slice](phases/slices/phase-4-client-clone-ring-2/plugin-storage-key-read-snapshot.md)):
   read and detach one plugin storage key instead of snapshotting the whole
   database.
3. M9 chat metadata allowed-key diff
   ([slice](phases/slices/phase-4-client-clone-ring-2/chat-metadata-allowed-key-diff.md)):
   diff only allowed chat metadata keys and clone only changed values.
4. M10 module command snapshot narrowing
   ([slice](phases/slices/phase-4-client-clone-ring-2/module-command-snapshot-narrowing.md)):
   split global module and character-module rollback snapshots.
5. L32 send-family targeted chat mutations
   ([slice](phases/slices/phase-4-client-clone-ring-2/send-family-targeted-chat-mutations.md)):
   remove remaining `setDatabase` normalizer calls from send-family slash
   command message edits.
6. L33 remove-char trash single row
   ([slice](phases/slices/phase-4-client-clone-ring-2/remove-char-trash-single-row.md)):
   make trash removal capture only the targeted character row.
7. L34 select supaMemory flag patch
   ([slice](phases/slices/phase-4-client-clone-ring-2/select-supa-memory-flag-patch.md)):
   patch only `supaMemory` when selection auto-enables Hypa V3 memory.
8. L37 language-change same-code cache
   ([slice](phases/slices/phase-4-client-clone-ring-2/language-change-same-code-cache.md)):
   early-return when `changeLanguage` receives the already-applied language
   code.
9. K4 lorebook editor keystroke scope
   ([slice](phases/slices/phase-4-client-clone-ring-2/lorebook-editor-keystroke-scope.md)):
   debounce or scope lorebook entry typing so it no longer clones the whole
   collection per keystroke.
10. Phase 4 verification refresh
    ([slice](phases/slices/phase-4-client-clone-ring-2/phase-4-verification-refresh.md)):
    refresh gates, focused proofs, full validation, and latest verification.

## Guardrails

- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow only
  the hot path under test.
- Rollback correctness is the invariant: every narrowed snapshot needs a
  forced-failure test proving the rollback restores exactly the mutated
  fields.
- M7's `replace_all` payload is already a private deserialized array; do not
  expand this into the longer-term incremental-mutation protocol change.
- L32 may re-gate a send-family command only with a documented reason and
  owner approval.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
client state, rollback, projection guards, or server-backed command behavior.

Client focused runs:

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/moduleCommands.test.ts
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/commands.test.ts
pnpm exec vitest run src/ts/process/__tests__/command.projectionGuard.test.ts
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Optional metric review: clone-cost harness assertions in the focused tests,
`RISU_PROTOCOL_METRICS=1` only when a change crosses the server send path,
and `pnpm analyze:db <input>` for static corpus comparisons.
