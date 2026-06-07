# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, Phase 3,
and Phase 4 are complete and recorded in
[`latest-verification.md`](latest-verification.md). The v4-H2 Phase 4.5
hotfix is complete; use [`v4-integration-brief.md`](v4-integration-brief.md)
as the post-Phase-4 router for v4 findings that amend the remaining v3 plan.

## Completed Checkpoint: V4 Phase 4.5

Closed v4-H2 before Phase 5: the `/fetch` proxy strips stale compressed
`content-length` / `transfer-encoding` framing headers after undici
decompression and proves it with a real-socket gzip test. No unrelated v3 IDs
move for this v4-only closeout.

## Next Batch: Phase 5 (Client Write-Path Correctness)

Defined in
[`phases/phase-5-client-write-path-correctness.md`](phases/phase-5-client-write-path-correctness.md).
Slices already live under
`phases/slices/phase-5-client-write-path-correctness/`.

1. M8 `unload-flush`: flush all pending debounced server-backed bridge writes
   on `pagehide` / `visibilitychange(hidden)` and watcher teardown, using
   `keepalive` only for unload flushes.
2. L23/L24/L26 `rollback-suppression`: suppress bridge watchers while
   settings, global-lorebook, and chat-row metadata rollbacks restore
   baselines.
3. L25/L27 `first-baselines`: preserve true first rollback baselines for
   coalesced prompt-template and lorebook entry edits.
4. L21 `preset-rollback`: add rollback coverage to `runPresetCommand`,
   including preset selection and copied scalar settings.
5. L34/L35/L36 `guard-repairs`: follow the amended tree-wide guarded-write /
   feature-breakage criteria in the Phase 5 docs. The bounded inventory covers
   IGP, send-error inlays, `.po` file attach, display-script injection /
   coercion, v4-L30 translator preset lookup, and v4-L33 partial MCP handshake
   failure.
6. L37 `error-handler-hardening`: make global error/rejection handlers and
   `alertError` null-safe.
7. Phase 5 verification refresh: gates, focused proofs, full validation, and
   [`latest-verification.md`](latest-verification.md).

Exit: M8, L21, L23-L27, and L34-L37 registered with regression tests;
active-risk rows flipped to `DONE` only with matching v3 gate proofs; focused
suites, client checks, and verification refreshed.

## Proof History

Phase 4.5 closed on 2026-06-07 with v4-H2 fixed and the focused proxy/hub
suite plus strict server TypeScript green. Phase 4 closed earlier on
2026-06-07 with M9, L2, L4, L5, L17, L18, L19, L20, and L56 registered as
`DONE`, the focused lifecycle/deadline/transport proof suites green,
`pnpm api:test` green, the v3 gate green, and both TypeScript checks green.
Keep new Phase 5 proof entries in [`latest-verification.md`](latest-verification.md)
above the Phase 4.5 entry.

## After Phase 5

Phases 6-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/translator/presets.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/mcp/googlesearchclient.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

## Standing Caveats

- The v1/v2 gates point at `docs/archive/`; nothing in this plan may edit the
  archived docs.
- `pnpm check` retains its documented pre-existing svelte-check baseline
  (14 errors in 5 files at the v2 closeout); do not let it grow.
- The audit's verifier corrections (in each finding's prose) are part of the
  spec — read the finding in
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  before implementing its row.
