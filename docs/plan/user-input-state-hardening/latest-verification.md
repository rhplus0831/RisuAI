# Latest Verification

Date: 2026-06-17

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 5 combined sidebar chat/folder reorder
  rollback. Folder-drag reorder now dispatches folder and chat reorders through
  a focused helper that rolls back attempted folder order only before the folder
  command is accepted, and rolls back attempted chat order/folder assignments
  without restoring broad chat state snapshots. Delayed failures preserve newer
  chat/folder row edits and keep accepted folder reorder results when a later
  chat reorder fails.
- Commands:

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/lib/SideBars/SideChatList.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --check src/ts/chatCommands.ts src/ts/chatCommands.test.ts src/lib/SideBars/SideChatList.svelte src/lib/SideBars/SideChatList.svelte.test.ts
git diff --check
```

- Result: passed on 2026-06-17. Chat command plus focused sidebar chat-list
  coverage passed 82 tests across 2 files, and both TypeScript checks plus
  Prettier and `git diff --check` passed.
- Additional check: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts`
  still fails in the pre-existing character MCP lorebook test
  `routes MCP character lorebook writes through lorebook commands in
  server-backed web mode` at `src/ts/compatibilityAdapters.test.ts:626`.
  A detached baseline worktree at commit `30d4ad7ab` reproduced the same
  failure before this slice, so it is tracked as out-of-scope for this combined
  sidebar reorder rollback change.
- Residual gaps: Multi-group plugin settings patch failures still share the
  generic settings rollback
  callback and roll back all still-attempted keys from the failed patch. Plugin
  import/update side-effect reload is not fully modeled by rollback. Full
  `ScriptDefinitionStateSnapshot` rollback remains broad for rarer discrete
  callers. Regex delete uses the same scoped module script dispatcher and has
  optimistic visibility coverage, but this slice does not add a dedicated
  failing delete rollback/stale-skip test. The remaining Phase 5 collection
  domains still need focused slices: sidebar collection rollback and replacement
  flows, broader lorebook import/navigation edges, chat import/fork flows, and
  residual sidebar/import replacement paths. Translator preset import
  file-read/decode freshness does not have dedicated coverage, but its
  command-dispatch failure path uses the now rollback-free create dispatcher.
  Prompt-template item rollback coverage does not explicitly cover delete skip
  when the row already exists or out-of-bounds insert-index clamping, though the
  implementation guards both. Split preset array coverage is representative but
  not exhaustive for every mirrored model/prompt operation pair; prompt import
  is covered and no client-side model import caller was found. Hypa V3 rollback
  targets the array shapes emitted by the current controls and does not model
  arbitrary reorder or multi-row transforms.

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
  Phase 5 slice.
  Remaining Phase 5 work owns sidebar/import collection flows, broader lorebook
  import/navigation edges, plugin import/update side-effect reload, and chat
  import/fork flows.
- Phase 6 owns Realm/backup/local bundle restore/import resyncs, character/chat
  import refresh/navigation edges, memory job list/progress ordering,
  route/selection hydration, welcome/onboarding delayed setup, and DevTool
  autopilot long-loop chat targeting.
- Phase 7 owns final workstream regression, browser smoke where needed, and
  TypeScript proof.

## Validation Commands

Use phase-specific focused subsets while developing. Phase 5 is now active;
Phase 7 owns the final workstream command matrix.
