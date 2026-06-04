# Phase 3: Cheap High-Confidence Wins

Status: implemented. One slice, landed in two perf commits (reroll
`ed4e0af0`, `runTrigger` `f4855e24`) plus follow-up guard fix `48d473dc`.

Goal: land small behavior-preserving clone wins: reroll clone reorder/removal and
`runTrigger` early return before cloning. No snapshot API changes.

Note: two targets needed a guard-safe adaptation beyond the naive shallow
copy the audit sketched, because the Fastify read-only projection re-installs the
mutated object. A shallow copy of either the reroll transcript or the trigger
character would have stored read-only proxy rows back into the projection and
poisoned later writes (a subsequent message append / character edit would throw).
The landed shapes preserve the win while staying guard-safe:

- reroll regenerate truncates the live transcript in place (its surviving rows
  are the projection's own rows, never re-installed) instead of installing a
  shallow-popped array.
- `runTrigger` keeps the whole-character deep clone but makes it lazy
  (`materializeChar`), paid at most once per pass and only when a data effect
  installs the character; the common (read-only / `setVar`) trigger pays only the
  active-chat clone.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the `recordGeneratedReroll`, reroll-redundant-clone, and `runTrigger`
  clone-before-early-return findings; recommended-remediation step 4.
- `src/ts/process/rerollNavigation.svelte.ts` - `recordGeneratedReroll`, the
  redundant `safeStructuredClone(record.message)`, and the full-transcript clone
  in `reroll()`.
- `src/ts/process/triggers.ts` - `runTrigger` clones `char` / active `chat`
  before the `triggers.length === 0` early return.

## Slices

- [`cheap-clone-wins.md`](slices/phase-3-cheap-wins/cheap-clone-wins.md) -
  clone only the reroll tail, remove redundant reroll dispatch clones, and hoist
  `runTrigger`'s no-trigger return above char/chat clones.

## Exit Criteria

- [x] `recordGeneratedReroll` clones O(tail) not O(transcript); the stored reroll
      is byte-identical.
- [x] The redundant reroll dispatch clone is removed (rows passed by reference,
      ids minted inside the write guard) and `reroll()` no longer clones the whole
      transcript when only the trailing group is reshaped (in-place truncate);
      dispatch payloads are unchanged.
- [x] A zero-trigger character pays no `char`/`chat` clone in `runTrigger`;
      trigger-bearing paths clone only the active chat (the whole-character clone is
      lazy — paid once, only when a data effect installs the character).
- [x] Trigger results, reroll navigation, and persisted messages are
      byte-identical; `pnpm test` is green.

## Found While Implementing (now fixed)

- `setVar`/`v2SetVar` wrote the new scriptstate directly
  to `getCurrentChat()` / `getCurrentCharacter()` / `getDatabase()` (the read-only
  projection) without a `withTrustedServerProjectionWrite`, so a client-side
  `manual`/slash `setVar` trigger threw under the Fastify guard. Pre-existing
  (untouched by Phase 3; the Phase 2 scriptstate slice narrowed the rollback but
  left these direct writes) and surfaced by the new `triggers.cloneCost.test.ts`.
  Fixed in `48d473dc`: the three identical writes (and the end-of-pass
  `varChanged` sync) now route through a single `syncActiveChatScriptstate` helper
  that runs inside the guard and re-reads `getCurrentChat()`. Proven by the
  guard-on `v2SetVar` test in `triggers.projectionGuard.test.ts`.

## Validation

- `pnpm exec vitest run rerollNavigation` (unit + rollback + guard suites, incl.
  the new Phase 3 clone-cost + guard-on regenerate tests)
- `pnpm exec vitest run triggers.projectionGuard triggers.cloneCost`
- `pnpm test` - green, 1003 passed / 4 skipped (105 files)
- `pnpm api:test` - green, 1632 passed / 1 skipped (93 files)
- `pnpm client-thinning:audit` - green
- Type check: `tsconfig.client-lib.json` build then
  `server/fastify/tsconfig.json --noEmit` - both zero errors
