# Migration Status

Date: 2026-05-28

All Phases 0-9 are complete. No open findings remain. The follow-up
client-thinning alpha workstream closed AF1 through AF10 and AEC1 through AEC7;
see [`client-thinning-alpha/final-audit.md`](client-thinning-alpha/final-audit.md)
for that first alpha verification pass. Alpha 2 then closed the remaining
Fastify server-projection invariant gaps. Alpha 3 then closed the later
Fastify-only projection gaps around passive reads, stable ids, asset ownership,
secret row identity, and command event retention. Alpha 4 then made the
audit invariant-derived (so future drift inside an already-closed class
fails the rules, not just the original call site) and closed the residual
B1-B10 findings: composite command fan-out at seven call sites, transitive
command-path id minting through lorebook validators, backup directory
inventory, in-memory accumulator bounds, `saveAsset` caller metadata,
asset URL gating, and global-resolver normalization. See
[`client-thinning-alpha-4/final-audit.md`](client-thinning-alpha-4/final-audit.md)
for the latest client-thinning closeout. A follow-up Fastify-only lockdown
removed the residual no-port runtime surfaces (alternative server adapters,
legacy client wrappers, service worker, browser-side persistence, legacy client
endpoints); see [`phases-completed/fastify-only.md`](phases-completed/fastify-only.md)
for that no-port cleanup.

Policy: no actual Fastify users yet. Update schemas and import paths
directly; do not write compatibility migrations.

## Verification

Latest full verification on 2026-05-28 for the Alpha 4 closeout:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 80 files passed; 807 tests passed, 4 skipped.
- `pnpm api:test`: 71 files passed; 1274 tests passed.
- `pnpm build`: passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser`: 1 browser smoke test passed.

## Phase Summary

| Phase                                   | Status   | Closed     |
| --------------------------------------- | -------- | ---------- |
| 0 - Removals                            | Complete | 2026-05-20 |
| 1 - Foundation                          | Complete | 2026-05-20 |
| 2 - Storage / import / assets / backups | Complete | 2026-05-20 |
| 3 - Proxy migration                     | Complete | 2026-05-21 |
| 4 - sendChat tests                      | Complete | 2026-05-20 |
| 5 - sendChat extraction                 | Complete | 2026-05-22 |
| 6 - Server-side generation              | Complete | 2026-05-22 |
| 7 - Server-side prompt assembly         | Complete | 2026-05-24 |
| 8 - Hypa V3 memory server-side          | Complete | 2026-05-25 |
| 9 - Client thinning                     | Complete | 2026-05-26 |

## Closeout Rules

- Each future finding must include focused regression tests.
- Run `pnpm client-thinning:audit`, `pnpm check`, `pnpm test`,
  `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser` before
  closing any new finding.

## References

- Phase details: [`phases-completed/`](phases-completed/)
- Next steps: [`status/next-steps.md`](status/next-steps.md)
- Latest client-thinning closeout:
  [`client-thinning-alpha-4/final-audit.md`](client-thinning-alpha-4/final-audit.md)
- Server status: [`status/server.md`](status/server.md)
- sendChat status: [`status/sendchat.md`](status/sendchat.md)
