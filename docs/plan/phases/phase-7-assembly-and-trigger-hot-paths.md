# Phase 7: Assembly & Trigger Hot Paths (Themes 1+8, server side)

Status: pending.

Goal: narrow the per-send server amplifiers the v2 assembly wave missed —
sync asset reads, redundant prompt/transcript clones, per-message rebuilds,
unbounded user regex, and the one stale-memo correctness edge.

Findings: L1, L3, L6, L7, L8, L9, L10, K3.
Riding informational items: I5 (shared per-send trigger budget, the
`luaExecBudget` shape) and I7 (single classifier pass per send) — land if
free.

## Planned Slices

Author under `slices/phase-7-assembly-and-trigger-hot-paths/` when starting.

- async-asset-reads (L1) — read assembly asset bytes off the event loop:
  pre-resolve referenced assets with `fs.promises.readFile` before the
  synchronous assembler (feeding the existing request-scoped cache) or make
  the `ResolveStoredAsset` contract async.
- dispatch-clone-narrowing (L3, K3) — compute the reformat flags first and
  return `rows` unchanged when no branch applies (or clone lazily per
  branch); return the provably-immutable `initialMessages` restoration
  payload by reference (set once in `beginAssembly`, never mutated).
- per-assembly-invariants (L6, L7) — build the char+module asset table once
  per assembly and share it with `buildAssetLookup`; iterate the lorebook
  depth slice and recursive entries without the per-call concat.
- trigger-clone-narrowing (L8) — per-phase narrowing of `runTrigger`'s full
  chat clone: skip or row-limit the clone for trigger sets containing no
  message-mutating effect kinds. Do NOT share one clone across the three
  phases — they legitimately see different transcripts (the audit's
  correction marks that variant unsafe).
- user-regex-bounds (L9) — bound user-supplied regex execution in the
  trigger interpreter (haystack/pattern length caps and/or a complexity
  screen for nested unbounded quantifiers); at minimum document the
  non-interruptibility. Note `v2RegexTest`/`v2ExtractRegex` are in the
  display/request safeSubset with no `lowLevelAccess` gate.
- history-memo-chat-var-bumps (L10) — bump the history-callback memo
  generation from every chat-var-dirty fold: the sticky-lorebook
  `writeChatVar` callback, the run-var `chatVarDirty` branch, and the
  renderAndBudget Lua var fold (all three are currently un-bumped).
- phase-7-verification-refresh — gates, output-identity + count proofs,
  full validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  L1, L3, L6-L10; K3 under Known-Item Overlaps.
- L1: `server/fastify/src/routes/generationChat.ts` (`readStoredAsset`,
  `createRequestScopedStoredAssetResolver`, `loadDatabaseDeps`),
  `prompt/assetLookup.ts`, `prompt/history.ts` (`processInlays`,
  `processAssetPrompts`); contrast `routes/assets.ts` (streaming reads).
- L3: `prompt/chatDispatch.ts` (`reformatMessages`); consumers
  `generation/openai.ts` (`buildPayload`).
- K3: `prompt/assemble.ts` (`buildRestorationPayload`, `beginAssembly`
  `initialMessages`).
- L6: `prompt/history.ts` (`processAssetPrompts` per-message concat),
  `prompt/assetLookup.ts` (the second build site).
- L7: `prompt/lorebook.ts` (`searchMatch`, `baseSearchEntriesForDepth`,
  `recursiveEntries`).
- L8: `prompt/triggers.ts` (`runTrigger` clones; phase callers in
  `assemble.ts` and `history.ts`).
- L9: `prompt/triggerDataEffects.ts` (`v2RegexTest`, `v2ReplaceString`,
  `v2QuickSearchChat`), `prompt/triggers.ts` (`evaluateConditions`,
  `chargeTriggerEffectStep` — between-effects only).
- L10: `src/ts/cbs.ts` (`historyCallbackMemoKey`, `parserArgMemoIdentity`),
  `prompt/assemble.ts` (`bumpHistoryCallbackMemo` call sites; the three
  un-bumped chat-var-write folds).
- I5 (riding): `prompt/triggers.ts` (budget fallback), `assemble.ts`
  (`luaExecBudget` precedent). I7 (riding):
  `src/ts/process/index.svelte.ts` + `request/durableGeneration.ts`
  (double `resolveServerPromptAssembly`).

## Planned Shape

- Output identity is the hard constraint everywhere here: prompt bytes,
  trigger results, and persisted state must be byte-identical (L10 exists
  precisely because a v2 memo violated this on an edge; its fix must come
  with a regression test reproducing the stale-var scenario).
- L8's clone is required for mutation isolation when message-mutating
  effects exist — narrowing only, never removal.
- L9 is a bound: legitimate patterns under the caps behave identically;
  pathological ones fail fast with a clear error instead of wedging the
  event loop.
- L1 must keep the request-scoped cache semantics (per-purpose:id memo,
  distinct-asset bounded).

## Exit Criteria

- [ ] L1: an image-bearing send performs zero synchronous file reads on the
      event loop (probe/spy); asset bytes identical.
- [ ] L3/K3: a default-provider send performs zero dispatch-layer prompt
      clones and zero restoration-payload clones (count probe); payloads
      byte-identical.
- [ ] L6/L7: per-message/per-query allocations hoisted (probe); activation
      results identical.
- [ ] L8: a trigger set with no message-mutating effects clones no
      transcript; mutating sets still isolated; all three phases verified
      independently.
- [ ] L9: a catastrophic-backtracking pattern terminates within the bound
      with a surfaced error; legitimate regex behavior unchanged.
- [ ] L10: the stale-var reproduction (two history references straddling a
      sticky-lorebook/run-var/Lua chat-var write) renders the fresh value;
      memo still hits when nothing changed.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
