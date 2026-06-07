# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, Phase 3,
Phase 4, and Phase 5 are complete and recorded in
[`latest-verification.md`](latest-verification.md). The v4-H2 Phase 4.5
hotfix is complete; use [`v4-integration-brief.md`](v4-integration-brief.md)
as the post-Phase-4 router for v4 findings that amend the remaining v3 plan.

## Completed Checkpoint: Phase 5

Closed the client write-path correctness batch: pending bridge writes flush on
unload/teardown; settings, global-lorebook, and chat metadata rollbacks
suppress watcher echoes; coalesced prompt-template and lorebook edits keep
first baselines; preset commands have rollbacks; guarded client transcript
features persist through trusted writes plus scoped commands; global error
handlers are null-safe. v4-L30 and v4-L33 are recorded as guard-repair proof
riders only.

## Next Batch: Phase 6 (Reactive Amplification & Render)

Defined in
[`phases/phase-6-reactive-amplification-and-render.md`](phases/phase-6-reactive-amplification-and-render.md).
Slices already live under
`phases/slices/phase-6-reactive-amplification-and-render/`.

1. v4-H1/v4-L20 `transcript-window-reset`: key or reset transcript window
   expansion by active chat identity and keep screenshot/jump expansion
   bounded or transient.
2. v4-M1/v4-L22 `render-parser-dependency-narrowing`: stop guarded streaming
   frame writes from re-parsing every visible row or unrelated background HTML.
3. M6 (+I12) `catalog-derived-lists`: use derived, keyed catalog/mobile list
   helpers with render-count proof.
4. L28/L29 `watcher-short-circuits`: make lorebook and chat-metadata watchers
   skip collection-sized work on unrelated guarded writes.
5. v3-L22 `draft-mirror-gating`: split/gate the character-editor draft mirror
   so keystrokes do not re-run pick+clone+stringify.
6. L30 `parse-memo-key-caching`: cache corpus-derived parse-key signatures by
   cheap invalidation tokens.
7. L31 `customhtml-template-memo`: memoize parsed customHTML templates per
   template version.
8. L32/L33 `render-cache-hygiene`: cap/reset `bestMatchCache` and stop stale
   BGM observers on chat/character switch.
9. Phase 6 verification refresh: gates, focused render/clone proofs, full
   validation, and [`latest-verification.md`](latest-verification.md).

Exit: M6, L22, L28-L33 registered with regression tests; v4-H1, v4-M1,
v4-L20, and v4-L22 recorded as Phase 6 amendment proofs; active-risk rows
flipped to `DONE` only with matching v3 gate proofs; focused suites, client
checks, and verification refreshed.

## Proof History

Phase 5 closed on 2026-06-07 with M8, L21, L23-L27, and L34-L37 registered
as `DONE`, v4-L30/v4-L33 recorded as proof riders only, the focused Phase 5
suite green, `pnpm test` green after v2 gate proof-name drift was corrected,
`pnpm client-thinning:audit` green after its false positive was narrowed to
the real settings-key registry, and both TypeScript checks green. Keep new
Phase 6 proof entries in [`latest-verification.md`](latest-verification.md)
above the Phase 5 entry.

## After Phase 6

Phases 7-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/ChatScreens/Chat.parserDependencies.test.ts \
  src/lib/BackgroundDom.parserDependencies.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts
pnpm test
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
