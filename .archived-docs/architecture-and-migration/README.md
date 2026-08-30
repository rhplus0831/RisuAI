# Architecture And Migration Archive

Historical records for the Fastify-only architecture transition and the later
transfer of chat-process ownership from the browser to the server.

| Workstream                                                        | Scope                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fastify-migration/`](fastify-migration/README.md)               | Original Fastify migration phases, server-projection invariants, provider references, and the Phase-9-era client-thinning contract.               |
| [`client-thinning-closeout/`](client-thinning-closeout/README.md) | Later rewritten client-thinning workstream: server prompt assembly, provider capability routing, Lua/A2 processing, and final ownership closeout. |
| [`risuai-fastify-behavior-differences.md`](risuai-fastify-behavior-differences.md) | Dated 2026-07-11 comparison with the original RisuAI and the remediation state recorded after that audit. |
| [`upstream-sync/`](upstream-sync/README.md) | Closed 2026-08-07 behavior-porting sweep, fork conventions, and disposition ledger. |
| [`original-risu-behavioral-compatibility/`](original-risu-behavioral-compatibility/README.md) | Closed 2026-08-30 exhaustive fork-point and upstream behavioral audit, signed difference registry, remediation record, and permanent compatibility gates. |
| [`cross-runtime-boundaries/`](cross-runtime-boundaries/PLAN.md) | Closed 2026-08-31 browser/protocol/shared-core/Fastify dependency-direction workstream, including the zero-edge inventory and declaration-independent server checks. |

The `fastify-migration/client-thinning/` subtree and the later
`client-thinning-closeout/` record overlap in subject but are not duplicates.
The first captures the migration-era contract; the second captures the later
chat-process implementation and verification history.
