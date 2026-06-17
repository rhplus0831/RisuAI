# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 sidebar character-folder image upload
  callback freshness. Folder image upload now captures a stable folder id plus
  image-only snapshot, starts the operation from `selectSingleFile`'s
  `onFileSelected` hook after a real image file is selected, rechecks freshness
  around upload/source resolution, resolves by folder id, and applies only fresh
  `{ imgFile, img }` fields.
- Commands:

```bash
pnpm exec vitest run src/ts/server/characterFolderImageUpload.test.ts src/ts/characterCommands.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The folder-image-upload/stale-guard focused
  Vitest set passed 3 files and 60 tests. Both TypeScript checks and
  `git diff --check` passed.
- Residual gaps: no browser-level picker smoke was run. Stale uploads can leave
  unused uploaded asset ids, which is accepted for this slice. This slice does
  not cover sidebar folder/list rollback, prompt/persona imports, module import,
  Realm/backup refresh fences, or collection rollback.

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
