# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 persona icon upload callback
  freshness. `selectUserImg` now captures the selected persona target before the
  picker, starts the upload operation only after a real PNG file is selected,
  rejects stale selection/icon changes before and after image upload, applies
  only fresh icon fields, and captures rollback state immediately before apply
  so same-persona text edits made during upload are preserved.
- Commands:

```bash
pnpm exec vitest run src/ts/server/personaIconUpload.test.ts src/ts/persona.iconUpload.test.ts src/ts/persona.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The persona-icon/stale-guard focused Vitest set
  passed 4 files and 30 tests. Both TypeScript checks and `git diff --check`
  passed.
- Residual gaps: no browser smoke was run for the file picker/upload UI. This
  slice does not cover persona import/create/delete/reorder/select rollback,
  prompt/persona imports, module import, additional params/bias JSON import,
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
