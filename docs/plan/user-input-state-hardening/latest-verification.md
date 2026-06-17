# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 2 first implementation slice. Character
  profile drafts now protect dirty top-level fields from stale same-character
  projection reseeds while clean sibling fields still refresh.
- Commands:

```bash
pnpm exec vitest run src/ts/server/characterBridge.svelte.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec vitest run src/ts/characterCommands.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The character bridge/helper Vitest set passed 2
  files and 28 tests; character commands passed 1 file and 43 tests; server/chat
  command tests passed 2 files and 82 tests. Both TypeScript checks passed.
- Residual gaps: this slice only covers character profile drafts in
  `createServerBackedCharacterDraft`. Remaining Phase 2 draft projection
  adopters for prompt settings/items, personas, translator presets, global
  regex/settings drafts, lorebook entries, script/trigger definitions, module
  drafts, and plugin argument/storage editors remain pending. Character
  resync/import/restore and asset callback freshness stay deferred to their
  later phases.

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
