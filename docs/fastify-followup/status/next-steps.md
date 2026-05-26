# Next Steps

Date: 2026-05-27

Use this file as the pickup runbook for the reopened audit work. The
phase files under `../phases/` hold source evidence and exit criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

Pick one slice per work session. Each slice should leave the worktree in
a reviewable state with focused tests, update the affected phase file,
and add any longer closeout note under `../phases-completed/`.

1. Phase 9 client thinning remains first because it protects all
   Fastify-served browser work from silent client persistence.
   - 9A-9H landed on 2026-05-26; 9I landed on 2026-05-27. Commit
     anchors are in `../status.md`.
   - 9J (next): final direct-write sweep, allowlist gaps, browser smoke, and
     Phase 9 closeout.

2. Phase 7 prompt assembly can proceed slice-by-slice after or alongside
   Phase 9 slices that touch the same browser chat path.
   - 7A: browser regenerate request wiring.
   - 7B: server regenerate assembly semantics.
   - 7C: `/chat` provider dispatch guards.
   - 7D: stop-trigger mutation payload delivery.
   - 7E: route-backed fixture coverage for send, continue, regenerate,
     preview, and preview-prompt.

3. Phase 8 memory ownership has three independent server slices.
   - 8A: stable custom embedding job model key.
   - 8B: production memory progress event delivery.
   - 8C: missing-summary follow-ups for chunks with no embedding yet.

4. Phase 6 streaming errors should land before broad generation
   closeout.
   - 6A: streaming error frame contract plus OpenAI-compatible failure
     handling.
   - 6B: Anthropic, Mistral, and Gemini stream failure alignment.
   - 6C: Ollama stream failure alignment and final provider audit.

5. Phase 0 and Phase 3 are small independent cleanup slices.
   - 0A: Google Drive public artifact removal.
   - 3A: shared or explicitly aligned proxy response-header filtering.

## Suggested Verification

Focused Phase 9 direct-write slice:

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

Add focused suites when the touched surface has one:

```bash
pnpm exec vitest run src/ts/plugins/plugins.test.ts
pnpm smoke:fastify-browser
```

Focused Phase 7:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/providerTransport.test.ts
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

Focused Phase 8:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/assemble.test.ts
```

Focused Phase 6:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
```

Broad closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Reopened status: [`../status.md`](../status.md)
- Follow-up phase index: [`../phases/README.md`](../phases/README.md)
- Original Fastify status: `docs/fastify/status.md`
- Original Phase 9 command map:
  `docs/fastify/status/phase-9-command-map.md`
