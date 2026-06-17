# Latest Verification

Date: 2026-06-18

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 5 plugin compatibility bridge scoped
  rollback. Plugin V2/V3 compatible character writes now use target-row rollback
  instead of full character-state restore, and V3 compatible chat writes track
  metadata, message, and scriptstate command acceptance so later failures roll
  back only unaccepted attempted effects.
- Commands:

```bash
pnpm exec vitest run src/ts/plugins/plugins.test.ts src/ts/plugins/apiV3/v3.svelte.test.ts src/ts/characterCommands.test.ts src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --check src/ts/characterCommands.ts src/ts/chatCommands.ts src/ts/plugins/plugins.svelte.ts src/ts/plugins/apiV3/v3.svelte.ts src/ts/plugins/plugins.test.ts src/ts/plugins/apiV3/v3.svelte.test.ts src/ts/characterCommands.test.ts src/ts/chatCommands.test.ts docs/plan/user-input-state-hardening/SOLVE-NOTE.md docs/plan/user-input-state-hardening/status.md docs/plan/user-input-state-hardening/latest-verification.md docs/plan/user-input-state-hardening/phases/phase-5-collection-domains.md
git diff --check
```

- Result: passed on 2026-06-18. Focused plugin compatibility bridge coverage
  passed 184 tests across 4 files. Both TypeScript checks plus Prettier and
  `git diff --check` passed.
- Residual gaps: Multi-group plugin settings patch failures still share the
  generic settings rollback callback and roll back all still-attempted keys from
  the failed patch. Full `ScriptDefinitionStateSnapshot` rollback remains broad
  for rarer discrete callers. Regex delete uses the same scoped module script
  dispatcher and has optimistic visibility coverage, but this slice does not add
  a dedicated failing delete rollback/stale-skip test. Chat fork selection
  preservation uses the shared created-chat rollback selection helper, but there
  is no fork-only selection-change regression. Translator preset import
  file-read/decode freshness does not have dedicated coverage, but its
  command-dispatch failure path uses the now rollback-free create dispatcher.
  Prompt-template item rollback coverage does not explicitly cover delete skip
  when the row already exists or out-of-bounds insert-index clamping, though the
  implementation guards both. Split preset array coverage is representative but
  not exhaustive for every mirrored model/prompt operation pair; prompt import
  is covered and no client-side model import caller was found. Hypa V3 rollback
  targets the array shapes emitted by the current controls and does not model
  arbitrary reorder or multi-row transforms. Loadout apply rollback now covers a
  later failed settings command after accepted persona/preset/module steps, but
  does not exhaustively test every split-preset failure position inside
  `applyLoadout()`.

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
- Phase 5 is active. Script/trigger replacement rollback is covered by the first
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
  covered by the thirty-second Phase 5 slice. Remaining Phase 5 work owns
  multi-group plugin settings rollback and any import/sidebar collection
  residuals.
- Phase 6 owns Realm/backup/local bundle restore/import resyncs, character/chat
  import refresh/navigation edges, memory job list/progress ordering,
  route/selection hydration, welcome/onboarding delayed setup, and DevTool
  autopilot long-loop chat targeting.
- Phase 7 owns final workstream regression, browser smoke where needed, and
  TypeScript proof.

## Validation Commands

Use phase-specific focused subsets while developing. Phase 5 is now active;
Phase 7 owns the final workstream command matrix.
