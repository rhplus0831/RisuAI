# Audit

Date: 2026-05-29

Read this when changing `util/client-thinning-audit.ts`, adding invariant rules,
or selecting audit work. This is the canonical audit shard; coverage pointers live
in [`../coverage/audit.md`](../coverage/audit.md).

## Current State: Reproducible, Not Uniformly Robust

`pnpm client-thinning:audit` runs `util/client-thinning-audit.ts` (ts-morph plus
source-text checks). Fixture **reproducibility is complete**: all 21 rules have
committed fixtures and tests in `util/client-thinning-audit.test.ts` (45 tests).
The harness is honest — it spawns the real audit binary against per-rule mini-repo
fixtures with `CLIENT_THINNING_AUDIT_CHECK_IDS` scoping and asserts non-zero exit
on the failing fixture (and zero on a bypass fixture where applicable). No rule is
mocked or re-implemented.

But reproducible is not robust. Several rules are genuine AST/call-graph
invariants that survive a refactor (notably A4R3 transitive-mint, A4R1
passive-refresh via `findReferencesAsNodes`, A4R4 resolver-normalize, A4R5
parser-parity, A4R-bounded, A4R-saveasset). Others lean on `String.includes`
needles / regex counts, and a sincere refactor that changes surface syntax can
slip past them.

## Empirically Defeated Rules (open work)

Four rules were defeated by running sincere variants against the real audit binary
(each printed "Client-thinning audit passed."):

- **A4R2 conflict-replay** (`audit.ts:~1408`) — aliasing the `'conflict'` /
  `'baseRevision'` literals evades the substring heuristic while really replaying.
- **A4R7 asset-URL-gate** (`audit.ts:~2055`) — inverting the `isFastifyServer`
  guard makes the branch-finder latch the browser throw-block; `serverAssetUrl`'s
  accepted shapes are never validated.
- **A4R-fanout composite race** (`audit.ts:~2291`) — the `.svelte` path is
  line-text only; two `void dispatch*()` on a line that also holds any `await`
  read as serialized.
- **EC2 plugin-storage-gates** (`audit.ts:~718`) — a new device-local method
  outside the hardcoded 6-name `guardedMethods` list is unguarded.

These guard exactly the regression classes the audit exists to stop (blind
conflict replay, ungated asset fetch, optimistic-snapshot races, ungated
device-local storage).

## Hardening Work Item

Highest-value audit follow-up:

- Convert the four needle-rules above to AST invariants (branch-on-conflict-then-
  redispatch via call analysis; actually validate the shapes `serverAssetUrl` /
  the asset gate accept; "any method touching device-local storage must assert").
- Parse Svelte `<script>` blocks with the TS path instead of line text.
- Add adversarial / negative fixtures (aliased conflict literal, inverted Fastify
  guard, await-on-same-line svelte race, new ungated storage method) so the suite
  proves robustness, not one-shot tripping.

## Direction

- A new audit rule ships its fixture + test in the same batch.
- Several fixtures intentionally mirror audit tables (`MUTATING_ROUTE_RULES`,
  `ASSET_WALKER_OWNERS`) and must be updated when those surfaces change.
- Keep one `pnpm client-thinning:audit` entry point even if internals split.
- Prefer source-derived rule inputs over hardcoded call-site lists.

## Proof Leads

- `pnpm client-thinning:audit`
- `pnpm exec vitest run util/client-thinning-audit.test.ts`
- `util/client-thinning-audit.ts`, `util/client-thinning-audit.test.ts`
