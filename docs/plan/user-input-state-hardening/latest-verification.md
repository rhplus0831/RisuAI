# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 character emotion image upload
  freshness. `addCharEmotion` now captures the target character id, row index,
  and emotion image list snapshot before the picker, issues a latest-operation
  token only after selected files exist, uploads into local entries, and appends
  plus dispatches only when the selected row and live emotion list are still
  fresh.
- Commands:

```bash
pnpm exec vitest run src/ts/server/characterEmotionUpload.test.ts src/ts/characters.imageEmotion.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The emotion-upload/avatar/stale-guard focused
  Vitest set passed 3 files and 27 tests. Both TypeScript checks and
  `git diff --check` passed.
- Residual gaps: coverage is focused unit/mocked integration coverage, not a
  mounted character-config browser flow. Stale uploaded asset bytes may remain
  orphaned if an operation is dropped. This slice does not cover emotion-name
  dirty projection, remove-emotion projection races, GPT-SoVITS reference audio
  upload, VITS model registration, settings media uploads, plugin import/update,
  import helpers, or remaining dashboard/import persistence surfaces.

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
