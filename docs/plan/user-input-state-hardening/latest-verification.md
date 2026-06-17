# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 3 composer paste/menu file callback
  freshness. `DefaultChatScreen.svelte` now routes menu file and pasted-image
  continuations through a shared guarded apply path that checks a latest-operation
  token, active transcript identity, and composer mutation version before
  mutating `messageInput` or `fileInput`.
- Commands:

```bash
pnpm exec vitest run src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/ts/server/staleStateGuards.test.ts
pnpm exec vitest run src/ts/process/files/multisend.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-17. The chat-screen focused Vitest set passed 2
  files and 23 tests; the multisend focused Vitest file passed 7 tests. Both
  TypeScript checks passed.
- Residual gaps: this slice intentionally avoids Phase 4 send/generation
  freshness beyond invalidating stale file callbacks after composer clear/send.
  Tests cover stale menu results after composer edit and active chat change, plus
  stale paste results after composer edit. Paste-after-chat-switch and
  multi-image one-token behavior were verified by code inspection rather than
  dedicated tests. Remaining Phase 3 surfaces include character assets, settings
  media assets, prompt icon/background/theme imports, module assets, plugin
  import/update, persona/preset/chat/character import helpers, and NanoGPT
  dashboard fetch persistence.

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
