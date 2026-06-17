# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 EasyPanel separate-parameters import
  callback freshness. `AllSeperateParameters` now starts guarded import tokens
  from `selectSingleFile`'s `onFileSelected` hook after a real JSON file is
  selected, while `EasyPanel` captures explicit base/override slot context and
  applies fresh imports only to the active target slot.
- Commands:

```bash
pnpm exec vitest run src/ts/server/seperateParametersImport.test.ts src/lib/Others/ProTools/EasyPanel.svelte.test.ts src/lib/Others/AllSeperateParameters.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The separate-parameters-import/stale-guard
  focused Vitest set passed 4 files and 25 tests. Both TypeScript checks and
  `git diff --check`
  passed.
- Residual gaps: Svelte wiring coverage is source-inspection style rather than a
  browser interaction test. This slice does not cover backup/Realm refresh
  fences or collection rollback.

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

Use phase-specific focused subsets while developing. Phase 3 is active and owns
upload/import/fetch callback validation. Phase 7 owns the final workstream
command matrix.
