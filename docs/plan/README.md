# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

The [Original RisuAI behavioral compatibility audit](original-risu-behavioral-compatibility/PLAN.md)
systematically compares retained shared behavior against the immutable fork
point, separately verifies upstream work through the recorded behavioral sync
cursor, and turns confirmed differences into decision-backed remediation and
permanent regression gates. See its [live status](original-risu-behavioral-compatibility/status.md).

The completed test-suite effectiveness audit is preserved under
[Performance and stability](../../.archived-docs/performance-and-stability/README.md).
The completed BardWiki workstream is preserved under
[Memory and context](../../.archived-docs/memory-and-context/README.md).
