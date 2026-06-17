# Latest Verification

Date: 2026-06-17

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 5 legacy bot preset rollback. Legacy
  preset save, copy, select, create, update, delete, reorder, and extraction
  commands now use attempted row, field, order, selection, generated split row,
  and scalar settings rollback instead of broad preset snapshots. Delayed
  command failures preserve newer sibling rows, same-row edits, split preset
  edits, and changed selection when live state no longer matches the attempted
  optimistic write.
- Commands:

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts
pnpm exec vitest run src/ts/storage/database.importPreset.test.ts
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --check src/ts/storage/database.svelte.ts src/ts/storage/database.svelte.test.ts
git diff --check
```

- Result: passed on 2026-06-17. Legacy preset storage coverage passed 33 tests,
  import-preset coverage passed 3 tests, shared stale-state guard coverage
  passed 12 tests, and both TypeScript checks plus Prettier and
  `git diff --check` passed.
- Additional check: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts`
  still fails in the pre-existing character MCP lorebook test
  `routes MCP character lorebook writes through lorebook commands in
  server-backed web mode` at `src/ts/compatibilityAdapters.test.ts:626`.
  A detached baseline worktree at commit `30d4ad7ab` reproduced the same
  failure before this slice, so it is tracked as out-of-scope for the module-info
  rollback change.
- Residual gaps: module lorebook/regex/script/trigger subdomains remain outside
  sanitized module update rollback and stay as Phase 5 residual work. Multi-group
  plugin settings patch failures still share the generic settings rollback
  callback and roll back all still-attempted keys from the failed patch. Plugin
  import/update side-effect reload is not fully modeled by rollback. Persona
  selection/profile save, prompt trigger updates, icon upload rollback, and
  persona import remain separate residual persona paths. Full
  `ScriptDefinitionStateSnapshot` rollback remains broad for rarer discrete
  callers. The remaining Phase 5 collection domains still need focused slices:
  Hypa V3 preset array import/rename/delete,
  lorebook/sidebar collection rollback and replacement flows, including
  create/delete/reorder, import, and list-selection paths. Translator preset
  import file-read/decode freshness does not have dedicated coverage, but its
  command-dispatch failure path uses the now rollback-free create dispatcher.
  Prompt-template item rollback coverage does not explicitly cover delete skip
  when the row already exists or out-of-bounds insert-index clamping, though the
  implementation guards both. Split preset array coverage is representative but
  not exhaustive for every mirrored model/prompt operation pair; prompt import
  is covered and no client-side model import caller was found.

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
  twelfth Phase 5 slice. Remaining Phase 5 work owns module
  lorebook/regex/script/trigger subdomains, lorebook, import collection flows,
  Hypa V3 preset array import/rename/delete, plugin import/update side-effect
  reload, persona profile/import residuals, and
  sidebar/chat/folder/character list create/delete/reorder/import rollback.
- Phase 6 owns Realm/backup/local bundle restore/import resyncs, character/chat
  import refresh/navigation edges, memory job list/progress ordering,
  route/selection hydration, welcome/onboarding delayed setup, and DevTool
  autopilot long-loop chat targeting.
- Phase 7 owns final workstream regression, browser smoke where needed, and
  TypeScript proof.

## Validation Commands

Use phase-specific focused subsets while developing. Phase 5 is now active;
Phase 7 owns the final workstream command matrix.
