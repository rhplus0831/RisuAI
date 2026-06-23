# Latest Verification

Date: 2026-06-23

Phase 1 effective prompt template resolver implementation has focused automated
coverage after the author-note resolver parity fix. No UI smoke was run because
this slice did not change live editor workflows.

## Current Proof

- Source exploration completed.
- Plan folder created under `docs/prompt-template-ownership-cleanup`.
- Runtime prompt template reads now resolve through the effective
  prompt-preset owner before top-level fallback.
- Focused browser/server precedence tests landed for prompt preset ownership,
  chat-scoped override, no-template disabling, legacy bot preset non-ownership,
  and no mutation during normalization.
- Server author-note defaults now use the chat-scoped prompt preset ID before
  considering global or top-level templates.
- Prompt Settings warnings still validate the editable top-level draft template;
  owner-aware UI validation remains deferred to Phase 3.

## Phase 1 Resolver Fix Validation

Run on 2026-06-23:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/staticSections.test.ts
pnpm exec vitest run src/ts/process/__tests__/normalizeTemplate.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/templates.test.ts
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

- No browser smoke yet; defer until a phase changes the live settings workflow.
- Prompt item command/projection/editor ownership remains unverified because it
  is out of scope for Phase 1.
