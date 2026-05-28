# Phase 5: Closeout

Date: 2026-05-28

Status: blocked until audit reproducibility and verification are current.

## Preconditions

- `pnpm client-thinning:audit` passes.
- Audit rules have fixture/test reproducibility.
- No active source-proven command/projection invariant drift remains.
- sendChat prompt/post-generation boundaries are either thin, explicitly
  server-owned for supported subsets, or documented client-owned/no-port.

## Verification Ladder

```sh
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Use focused commands during implementation, then run the broader ladder for
closeout.

## Exit Criteria

- Latest verification is recorded.
- Status and coverage shards match the current source.
- Remaining client-owned behavior is intentional and documented.
- No archive-only status claim is needed to understand the active workstream.
