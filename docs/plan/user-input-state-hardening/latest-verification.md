# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 settings media asset upload freshness.
  `OtherBotSettings.svelte` now guards the NovelAI character reference image,
  NovelAI i2i base image, and WaveSpeed reference image uploads with captured
  target/context/field snapshots, latest-operation tokens issued only after real
  file selection, freshness checks around `saveAsset`, and narrow merges into the
  active settings draft.
- Commands:

```bash
pnpm exec vitest run src/ts/server/settingsMediaAssetUpload.test.ts src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The settings-media/stale-guard focused Vitest
  set passed 3 files and 21 tests. Both TypeScript checks and `git diff --check`
  passed.
- Residual gaps: coverage is source-contract plus helper unit coverage, not a
  mounted browser interaction test. Dropped stale uploads may still leave
  orphaned asset bytes after `saveAsset`. This slice does not cover `.naiv4vibe`
  import, HypaV3 preset import, custom color scheme import, additional params
  import, GPT-SoVITS reference audio upload, VITS model registration, plugin
  import/update, or remaining general import helpers.

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
