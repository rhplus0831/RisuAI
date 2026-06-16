# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 1 closeout. Shared helpers exist with
  focused coverage, and settings, character, and chat row metadata rollback
  adopters have landed.
- Commands:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The client focused Vitest set passed 3 files and
  94 tests. The Fastify command Vitest set passed 2 files and 138 tests. Both
  TypeScript checks passed.
- Residual gaps: `restoreChatScopedState` and message
  update/delete/truncate/replace freshness are explicitly deferred to Phase 4.
  Broader collection rollback remains Phase 5. No code gap blocks Phase 1
  completion. Future adopters must pass cloned JSON-safe `previous` and
  `attempted` values; mutable live references would weaken stale-skip
  guarantees.

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
