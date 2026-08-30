# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

| Workstream | State | Current cursor | Dependency cursor |
| --- | --- | --- | --- |
| [Cross-runtime boundaries](cross-runtime-boundaries/PLAN.md) | Active | [Phase 4 browser-smoke support](cross-runtime-boundaries/status.md) | Thirty neutral leaves, Fastify-local prompt state, and protocol contracts reduce the checked boundary to 163 direct root-`src` edges. |
| [Canonical state and compatibility](canonical-state-and-compatibility/PLAN.md) | Active | [Phase 2 normal model consumer cutover](canonical-state-and-compatibility/status.md) | Profile-owned request/runtime identity is canonical through `841d0b65e`; character/chat row owners are released at `7cb62afa8`. |
| [Client resource ownership](client-resource-ownership/PLAN.md) | Active | [Phase 3 character/chat ownership](client-resource-ownership/status.md) | The mobile character-summary consumer migrated at `3b74261c1`; the next family waits for its Workstream 1 contract. |

The portfolio-level dependency model and the conditional fourth workstream are
defined in the [Architecture Modernization Roadmap](../architecture-modernization/PLAN.md).
Replay-safe event deltas are not an active workstream.

The completed test-suite effectiveness audit is preserved under
[Performance and stability](../../.archived-docs/performance-and-stability/README.md).
The completed BardWiki workstream is preserved under
[Memory and context](../../.archived-docs/memory-and-context/README.md).
The completed [Original RisuAI behavioral compatibility audit](../../.archived-docs/architecture-and-migration/original-risu-behavioral-compatibility/README.md)
is preserved under Architecture and migration with its closed registers and
final verification record intact.
