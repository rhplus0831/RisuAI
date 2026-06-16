# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 1 settings and character rollback
  adoption of `applyAttemptedFieldRollback` in
  `src/ts/server/settingsBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`, and
  `src/ts/characterCommands.ts`, plus focused domain tests.
- Commands:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/characterCommands.test.ts
pnpm exec prettier --write src/ts/server/settingsBridge.svelte.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/server/characterBridge.svelte.ts src/ts/server/characterBridge.svelte.test.ts src/ts/characterCommands.ts src/ts/characterCommands.test.ts
pnpm exec prettier --write docs/plan/user-input-state-hardening/status.md docs/plan/user-input-state-hardening/latest-verification.md
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The focused Vitest set passed 4 files and 82
  tests; Prettier completed for all touched implementation, test, and status
  files; and both TypeScript checks passed.
- Residual gaps: Phase 1 domain adoption remains open for chat/message rollback
  users. Later collection rollback users remain Phase 5. Future adopters must
  pass cloned JSON-safe `previous` and `attempted` values; mutable live
  references would weaken stale-skip guarantees.

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
