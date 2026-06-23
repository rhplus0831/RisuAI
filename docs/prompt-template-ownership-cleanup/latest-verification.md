# Latest Verification

Date: 2026-06-23

Phase 2 prompt-preset-owner-aware prompt item commands/projection/hydration has
focused automated coverage. No browser smoke has been run yet in this slice.

## Current Proof

- Source exploration completed.
- Plan folder created under `docs/prompt-template-ownership-cleanup`.
- Runtime prompt template reads resolve through the effective prompt-preset
  owner before top-level fallback.
- Prompt item command wrappers and Fastify handlers accept optional
  `promptPresetId`.
- Scoped prompt item create/update/delete/reorder/enable validates the selected
  prompt preset owner and persists the owning `prompt_presets` row instead of
  durable `prompt_templates`.
- Prompt item create/delete/reorder and enable capture the selected owner at the
  optimistic edit point, drop stale command construction after owner changes,
  and skip stale rollback when another owner is now visible.
- `promptItem` projection/hydration derives selected/requested
  `promptPresets[].promptTemplate` and clears stale compatibility
  `promptTemplate` when the selected owner has no template.
- Bridge pending prompt item updates are keyed by owner plus item id and stale
  selected-owner debounced edits are dropped before send.
- Focused browser/server precedence tests landed for prompt preset ownership,
  chat-scoped override, no-template disabling, legacy bot preset non-ownership,
  and no mutation during normalization.
- Server author-note defaults now use the chat-scoped prompt preset ID before
  considering global or top-level templates.
- Prompt Settings warnings still validate the editable draft projection; broader
  visual/editor ownership remains deferred to Phase 3.

## Phase 2 Validation

Run on 2026-06-23:

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

All commands passed.

## Future Browser Smoke

Use `pnpm dev:agent` when a phase changes the live settings workflow. Stop the
dev server after smoke so ports `6418` and `6419` are released.

Smoke targets:

- `http://localhost:6418/settings`
- Settings -> Prompt template editor
- Settings -> Bot/Prompt preset picker flows
- Loadout apply path that changes prompt preset selection

## Verification Gaps

- No browser smoke yet; Phase 2 changed live editor plumbing but not the visual
  workflow. Run `pnpm dev:agent` smoke during Phase 3 UI ownership work or
  final Phase 6 closeout.
