# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 plugin import/update callback
  freshness. `updatePlugin` now starts a plugin import operation before remote
  fetch, checks freshness after fetch/text, and passes the same operation through
  `importPlugin`. `importPlugin` now guards picker/read, validation alerts,
  TypeScript transpile, safety modal, duplicate confirm, and final create/update
  application by latest operation plus plugin-list snapshots.
- Commands:

```bash
pnpm exec vitest run src/ts/server/pluginImport.test.ts src/ts/plugins/plugins.test.ts src/ts/pluginCommands.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

- Result: passed on 2026-06-17. The plugin-import/stale-guard focused Vitest set
  passed 4 files and 48 tests. Both TypeScript checks and `git diff --check`
  passed.
- Residual gaps: stale TypeScript transpile and API 2.1 safety-modal concurrency
  are source-reviewed but do not have direct integration tests. This slice does
  not cover plugin enable/delete/args/provider/storage rollback, prompt/persona
  imports, module import, additional params/bias JSON import, Realm/backup
  refresh fences, or collection rollback.

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
