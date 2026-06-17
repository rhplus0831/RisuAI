# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 2 settings draft dirty projection slice.
  Drafts returned by `createServerBackedSettingDraft` now track whole-key dirty
  state, preserve dirty values through stale projection reseeds, reassert dirty
  values back to `DBState.db[key]`, clear dirty state when projection catches up
  with the draft value, and allow later clean projections to reseed normally.
- Commands:

```bash
pnpm exec vitest run src/ts/server/settingsBridge.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The settings bridge/helper Vitest set passed 2
  files and 31 tests; server command tests passed 1 file and 39 tests.
  Both TypeScript checks passed.
- Residual gaps: this slice protects each `createServerBackedSettingDraft`
  instance as a whole setting key; it does not merge clean nested fields inside
  arbitrary object/array settings while preserving dirty nested siblings.
  Remaining Phase 2 draft projection adopters for personas, translator presets,
  lorebook entries, script/trigger definitions, module drafts, and plugin
  argument/storage editors remain pending. Prompt item create, delete, and
  reorder behavior remains unchanged from the previous slice. Character
  resync/import/restore and asset callback freshness stay deferred to their
  later phases.

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
