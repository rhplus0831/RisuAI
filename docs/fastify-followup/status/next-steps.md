# Next Steps

Date: 2026-05-26

Use this file as the pickup runbook for the reopened audit work. The
phase files under `../phases/` hold source evidence and exit criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

1. Continue Phase 9 client thinning.
   - Continue the broader Fastify-web direct `DBState.db` write audit
     beyond the named guard and module-selection slices landed on
     2026-05-26.
   - Next good audit targets are the remaining settings and editor
     binding surfaces found by `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`,
     especially Bot/OtherBot/Prompt settings and `CharConfig`.
   - Landed 2026-05-26: `.risu` import/export routes emit
     `state.imported` / `state.exported`, and `pnpm smoke:fastify-browser`
     covers multipart `.risu` import plus direct projection-write
     rejection.
   - Landed 2026-05-26: module menu chat/character toggles dispatch
     chat update and character-module reorder commands under the
     projection guard.

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
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/server/commands.test.ts
pnpm smoke:fastify-browser
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
```

Latest Phase 9 event-slice verification, 2026-05-26:

```bash
pnpm api:test
pnpm smoke:fastify-browser
pnpm check
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
