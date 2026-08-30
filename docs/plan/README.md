# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

| Workstream | State | Current cursor | Dependency cursor |
| --- | --- | --- | --- |
| [Cross-runtime boundaries](cross-runtime-boundaries/PLAN.md) | Active | [Phase 4 memory-embedding configuration seam](cross-runtime-boundaries/status.md) | Phase 3 closed with seventeen neutral leaves; the first server domain migrated at `44e53527a`, leaving 286 direct root-`src` edges. |
| [Canonical state and compatibility](canonical-state-and-compatibility/PLAN.md) | Active | [Phase 2 normal model consumer cutover](canonical-state-and-compatibility/status.md) | Migration is durable; prompt shape, tokenizer, output budget, image capability, sidebar authoring, and server-intent completion resolve durable owners through `07576969c`; each resource-family closeout releases the matching Workstream 3 phase. |
| [Client resource ownership](client-resource-ownership/PLAN.md) | Active | [Phase 3 character/chat dependency gate](client-resource-ownership/status.md) | Phase 2 closed the standalone page pointer at `aaf66b75d`; the next runtime slice waits for matching Workstream 1/2 releases. |

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
