# Canonical State And Compatibility Retirement Status

Date: 2026-08-31

This is the final execution record. Stable scope lives in [`PLAN.md`](PLAN.md),
phase detail in [`phases/`](phases/README.md), retained operational boundaries
in [`next-steps.md`](next-steps.md), and exact proof in
[`latest-verification.md`](latest-verification.md).

## Final Snapshot

- Plan state: Complete; Phases 0-7 closed.
- Implementation closeout candidate: `993222d82`.
- Current-guide reconciliation: `27c41103d`.
- Compatibility inventory: 28 surfaces and 63 probes, with 7 canonical,
  14 explicit-compatibility, 6 import-only, and 1 removed disposition.
- Workstream 3 release: all persisted-owner dependencies are released; retained
  compatibility rows are final boundaries rather than unresolved migration
  holds.

## Dependency Cursors

| Dependency or release | Cursor | Final state |
| --- | --- | --- |
| Workstream 1 package/boundary conventions | `b01e88b03` | Released. |
| Migration/recovery foundation | `1e758cd22` | Released with named-step, interruption, retry, reopen, and historical-fixture proof. |
| Model configuration canonical owner | `6020f6009` | Released; ordinary consumers use durable profile/runtime owners. |
| Character/chat canonical owners | `7cb62afa8` | Released; legacy embedded rows remain import/recovery inputs only. |
| Prompt-template canonical owner | `998d0c121` | Released; modern selected presets own normal bodies and assembly. |
| Translator canonical owner | `2ffde5c29` | Released; stable-id preset pipelines own translation and authoring. |
| Persona and Hypa selection owners | `86d3fc2b3`, `9f558b7c4` | Released with stable persisted identities. |
| Repair boundary | `223ff37d5` | Released; ordinary reads/commands do not persist unrelated compatibility repair. |
| Interchange and export boundary | `49c9c6f3e` | Released; exports materialize detached owner data and supported inputs normalize explicitly. |
| Final inventory | `993222d82` | Closed at 28 surfaces and 63 probes with final dispositions only. |

## Phase Router

| Phase | Status | Release |
| ---: | --- | --- |
| [0. Inventory and retention policy](phases/phase-0-compatibility-inventory-and-retention-policy.md) | Complete | `cd04b0e11` |
| [1. Migration/recovery foundation](phases/phase-1-migration-and-recovery-foundation.md) | Complete | `1e758cd22` |
| [2. Model configuration](phases/phase-2-model-configuration-ownership.md) | Complete | `6020f6009` |
| [3. Prompt templates](phases/phase-3-prompt-template-ownership.md) | Complete | `998d0c121` |
| [4. Translator/smaller mirrors](phases/phase-4-translator-and-smaller-mirrors.md) | Complete | `2ffde5c29`, `86d3fc2b3`, `9f558b7c4` |
| [5. Repair boundary](phases/phase-5-repair-boundary.md) | Complete | `223ff37d5` |
| [6. Interchange/backups/storage](phases/phase-6-interchange-backup-and-obsolete-storage.md) | Complete | `49c9c6f3e` |
| [7. Verification/closeout](phases/phase-7-verification-and-closeout.md) | Complete | `993222d82`, `27c41103d` |

## Final Compatibility Boundaries

- Model flat inputs, inline-secret repair, prompt root/default storage, loadout
  snapshots/touch fields, legacy backup restore, and bounded command/repository
  recovery remain explicit compatibility actions.
- Persona mirrors and the numeric Hypa pointer remain explicit external-format
  projections; canonical runtime selection uses stable IDs.
- Hypa aliases, translator scalars/synchronization, legacy bot presets, legacy
  database JSON, and RisuSave legacy envelopes are import-only.
- The lorebook-page compatibility replica is removed; the unsupported plugin key
  fails closed.

No execution blocker remains. The intact workstream is ready for archival.
