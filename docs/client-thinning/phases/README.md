# Client Thinning Phases

Date: 2026-05-30

Historical sequencing for the standalone client-thinning workstream. Phases 0–3
are done; phase 4's A-item implementation is done; phase 5 is the active closeout
track.

- [`phase-0-workstream-extraction.md`](phase-0-workstream-extraction.md) — DONE.
  Extracted client thinning into this folder.
- [`phase-1-baseline-contract.md`](phase-1-baseline-contract.md) — DONE. Locked
  the projection/command/active-writer/guard baseline.
- [`phase-2-audit-reproducibility.md`](phase-2-audit-reproducibility.md) — DONE.
  Committed fixture proof for all 23 audit checks (shallow-rule robustness carried
  to phase 5).
- [`phase-3-command-projection-hardening.md`](phase-3-command-projection-hardening.md)
  — DONE. Closed the command/projection invariant families.
- [`phase-4-sendchat-thinning.md`](phase-4-sendchat-thinning.md) — DONE for A1/A2.
  Server ownership of the chat-process blocker set is landed; its Work Order is
  expanded into step-by-step [`slices/`](slices/README.md).
- [`phase-5-closeout.md`](phase-5-closeout.md) — ACTIVE closeout criteria.
