# Alpha 2 Final Audit

Date: 2026-05-28

Status: **closed.** Alpha 2 is complete. A2F1 through A2F4 are closed, the
repeatable client-thinning audit covers the reopened bug classes, and the full
verification ladder passed.

## Final Verdict

The Alpha 2 invariant is satisfied for the scoped Fastify-served web mode:

> In Fastify-served web mode, no public command path mints stable durable ids
> behind the client's back, and no server-owned durable mutation bypasses the
> active-writer/session and repeatable-audit gates.

## Criteria

| Criterion | Status | Closeout |
| --------- | ------ | -------- |
| A2EC1 - Command fork ids are stable | Closed | Bucket 1 requires client-supplied fork chat ids and audits route-local command id minting. |
| A2EC2 - Durable mutations are active-writer guarded or classified | Closed | Bucket 2 guards browser-triggered memory/generation mutation entrypoints and documents worker continuations. |
| A2EC3 - Audit covers newly found blind spots | Closed | Bucket 3 discovers Fastify mutating routes, checks active-writer classifier drift, and covers asset-walker validator ownership. |
| A2EC4 - Docs reflect current state | Closed | Bucket 4 reconciles Alpha 2 docs, high-level status docs, and this final audit. |

## Verification Ladder

Run on 2026-05-28:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Results:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: passed with 0 errors and 0 warnings.
- `pnpm test`: 78 files passed; 788 tests passed and 4 skipped.
- `pnpm api:test`: 69 files passed; 1249 tests passed.
- `pnpm build`: passed with nonblocking warnings.
- `pnpm smoke:fastify-browser`: build passed with the same nonblocking warning
  classes; 1 Playwright smoke test passed.

The nonblocking build warnings were the existing warning classes seen during
closeout: CSS `::highlight(...)` minify warnings, browser-externalized Node
module imports from dependencies, plugin timing warnings, ineffective dynamic
imports, and large chunk warnings.

## Residual Notes

- `pnpm tauribuild` is not a current package script and was not an Alpha 2
  closeout gate.
- The earlier `client-thinning-alpha` directory remains the first alpha
  historical record. This directory is the closed record for the follow-up
  Alpha 2 pass.
