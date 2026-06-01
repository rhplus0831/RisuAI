# Protocol Stability And Performance Phases

Date: 2026-06-02

Use these files for phase-specific status, remaining work, exit criteria, and
slice routing. Concrete slice definitions live under
`slices/[phase]/[slice-name].md`.

| Phase | Status                                          | Phase doc                                                                            | Slice folder                                                                                   |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 0     | Implemented foundation                          | [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md)                 | [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/)                 |
| 1     | Implemented                                     | [`phase-1-correctness-hardening.md`](phase-1-correctness-hardening.md)               | [`slices/phase-1-correctness-hardening/`](slices/phase-1-correctness-hardening/)               |
| 2     | Hot commands targeted; candidate measurement    | [`phase-2-command-write-cost.md`](phase-2-command-write-cost.md)                     | [`slices/phase-2-command-write-cost/`](slices/phase-2-command-write-cost/)                     |
| 3     | Read optimizations done; candidate measurements | [`phase-3-read-projection-efficiency.md`](phase-3-read-projection-efficiency.md)     | [`slices/phase-3-read-projection-efficiency/`](slices/phase-3-read-projection-efficiency/)     |
| 4     | Runtime implemented                             | [`phase-4-stream-generation-resilience.md`](phase-4-stream-generation-resilience.md) | [`slices/phase-4-stream-generation-resilience/`](slices/phase-4-stream-generation-resilience/) |
| 5     | Implemented; candidate export measurement       | [`phase-5-import-export-asset-memory.md`](phase-5-import-export-asset-memory.md)     | [`slices/phase-5-import-export-asset-memory/`](slices/phase-5-import-export-asset-memory/)     |
| 6     | Implemented                                     | [`phase-6-client-loop-suppression.md`](phase-6-client-loop-suppression.md)           | [`slices/phase-6-client-loop-suppression/`](slices/phase-6-client-loop-suppression/)           |
| 7     | Implemented                                     | [`phase-7-route-operations-coverage.md`](phase-7-route-operations-coverage.md)       | [`slices/phase-7-route-operations-coverage/`](slices/phase-7-route-operations-coverage/)       |
| 8     | Implemented                                     | [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md)                 | [`slices/phase-8-verification-budgets/`](slices/phase-8-verification-budgets/)                 |

## Slice Rules

- One slice should name one implementation batch or proof batch.
- Each slice should include scope, source anchors, protocol behavior, done
  criteria, and validation commands.
- A phase can have many slices, but a slice should be small enough for an agent
  to pick up directly from [`../next-steps.md`](../next-steps.md).
