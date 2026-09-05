# Phase Documents

Use [status.md](../status.md) for the current execution cursor and
[PLAN.md](../PLAN.md) for finding IDs and preserved invariants.

| Phase | Document |
| --- | --- |
| 0 | [Character creation safety](phase-0-character-creation-safety.md) |
| 1 | [Baselines and acceptance budgets](phase-1-baselines-and-budgets.md) |
| 2 | [Browser work reduction](phase-2-browser-work.md) |
| 3 | [Generation inputs and types](phase-3-generation-inputs-and-types.md) |
| 4 | [Server maintenance scheduling](phase-4-server-maintenance.md) |
| 5 | [Transcript residency decision](phase-5-transcript-residency.md) |
| 6 | [Shared policy and closeout](phase-6-shared-policy-and-closeout.md) |

Each implementation slice starts by confirming its source owners and prior
phase evidence. Record the intended data/read/write scope and a testable before/
after outcome before editing. Finish with focused behavioral proof, the relevant
cost evidence, and the current aggregate workflow. Update the execution cursor
only after evaluating the exit criteria; a passing build is not a substitute.

Use the slices already defined inside phase documents. Create additional slice
files only when a unit becomes too large to review independently, and link them
from both their phase and the status cursor. Do not add parallel copies of
progress, findings, or command inventories.
