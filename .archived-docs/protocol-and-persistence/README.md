# Protocol And Persistence Archive

Historical server/client contracts, resource projection work, and persistence
migrations.

| Record                                                            | Scope                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`server-client-protocol/`](server-client-protocol/README.md)     | Protocol stability/performance remediation plan, phase slices, risk analysis, verification, and the source audits that seeded it. |
| [`sqlite-migration.md`](sqlite-migration.md)                      | Migration of remaining `db.json` state to SQLite.                                                                                 |
| [`lazy-projection/`](lazy-projection/README.md)                   | Chat-shell bootstrap, on-demand hydration, server-owned generation writes, and related projection work.                           |
| [`mutation-range-narrowing/`](mutation-range-narrowing/README.md) | Command mutation-range narrowing and verification budgets.                                                                        |

## Protocol Source Audits

The protocol workstream keeps distinct reports under
[`server-client-protocol/audits/`](server-client-protocol/audits/README.md):

- [`fastify-port-report.md`](server-client-protocol/audits/fastify-port-report.md)
  records the migration surface and regression inventory.
- [`server-client-ownership.md`](server-client-protocol/audits/server-client-ownership.md)
  records the responsibility split.
- [`server-client-protocol.md`](server-client-protocol/audits/server-client-protocol.md)
  records the communication model.
- [`fastify-side-effect-audit.md`](server-client-protocol/audits/fastify-side-effect-audit.md)
  records migration side-effect risks.
- [`network-transfer-size.md`](server-client-protocol/audits/network-transfer-size.md)
  records transfer-size findings and remediation.
- [`projection-trusted-write-cleanup.md`](server-client-protocol/audits/projection-trusted-write-cleanup.md)
  records the later trusted-projection write cleanup.

These reports share a protocol topic but remain separate because they audit
different contracts and dates.
