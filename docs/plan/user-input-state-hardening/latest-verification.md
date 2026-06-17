# Latest Verification

Date: 2026-06-17

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 5 global module command rollback.
  Global module create, update, delete, enable, reorder, and plugin DB bridge
  module/enabledModules patch commands now use attempted rollback records for
  rows, fields, enabled membership, delete references, and order changes.
  Failed module commands restore only live state that still matches the
  attempted optimistic write, preserve newer sibling and same-target edits, and
  unwind overlapping same-target failures in response order.
- Commands:

```bash
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/plugins/plugins.test.ts src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. Module command/plugin bridge/module UI coverage
  passed 56 tests, client command coverage passed 39 tests, and both TypeScript
  checks plus `git diff --check` passed.
- Residual gaps: the MCP module-info path in
  `src/ts/process/mcp/risuaccess/modules.ts` still uses broad
  `restoreGlobalModuleState(previous)`. Module lorebook/regex/script/trigger
  subdomains remain outside sanitized module update rollback and stay as Phase 5
  residual work. Plugin settings patch rollback still uses the broader
  plugin-state snapshot path, and plugin import/update side-effect reload is not
  fully modeled by rollback. Full `ScriptDefinitionStateSnapshot` rollback
  remains broad for rarer discrete callers. The remaining Phase 5 collection
  domains still need focused slices: preset/persona/translator/lorebook/sidebar
  collection rollback and replacement flows, including create/delete/reorder,
  import, and list-selection paths.

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
  fourth Phase 5 slice, and global module command rollback is covered by the
  fifth Phase 5 slice. Remaining Phase 5 work owns preset/persona/translator,
  module MCP info and module subdomains, lorebook, import collection flows, Hypa
  V3 preset array import/rename/delete, plugin settings patch residuals, and
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
