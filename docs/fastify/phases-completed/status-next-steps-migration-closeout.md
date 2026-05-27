# Next Steps

Date: 2026-05-27

Use this file as the original Phase 9 closeout runbook. The
first post-closeout audit is archived in
[`status-followup-next-steps.md`](status-followup-next-steps.md);
the current next-steps runbook lives in
[`../status/next-steps.md`](../status/next-steps.md).
Completed original migration slice details live in this directory,
and the current live status is [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-9e - Phase 9 docs closeout** is the latest landed original
migration slice. First-audit follow-up commits after `edbc2d07` are
tracked in the follow-up and alpha phase docs under
`../phases-completed/`.

- Closed Phase 9 for the Fastify-served web client-thinning scope.
- Recorded the already-green 9-9d automated preflight and Fastify-served web
  manual verification as the Phase 9 closeout baseline.
- Recorded that legacy local client manual verification is deferred to a separate
  later task and is not part of Phase 9 closeout.
- Refreshed live status, coverage, and completed-phase archive docs.

## Immediate Pickup

Immediate pickup: **none for the original migration**. The first
follow-up and alpha audit are also closed; start new work only from a
fresh recorded finding.

- Do not fold audit follow-up or legacy local client manual verification
  back into the original Phase 9 docs closeout.
- Do not add compatibility migrations for intermediate Fastify shapes; there
  are no actual Fastify users yet.
- Keep legacy local mode storage behavior on the existing local path.

## Implementation Notes

- Command code lives in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`. The command map remains the source of
  truth for names, payload behavior, events, and plugin bridge policy.
- Browser projection loads through `src/ts/server/bootstrap.ts` and
  refreshes from `src/ts/server/events.ts`. Debounced re-bootstrap is the
  Phase 9 target; per-event patches remain future work.
- The browser-side trusted write helper lives in
  `src/ts/server/projectionWriteGuard.svelte.ts`; keep it as the narrow
  escape hatch for command-owned optimistic writes, rollbacks, and
  bootstrap projection replacement.
- The legacy local client keeps its local storage path. Phase 9 gates should be
  server-backed web specific.
- Storage and secret gates are already closed: Fastify startup/save,
  backup/restore, asset reads, RISUSAVE caches/remotes, cold-storage
  helpers, Google Search credential storage, and provider secret
  projection are guarded. Runtime-only browser caches remain local
  because they are not authoritative server database state.
- Use `MASKED_PROVIDER_SECRET`, `maskProviderSecrets()`, and
  `resolveMaskedProviderSecretPlaceholders()` from
  `server/fastify/src/providerSecrets.ts` if later server routes need the
  same projection or placeholder semantics.
- Character scalar patches reject child collections. Chat metadata
  patches reject `message`, `localLore`, `scriptstate`, generation /
  runtime fields, and child collections except the 9-4c `modules` field.
  Use message, generation, scriptstate, lorebook, or module commands for
  those fields.
- MCP module import, MCP asset import, and server-backed `.risum` module
  import remain explicitly unsupported until later slices define
  dedicated server-owned paths.

## Later Queue

1. New alpha follow-up only if a fresh finding specifically belongs to
   the second-pass audit record.
2. New first-audit follow-up only if a fresh finding specifically
   belongs to that archive.
3. Separate later task - legacy local client manual verification.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the closed Phase 9 Fastify web scope, the already-green 9-9d automated
preflight remains the baseline:

```bash
pnpm smoke:fastify-browser
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm check
```

Deferred legacy local client task:

- App loads the expected persisted state after startup.
- Import succeeds or shows the expected unsupported message for the mode.
- Chat send, regenerate, message edit, and character switch behave correctly.
- A representative settings change persists after reload.
- Legacy local mode keeps using the local storage path.

Fastify-served web manual checks are already recorded in the 9-9d partial
closeout: import, chat/message persistence, regenerate replacement, message
edit, character switch, settings mutation, projection refresh, reload
persistence, and no IndexedDB/localForage or OPFS writes.

Run the full matrix before closing a parent phase or a broad
server-backed behavior surface:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Latest recorded baseline details are archived in
[`phase-9-client-thinning-9-9e.md`](phase-9-client-thinning-9-9e.md).
In short: the Fastify browser smoke, focused client/server suites,
`pnpm check`, `pnpm tauribuild`, and Fastify-served manual command flow
passed during 9-9d/9-9e. The legacy local client manual launch compiled and opened
under Xvfb but remained blocked by `Cannot access 'appVer' before
initialization` from `src/ts/parser/parser.svelte.ts:109`.

## References

- Closed phase:
  [`phase-9-client-thinning.md`](phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`phase-8-memory.md`](phase-8-memory.md)
- Latest closeout:
  [`phase-9-client-thinning-9-9e.md`](phase-9-client-thinning-9-9e.md)
- Completed closeout index:
  [`README.md`](README.md)
- Server status: [`../status/server.md`](../status/server.md)
- sendChat status: [`../status/sendchat.md`](../status/sendchat.md)
