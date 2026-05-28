# Audit Coverage

Date: 2026-05-28

## Current Proof

- `pnpm client-thinning:audit` runs `tsx util/client-thinning-audit.ts`.
- The audit derives many checks from source structure and call graphs rather
  than literal old bug strings.
- Archived rule work moved the audit toward invariants; the active task now
  needs reproducible fixtures/tests.

## Open Proof

Each rule needs:

- a committed pre-fix fixture
- a test that runs the rule against the fixture
- an assertion that the rule exits non-zero
- a bypass-shape case when a narrow rule could otherwise pass

## Rule Families To Cover

- passive refresh writer ownership
- conflict replay
- command-path id minting
- resolver normalization
- asset parser parity
- wildcard secret identity
- asset URL gating
- composite fan-out
- backup inventory
- bounded accumulators
- `saveAsset` filename classification

## Commands

```sh
pnpm client-thinning:audit
```
