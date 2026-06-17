# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 module asset upload callback
  freshness. The module asset editor now captures the target module id and asset
  list snapshot, issues a latest-operation token only after selected files exist,
  uploads entries locally, and appends to the live module asset list only when
  the open module draft and list snapshot are still fresh.
- Commands:

```bash
pnpm exec vitest run src/ts/server/moduleAssetUpload.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The module-asset/stale-guard focused Vitest set
  passed 2 files and 16 tests, and the module settings Svelte test passed 5
  tests. Both TypeScript checks and `git diff --check` passed.
- Residual gaps: coverage is focused on exported helper behavior plus existing
  module settings component coverage, not a mounted picker/upload loop with
  mocked `selectMultipleFile` and `saveAsset`. Stale asset uploads may still
  complete server-side, but this slice prevents stale client-side module draft
  mutation. Remaining Phase 3 surfaces include character emotion, reference
  audio, and model callbacks; settings media assets; prompt
  icon/background/theme imports; plugin import/update; persona/preset/chat/
  character import helpers; and NanoGPT dashboard fetch persistence. Broad
  module rollback and module import behavior remain Phase 5/Phase 3 deferrals.

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
