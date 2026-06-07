# Slice: Phase 6 Verification Refresh

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Depends on
all Phase 6 implementation slices. Proof-only slice.

## Scope

Re-run the Phase 6 proof set after transcript window reset, render parser
dependency narrowing, catalog derived lists, watcher short-circuits, draft
mirror gating, parse-key caching, customHTML template memoization, and render
cache hygiene land. Record the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This slice should not introduce runtime behavior. It may correct
documentation, gate registration, or active-risk status drift discovered
during verification.

## Anchors

- [`../../phase-6-reactive-amplification-and-render.md`](../../phase-6-reactive-amplification-and-render.md):
  Phase 6 exit criteria and validation list.
- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`: v3 rows M6, L22, L28, L29, L30, L31,
  L32, L33, and any landed riding notes for I12/I18.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 6 `DONE`
  registrations and proof text once Phase 0 has authored the gate.
- Focused proof suites from the implementation slices:
  transcript window reset/screenshot bound, Chat parser dependency narrowing,
  BackgroundDom parser dependency narrowing, catalog/mobile derived lists,
  ModuleChatMenu if landed, lorebook watcher lazy snapshots,
  chat-metadata short-circuit, character draft mirror gating, ChatBody
  parse-key caching, customHTML template memoization, script-cache hygiene,
  and BGM reset behavior.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 6 run-log entry to `latest-verification.md`.
- Record exact commands run, pass/fail outcomes, and any focused diagnostic
  reruns used to explain failures.
- Confirm the v3 gate has v3 rows M6, L22, L28, L29, L30, L31, L32, and L33 as
  `DONE` with concrete test paths and test names. v4-H1, v4-M1, v4-L20, and
  v4-L22 are proof-only in this plan and must not be added as v3 `DONE` rows.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated Phase 6+ status flips.
- Confirm I19 remains documented as intentional no-action context.
- If I12 or I18 landed as riding items, make sure proof text names the test
  coverage and make the active-risk table wording match the chosen
  informational-item convention.
- Confirm the parent Phase 6 exit criteria can be checked against recorded
  proof:
  transcript window reset and screenshot cleanup, Chat/BackgroundDom
  parser-count guards, catalog recompute counts, watcher stringify/map
  counts, draft mirror seed counts, parse/template parse counts,
  bounded/reset script cache, and BGM switch behavior.
- If a proof is skipped or fails, keep that visible in
  `latest-verification.md` and leave the matching parent exit criterion
  incomplete.

## Invariants

- Do not silently replace a failing full command with a narrower focused
  command. Narrow commands may be added as diagnostics, but the full result
  stays recorded.
- Run the client-lib TypeScript build before any strict server check.
- Do not mark an implementation finding `DONE` unless its slice landed with a
  focused regression proof.
- Preserve earlier verification entries; append a new Phase 6 entry.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 6 verification entry with command
  outcomes.
- Phase 6 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for v3 rows M6, L22, L28, L29, L30,
  L31, L32, and L33.
- Focused UI, bridge, render, script, observer, gate, and TypeScript checks
  are green or failures are documented as blockers.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/ChatScreens/Chat.parserDependencies.test.ts \
  src/lib/BackgroundDom.parserDependencies.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/lib/ChatScreens/Chat.customHtml.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/process/scripts.regexCache.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/observer.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
