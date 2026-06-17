# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 NovelAI `.naiv4vibe` import callback
  freshness. The import now captures provider/model/reference-mode context plus
  vibe-field snapshots, starts the operation from `selectSingleFile`'s
  `onFileSelected` hook after a real vibe file is selected, suppresses stale
  invalid-file alerts, and merges only a fresh narrow vibe patch into
  `NAIImgConfigDraft.value`.
- Commands:

```bash
pnpm exec vitest run src/ts/server/naiVibeImport.test.ts src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The vibe-import/stale-guard focused Vitest set
  passed 3 files and 27 tests. Both TypeScript checks and `git diff --check`
  passed.
- Residual gaps: no browser/manual file-picker smoke was run. This slice does
  not cover EasyPanel separate-parameters import, backup/Realm refresh fences,
  or collection rollback.

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
