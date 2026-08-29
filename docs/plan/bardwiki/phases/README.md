# BardWiki Phase Index

The phases are intentionally sequenced so the feature remains useful and
testable before autonomous model-authored canonical updates are enabled.

- [Phase 0: Contract and Architecture](phase-0-contract-and-architecture.md)
- [Phase 1: Persistence and Server Resources](phase-1-persistence-and-resources.md)
- [Phase 2: Settings and Manual Workspace](phase-2-settings-and-workspace.md)
- [Phase 3: Deterministic Prompt Retrieval](phase-3-prompt-retrieval.md)
- [Phase 4: Durable Jobs and Explicit Confirmation](phase-4-jobs-and-explicit-confirmation.md)
- [Phase 5: Automatic Confirmation and Canonical Updates](phase-5-automatic-and-canonical-updates.md)
- [Phase 6: Lifecycle, Rebuild, and Interchange](phase-6-lifecycle-and-interchange.md)
- [Phase 7: Verification and Closeout](phase-7-verification-and-closeout.md)

## Execution Rules

- Read [`../status.md`](../status.md), [`../PLAN.md`](../PLAN.md), and the
  current phase before editing runtime code.
- Re-resolve source anchors by symbol at the start of every phase.
- Do not combine dependent phases merely because their files overlap.
- Server authority and durable state must land before UI assumes it exists.
- Provider calls stay outside SQLite transactions.
- Background work cannot become the only source of replayable domain
  invalidation; committed document changes require command events.
- Each phase updates its own completion note and [`../status.md`](../status.md)
  with validation commands and remaining gaps.
- Run Prettier and the focused owning tests before closing a phase.
- Use `pnpm`; follow the test-watcher guidance in the repository `AGENTS.md`.
