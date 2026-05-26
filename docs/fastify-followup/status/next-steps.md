# Next Steps

Date: 2026-05-26

Use this file as the pickup runbook for the reopened audit work. The
phase files under `../phases/` hold source evidence and exit criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

1. Close the Phase 9 projection gap.
   - Enable the server projection write guard in Fastify-served web
     startup after trusted bootstrap replacement is wired correctly.
   - Replace or explicitly route the remaining direct `DBState.db`
     mutations through commands or trusted projection helpers.
   - Add smoke coverage that proves a direct projection write fails in
     Fastify web mode.

2. Close Phase 7 server prompt assembly parity gaps.
   - Implement the server regenerate path end to end.
   - Reject or defer local-only provider families on `/chat` instead of
     falling through to OpenAI-compatible dispatch.
   - Emit stop-trigger mutation/restoration payloads before terminal
     errors.
   - Make fixture coverage exercise the real Fastify assembly route for
     continue and regenerate cases.

3. Close Phase 8 memory ownership gaps.
   - Preserve custom embedding routing for follow-up jobs.
   - Connect memory job progress events to the production event stream,
     or document and test a different production subscriber path.
   - Enqueue summary follow-ups for chunks that lack both a summary and
     an embedding.

4. Close Phase 6 streaming error semantics.
   - Make upstream streaming failures produce a typed SSE error or a
     pre-stream HTTP failure, never an empty successful stream.

5. Close Phase 0 and Phase 3 cleanup.
   - Remove the tracked Google Drive OAuth artifact.
   - Share or align proxy response header filtering for stream-job and
     direct proxy paths.

## Suggested Verification

Focused Phase 9:

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm api:test -- server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
```

Focused Phase 7:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generationChat.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/providerTransport.test.ts
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

Focused Phase 8:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobs.test.ts server/fastify/__tests__/assemble.test.ts
```

Focused Phase 6:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.test.ts
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
