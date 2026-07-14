# Server/Client Protocol Source Audits

Distinct source reports that seeded or followed the protocol stability and
performance workstream.

| Report                                                                       | Focus                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------- |
| [`fastify-port-report.md`](fastify-port-report.md)                           | Fastify port surface and regression inventory. |
| [`server-client-ownership.md`](server-client-ownership.md)                   | Server/client responsibility split.            |
| [`server-client-protocol.md`](server-client-protocol.md)                     | Communication and synchronization model.       |
| [`fastify-side-effect-audit.md`](fastify-side-effect-audit.md)               | Migration side effects and prioritized risks.  |
| [`network-transfer-size.md`](network-transfer-size.md)                       | Transfer-size findings and remediation state.  |
| [`projection-trusted-write-cleanup.md`](projection-trusted-write-cleanup.md) | Later trusted-projection write cleanup.        |

They remain separate because each report audits a different contract or date.
