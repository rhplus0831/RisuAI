# Phase 3: Assembly CBS & Trigger Costs (Root 2)

Status: pending.

Goal: stop prompt assembly from re-cloning, re-stringifying, and
re-CBS-parsing unchanged data. The CBS/`risuChatParser` interpreter layer is
the largest unmitigated per-send server cost; this phase is one coherent
slice family over `assemble.ts`/`history.ts`/`templates.ts`/`lorebook.ts`/
`triggers.ts`.

Findings: M1, M2, M3, M4, L4, L5, L6, L7, L8, L9, L10, L11. (I16's parser
nesting-stack cap may ride along if free.)

## Slices

- M1:
  [`slices/phase-3-assembly-cbs-and-triggers/assembly-message-capture-dirty-flags.md`](slices/phase-3-assembly-cbs-and-triggers/assembly-message-capture-dirty-flags.md)
  - skip full-transcript clone/stringify captures when no message mutation
    happened.
- M2 + L8 + L9:
  [`slices/phase-3-assembly-cbs-and-triggers/history-fixed-point-and-depth-preflight.md`](slices/phase-3-assembly-cbs-and-triggers/history-fixed-point-and-depth-preflight.md)
  - fixed-point history rows, one `SEND_NAME_WRAPPER` expansion, and reusable
    depth-prompt preflight rows.
- M3:
  [`slices/phase-3-assembly-cbs-and-triggers/template-stable-card-render-cache.md`](slices/phase-3-assembly-cbs-and-triggers/template-stable-card-render-cache.md)
  - render stable template cards once per assembly and reuse them for preflight
    and final render.
- M4:
  [`slices/phase-3-assembly-cbs-and-triggers/cbs-history-lore-callback-memo.md`](slices/phase-3-assembly-cbs-and-triggers/cbs-history-lore-callback-memo.md)
  - memoize `{{charhistory}}`, `{{userhistory}}`, and `{{lorebook}}`
    callbacks within an assembly.
- L4 + L5:
  [`slices/phase-3-assembly-cbs-and-triggers/lorebook-sticky-vars-and-search-normalization.md`](slices/phase-3-assembly-cbs-and-triggers/lorebook-sticky-vars-and-search-normalization.md)
  - persist sticky lorebook activation vars and reuse normalized search corpus
    data.
- L6 + L7:
  [`slices/phase-3-assembly-cbs-and-triggers/trigger-regex-transcript-and-empty-clone.md`](slices/phase-3-assembly-cbs-and-triggers/trigger-regex-transcript-and-empty-clone.md)
  - skip no-trigger clones and memoize trigger regex/transcript work.
- L10 + L11:
  [`slices/phase-3-assembly-cbs-and-triggers/parser-each-cap-and-tag-normalization.md`](slices/phase-3-assembly-cbs-and-triggers/parser-each-cap-and-tag-normalization.md)
  - cap pathological `{{#each}}` expansion and cheapen CBS tag-name
    normalization; optionally fold in I16.
- Proof:
  [`slices/phase-3-assembly-cbs-and-triggers/phase-3-verification-refresh.md`](slices/phase-3-assembly-cbs-and-triggers/phase-3-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M1-M4, L4-L11 (the verifier corrections materially scope M3/M4).
- M1: `server/fastify/src/prompt/assemble.ts` (`captureMessageReplacement`
  clone-before-`equalJson`, `beginAssembly`, `appendUserMessageRow`,
  `resolveScope`).
- M2: `server/fastify/src/prompt/history.ts` (`formatHistoryMessage`);
  guard precedent `isRunVarParserFixedPoint` (`assemble.ts`).
- M3: `server/fastify/src/prompt/templates.ts` (`renderContentCard`),
  `preflight.ts` (`preflightTemplateTokens`). Memoizable subset only:
  plain/jailbreak/cot/chatML + innerFormat wrappers; chat/postEverything
  cards mutate between passes and must stay live.
- M4: `src/ts/cbs.ts` (`charhistory`/`userhistory`/`lorebook` callbacks);
  module lore is dead server-side (`cbsAdapter.ts` wires `() => []`).
- L4: `server/fastify/src/prompt/lorebook.ts` (`writeChatVar` on the clone;
  `buildChatVarMutations` diff base).
- L5: `lorebook.ts` (`searchMatch` per-call normalization).
- L6: `server/fastify/src/prompt/triggers.ts` (`evaluateConditions`),
  `triggerDataEffects.ts` (per-evaluation `new RegExp`, transcript joins);
  memo precedent `getCompiledLoreKeyRegex`.
- L7: `triggers.ts` (`runTrigger` clones before the empty-triggers
  early-return).
- L8/L9: `history.ts` (`SEND_NAME_WRAPPER`, depth-prompt double expansion).
- L10/L11: `src/ts/parser/risuChatParser.ts` (`{{#each}}` expansion, the
  per-tag matcher).

## Planned Shape

- M1: dirty flags set by the actual mutators (run-var `dirty`, trigger
  `varChanged`, editinput change) skip `captureMessageReplacement` entirely;
  where a compare is needed, compare before cloning. The `history_normalize`
  capture is always a no-op in the no-trigger case — prove it and skip it.
- M2: apply the L2-shape fixed-point guard in `formatHistoryMessage`
  (skip `expandVariables` for marker-free bodies).
- M3: render the stable card subset once per assembly, cache per card, have
  the preflight tokenize the cached rows. Side-effect-bearing CBS in card
  bodies ({{setvar}}) currently double-evaluates with the preflight mutation
  discarded — the fix closes that; test it explicitly.
- M4: memoize callback output per (assembly, chat revision); lands after M3
  so the double-render multiplier is already gone.
- L4 is a correctness fix: sticky-activation chat-var writes must reach the
  persisted chat-var delta (route them through the var engine/promptScope or
  fold a `varChanged` + persisted-chat write).
- Everything must keep prompt output bytes identical (except L4, which fixes
  a silent drop — its new persisted flags are the spec'd behavior).

## Exit Criteria

- [ ] M1: a plain send performs zero full-transcript clones/stringifies in
      the unchanged stages (counting assertion); trigger/editinput sends
      still capture; prompt bytes identical.
- [ ] M2: marker-free history rows skip the CBS parse (counting assertion);
      marker rows still expand; prompt bytes identical.
- [ ] M3: one `renderContentCard` evaluation per stable card per send;
      `{{setvar}}`-bearing cards evaluate exactly once; prompt bytes
      identical for the full template matrix (template/non-template,
      promptInfoInsideChat on/off).
- [ ] M4: repeated `{{charhistory}}`/`{{lorebook}}` references within one
      assembly evaluate once; output identical.
- [ ] L4: `@@keep_activate_after_match` survives across two sends on the
      fixture (regression test proving persistence).
- [ ] L5-L11: each cited redundant pass is hoisted/memoized/capped with a
      focused counting or behavior test; output identical (L10's cap is a
      documented new failure mode for pathological inputs only).
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/scripts.test.ts \
  server/fastify/__tests__/triggers.test.ts
RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm api:test && pnpm test
```
