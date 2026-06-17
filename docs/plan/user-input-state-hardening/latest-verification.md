# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 character additional asset upload
  callback freshness. The character editor and chat quick-add upload paths now
  capture the target character id and additional asset list snapshot, issue a
  latest-operation token only after selected files exist, upload entries locally,
  and append to the live list only when the selected row/draft and list snapshot
  are still fresh.
- Commands:

```bash
pnpm exec vitest run src/ts/server/characterAdditionalAssetUpload.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The additional-asset/stale-guard focused Vitest
  set passed 2 files and 16 tests. Both TypeScript checks and `git diff --check`
  passed.
- Residual gaps: coverage is focused on the component-facing helper behavior
  rather than mounted Svelte component tests. Stale asset uploads may still
  complete server-side, but this slice prevents stale client-side list
  application. Remaining Phase 3 surfaces include character emotion, reference
  audio, and model callbacks; settings media assets; prompt
  icon/background/theme imports; module assets; plugin import/update;
  persona/preset/chat/character import helpers; and NanoGPT dashboard fetch
  persistence.

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
