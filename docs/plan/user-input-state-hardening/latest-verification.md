# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 2 live local draft dirty projection
  slice. Lorebook entry drafts now preserve dirty local fields through stale
  same-entry projection while clean fields refresh. Selected-character
  script/trigger drafts now preserve dirty same-row fields through stale
  projection while clean fields and clean sibling rows refresh. Both paths clear
  dirty state when projection catches up, when the target disappears, or when row
  sequence changes require full reseed semantics.
- Commands:

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The focused Vitest set passed 3 files and 109
  tests. Both TypeScript checks passed.
- Residual gaps: this slice is intentionally limited to dirty projection merging
  for existing lorebook entry drafts and selected-character script/trigger rows.
  Create, delete, reorder, module, plugin, and broad collection rollback
  behavior remains unchanged and stays owned by later phases unless closeout
  triage proves otherwise. Projection-absent optional clean-field deletion is
  outside this slice because the shared merge helper refreshes fields present in
  the projection surface. Character resync/import/restore and asset callback
  freshness stay deferred to their later phases.

## Required Closeout Proof

Before this workstream closes, record:

- Focused tests for shared operation guards, narrow rollback, and dirty draft
  projection merge.
- Focused tests for chat composer/file actions, reroll, partial edits,
  generation finalization, and trigger/suggestion freshness.
- Focused tests for character asset uploads, settings media uploads, prompt
  icon import, custom background/theme import, module asset upload, and plugin
  import/update.
- Focused tests for backup/restore/import refresh fences and memory job event
  ordering.
- Focused tests for collection rollback across presets, personas, loadouts,
  lorebooks, scripts, modules, plugins, sidebar chat/folder lists, and
  character list ordering.
- Focused tests for route hydration, character/chat selection, welcome or
  onboarding delayed setup callbacks, and other navigation-scope refresh
  fences.
- A browser smoke run for the highest-risk interactive flows if unit coverage
  cannot exercise the UI lifetime.
- TypeScript checks:

```bash
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Validation Commands

Use phase-specific focused subsets while developing. Phase 7 owns the final
command matrix.
