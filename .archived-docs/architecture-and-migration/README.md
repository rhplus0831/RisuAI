# Architecture And Migration Archive

Historical records for the Fastify-only architecture transition and the later
transfer of chat-process ownership from the browser to the server.

| Workstream                                                        | Scope                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fastify-migration/`](fastify-migration/README.md)               | Original Fastify migration phases, server-projection invariants, provider references, and the Phase-9-era client-thinning contract.               |
| [`client-thinning-closeout/`](client-thinning-closeout/README.md) | Later rewritten client-thinning workstream: server prompt assembly, provider capability routing, Lua/A2 processing, and final ownership closeout. |

The `fastify-migration/client-thinning/` subtree and the later
`client-thinning-closeout/` record overlap in subject but are not duplicates.
The first captures the migration-era contract; the second captures the later
chat-process implementation and verification history.
