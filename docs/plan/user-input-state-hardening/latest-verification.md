# Latest Verification

Date: 2026-06-17

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 4 dynamic rendered chat button trigger
  freshness. Rendered `risu-trigger` and `risu-btn` operations now capture the
  active character/chat/message target, use latest-operation tokens, drop stale
  async results, apply accepted results to the captured chat row, and defer
  guarded trigger/Lua chat-var and note side effects into the returned chat.
- Commands:

```bash
pnpm exec vitest run src/lib/ChatScreens/chatButtonTriggerFreshness.test.ts src/lib/ChatScreens/Chat.customHtml.test.ts
pnpm exec vitest run src/ts/process/__tests__/triggers.projectionGuard.test.ts
pnpm exec vitest run src/ts/process/scriptings.test.ts src/lib/ChatScreens/Chat.parserDependencies.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The rendered button helper/custom HTML suite
  passed 2 files and 13 tests; trigger projection-guard coverage passed 1 file
  and 13 tests; scriptings plus parser dependency coverage passed 2 files and
  10 tests. Both TypeScript checks and `git diff --check` passed.
- Residual gaps: no browser smoke was run. Slash-command `/trigger` remains on
  its existing active-chat apply path and is not part of the rendered-button
  slice. Non-chat external trigger effects such as alerts, network calls, and
  image generation are not rolled back once already executed. Suggestion
  freshness remains target/list scoped, not a separate navigation-epoch fence.
  Legacy no-id partial edit/delete fallback cannot distinguish two same-index
  no-id targets with identical source text beyond index/source equality. Reroll
  operation freshness remains scoped to the active target, not to every
  navigation epoch. Auto-translate source freshness is source-text equality
  based.

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
- Phase 5 owns preset/persona/translator/module/lorebook/script/import
  collection flows, Hypa V3 preset array import/rename/delete, plugin
  enable/delete/args/provider/storage, and sidebar/chat/folder/character list
  create/delete/reorder/import rollback.
- Phase 6 owns Realm/backup/local bundle restore/import resyncs, character/chat
  import refresh/navigation edges, memory job list/progress ordering,
  route/selection hydration, welcome/onboarding delayed setup, and DevTool
  autopilot long-loop chat targeting.
- Phase 7 owns final workstream regression, browser smoke where needed, and
  TypeScript proof.

## Validation Commands

Use phase-specific focused subsets while developing. Phase 5 is now active;
Phase 7 owns the final workstream command matrix.
