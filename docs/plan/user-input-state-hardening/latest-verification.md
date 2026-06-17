# Latest Verification

Date: 2026-06-17

This file will hold the latest validation proof for the user input state
hardening workstream.

## Latest Run

- Runtime/code change under test: Phase 2 closeout for dirty draft projection.
  Closeout covers the landed dirty projection slices for character profile
  drafts, prompt-template item rows, generic server-backed setting drafts,
  selected persona profile fields, translator preset
  `name`/`prompt`/`maxResponse` fields, lorebook entry drafts, and
  selected-character script/trigger live local draft rows.
- Closeout result: PASS/CLOSEABLE on 2026-06-17. The closeout explorer accepted
  the landed slices and confirmed the remaining surfaces are explicit later-phase
  deferrals rather than Phase 2 blockers.
- Phase 2 validation command matrix:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/lib/Setting/Pages/PersonaSettings.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Latest implementation validation result: the final Phase 2 live local draft
  focused run passed on 2026-06-17. That run covered
  `src/ts/server/lorebookBridge.svelte.test.ts`,
  `src/ts/server/scriptDefinitionBridge.svelte.test.ts`, and
  `src/ts/server/staleStateGuards.test.ts`, passing 3 files and 109 tests. Both
  TypeScript checks passed.
- Residual gaps by owner phase: create/delete/reorder/import/select and broad
  collection rollback stay in Phase 5; upload/import/fetch callbacks stay in
  Phase 3; chat/message/generation freshness stays in Phase 4;
  resync/import/restore/navigation/memory stays in Phase 6; module/plugin
  surfaces stay in Phase 5 for broad rollback/collection/storage/provider/arg
  behavior and Phase 3 for import/update/fetch/upload callbacks. Submit-only
  module drafts do not block Phase 2.
- Projection-absent optional clean-field deletion remains outside Phase 2
  because the shared merge helper refreshes fields present in the projection
  surface.

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

Use phase-specific focused subsets while developing. Phase 3 is the next active
phase and owns upload/import/fetch callback validation. Phase 7 owns the final
workstream command matrix.
