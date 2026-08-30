# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

| Workstream | State | Current cursor | Dependency cursor |
| --- | --- | --- | --- |
| [Cross-runtime boundaries](cross-runtime-boundaries/PLAN.md) | Active | [Phase 2 durable command operation catalog](cross-runtime-boundaries/status.md) | The 103-entry shared route catalog is implemented at `00e49d880`; 336 direct root-`src` edges remain and final full-suite verification is deferred. |
| [Canonical state and compatibility](canonical-state-and-compatibility/PLAN.md) | Active | [Phase 1 migration and recovery foundation](canonical-state-and-compatibility/status.md) | Phase 0 classified 19 surfaces at `cd04b0e11`; each resource-family closeout releases the matching Workstream 3 phase. |
| [Client resource ownership](client-resource-ownership/PLAN.md) | Active | [Phase 1 resource-owner foundation](client-resource-ownership/status.md) | Phase 0 froze 9,917 compatibility references at `0432b32ba`; runtime migration waits for the relevant Workstream 1 contract and Workstream 2 canonical-owner cursor. |

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
