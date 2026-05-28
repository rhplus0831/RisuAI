# Migration Status

Date: 2026-05-28

All Phases 0-9 are complete. No open findings remain. The follow-up
client-thinning alpha workstream also closed AF1 through AF10 and AEC1 through
AEC7; see [`client-thinning-alpha/final-audit.md`](client-thinning-alpha/final-audit.md)
for the final verification pass. A follow-up Fastify-only lockdown removed the
residual no-port runtime surfaces (alternative server adapters, legacy client
wrappers, service worker, browser-side persistence, legacy client endpoints);
see [`phases-completed/fastify-only.md`](phases-completed/fastify-only.md) for
that no-port cleanup.

Policy: no actual Fastify users yet. Update schemas and import paths
directly; do not write compatibility migrations.

## Verification

Latest full verification on 2026-05-28:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 78 files, 786 passed, 4 skipped.
- `pnpm api:test`: 69 files, 1246 passed.
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
- Run `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and
  `pnpm smoke:fastify-browser` before closing any new finding.

## References

- Phase details: [`phases-completed/`](phases-completed/)
- Next steps: [`status/next-steps.md`](status/next-steps.md)
- Server status: [`status/server.md`](status/server.md)
- sendChat status: [`status/sendchat.md`](status/sendchat.md)
