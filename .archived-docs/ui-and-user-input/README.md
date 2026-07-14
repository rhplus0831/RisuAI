# UI And User Input Archive

Historical visible-state testing, user-input persistence, and async stale-state
work.

## Visible State

| Record                                                                                               | Scope                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`visible-state/state-contract-hardening/`](visible-state/state-contract-hardening/README.md)        | Stable selectors, visible-state testing policy, DOM regression coverage, browser smoke, and closeout.      |
| [`visible-state/state-contract-hardening/pilot.md`](visible-state/state-contract-hardening/pilot.md) | Completed chat/list UI-state contract pilot that preceded hardening.                                       |
| [`visible-state/behavioral-audit/`](visible-state/behavioral-audit/README.md)                        | Rendered-DOM behavioral audit, original plan, findings, acceptance proof, and remediation recommendations. |

## User Input

| Record                                                                               | Scope                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`user-input/persistence-audits/`](user-input/persistence-audits/README.md)          | Initial and post-fix June 16 persistence audits, kept separate so changed verdicts retain chronology.                           |
| [`user-input/audit-records/`](user-input/audit-records/README.md)                    | Eight domain files consolidating the baseline inventory, verification audit, and stale-state assessment for each input surface. |
| [`user-input/state-hardening/`](user-input/state-hardening/README.md)                | Closed implementation plan that hardened async callbacks, rollback, projection merge, imports, generation, and navigation.      |
| [`user-input/ui-flow-stale-state-audit.md`](user-input/ui-flow-stale-state-audit.md) | June 24 stale-flow audit with its remediation status merged into the same file.                                                 |

Within each consolidated audit record, later verification and stale-state
sections supersede conflicting baseline verdicts. The initial and post-fix June
16 audits remain separate because they describe different code states.
