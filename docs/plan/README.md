# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

| Workstream | State | Current cursor | Dependency cursor |
| --- | --- | --- | --- |
| [Cross-runtime boundaries](cross-runtime-boundaries/PLAN.md) | Active | [Phase 3 history-slot rendering](cross-runtime-boundaries/status.md) | Ten neutral leaves are released through `14f44ed87`; 316 direct root-`src` edges remain at the portfolio checkpoint. |
| [Canonical state and compatibility](canonical-state-and-compatibility/PLAN.md) | Active | [Phase 2 normal model consumer cutover](canonical-state-and-compatibility/status.md) | Migration is durable and normal prompt-shape/tokenizer consumers resolve durable profiles through `c0b8776b3`; each resource-family closeout releases the matching Workstream 3 phase. |
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
