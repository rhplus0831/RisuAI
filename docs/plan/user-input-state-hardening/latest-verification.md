# Latest Verification

Date: 2026-06-18

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 6 Realm import finish refresh fencing
  and latest-operation post-refresh navigation/progress guard. The run validates
  that server-backed Realm import completion uses
  `forceServerProjectionResync('realm-import')`, avoids the old direct bootstrap
  apply/reset path, still resyncs after stale server commits, blocks stale
  progress/navigation/completion/error UI, and reports latest-operation resync
  failures without navigating.
- Commands:

```bash
pnpm exec vitest run src/ts/characterCards.realmImport.test.ts src/ts/characterCards.pngImport.test.ts src/ts/server/projectionResync.test.ts src/ts/server/realmImport.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --write src/ts/characterCards.ts src/ts/characterCards.realmImport.test.ts src/ts/characterCards.pngImport.test.ts docs/plan/user-input-state-hardening/SOLVE-NOTE.md docs/plan/user-input-state-hardening/status.md docs/plan/user-input-state-hardening/latest-verification.md docs/plan/user-input-state-hardening/phases/phase-6-resync-memory-navigation.md
pnpm exec prettier --check src/ts/characterCards.ts src/ts/characterCards.realmImport.test.ts src/ts/characterCards.pngImport.test.ts docs/plan/user-input-state-hardening/SOLVE-NOTE.md docs/plan/user-input-state-hardening/status.md docs/plan/user-input-state-hardening/latest-verification.md docs/plan/user-input-state-hardening/phases/phase-6-resync-memory-navigation.md
git diff --check
```

- Result: passed on 2026-06-18. The focused Realm/PNG/projection/Realm adapter
  Vitest set passed 14 tests across 4 files. Both TypeScript checks passed.
  Prettier write/check and `git diff --check` passed.
- Residual gaps: Phase 6 remains in progress. Memory job terminal/cancel
  ordering is covered for list refreshes, cached `not-modified` refreshes, SSE
  job updates, and Hypa V3 progress side effects. Backup restore and local
  bundle import now share latest-request fenced full projection resyncs. Realm
  import finish refresh now uses that helper with latest-operation UI guards.
  Character/chat import refresh/navigation edges, route hydration races, the
  `changeChar()` shell hydration/selection race, welcome/onboarding delayed
  setup, and DevTool autopilot active-chat locking remain Phase 6 work. The
  known pre-existing `src/ts/compatibilityAdapters.test.ts` failure at line 626
  remains separate.

## Remaining Proof

- Phase 4 is complete. Composer file and paste callbacks are already covered by
  Phase 3, composer send/continue clear/restore plus auto-translate freshness is
  covered by the first Phase 4 slice, reroll active-chat freshness is covered by
  the second Phase 4 slice, partial edit/delete modal freshness is covered by the
  third Phase 4 slice, suggestion persistence freshness is covered by the fourth
  Phase 4 slice, attempt-aware chat-scoped message rollback is covered by the
  fifth Phase 4 slice, durable generation finalization freshness is covered by
  the sixth Phase 4 slice, and dynamic rendered button trigger freshness is
  covered by the seventh Phase 4 slice.
- Phase 5 is complete. Script/trigger replacement rollback is covered by the first
  Phase 5 slice, plugin custom storage rollback is covered by the second Phase 5
  slice, plugin non-storage field/delete/provider rollback is covered by the
  third Phase 5 slice, plugin collection/full-plugin rollback is covered by the
  fourth Phase 5 slice, global module command rollback is covered by the fifth
  Phase 5 slice, MCP module-info rollback is covered by the sixth Phase 5 slice,
  plugin DB bridge settings rollback is covered by the seventh Phase 5 slice,
  persona create/delete/reorder rollback is covered by the eighth Phase 5 slice,
  translator preset collection command rollback is covered by the ninth Phase 5
  slice, and prompt-template item create/delete/reorder rollback is covered by
  the tenth Phase 5 slice. Split prompt/model preset array rollback is covered
  by the eleventh Phase 5 slice. Legacy bot preset rollback is covered by the
  twelfth Phase 5 slice. Persona residual command rollback is covered by the
  thirteenth Phase 5 slice. Scoped lorebook entry replacement rollback is
  covered by the fourteenth Phase 5 slice. Top-level global lorebook list
  rollback is covered by the fifteenth Phase 5 slice. MCP module lorebook,
  regex, and Lua-trigger rollback is covered by the sixteenth Phase 5 slice.
  MCP character regex and Lua-trigger rollback is covered by the seventeenth
  Phase 5 slice. `applyModule()` multi-domain rollback is covered by the
  eighteenth Phase 5 slice. Chat folder command rollback is covered by the
  nineteenth Phase 5 slice. Chat list create/delete/reorder rollback is covered
  by the twentieth Phase 5 slice. Character sidebar order/folder metadata
  rollback is covered by the twenty-first Phase 5 slice. Character list
  create/delete/import rollback is covered by the twenty-second Phase 5 slice.
  Hypa V3 preset array rollback is covered by the twenty-third Phase 5 slice.
  Combined sidebar chat/folder reorder rollback is covered by the twenty-fourth
  Phase 5 slice. Chat fork rollback is covered by the twenty-fifth Phase 5
  slice. Chat metadata PATCH rollback is covered by the twenty-sixth Phase 5
  slice. Chat import flow rollback is covered by the twenty-seventh Phase 5
  slice. Lorebook import target freshness is covered by the twenty-eighth Phase
  5 slice. Plugin import/update runtime reload ordering is covered by the
  twenty-ninth Phase 5 slice. Server-backed sidebar chat-folder creation
  optimism and failed-create rollback are covered by the thirtieth Phase 5
  slice. Loadout create/delete/favorite/apply rollback is covered by the
  thirty-first Phase 5 slice. Plugin compatibility bridge scoped rollback is
  covered by the thirty-second Phase 5 slice. Multi-group plugin settings
  rollback is covered by the thirty-third Phase 5 slice. Closeout exploration
  found no live broad collection rollback blocker remaining in the Phase 5
  domains.
- Phase 6 is in progress. Memory job terminal/cancel ordering is covered by the
  first Phase 6 slice, backup/local bundle full projection resync latest-request
  fencing is covered by the second slice, and Realm import finish refresh
  fencing plus latest-operation navigation/progress guards are covered by the
  third slice. Character/chat import refresh/navigation edges, route hydration
  races, the `changeChar()` shell hydration/selection race, welcome/onboarding
  delayed setup, and DevTool autopilot active-chat locking remain open.
- Phase 7 owns final workstream regression, browser smoke where needed, and
  TypeScript proof.

## Validation Commands

Use phase-specific focused subsets while developing. Phase 6 is in progress;
Phase 7 owns the final workstream command matrix.
