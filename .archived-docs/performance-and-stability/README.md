# Performance And Stability Archive

Chronological performance investigations and their closed remediation records.

| Record                                                    | Scope                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`frontend-performance/`](frontend-performance/README.md) | Frontend deep-clone and projection-write narrowing.                                    |
| [`stability-audits/`](stability-audits/README.md)         | Four chronological audit universes, their remediation records, and completeness gates. |

The four versions are intentionally not merged: repeated finding IDs belong to
different audit universes. The main audit and active-risk files in v1-v3 are
also parsed by live `fixCompletenessGate*.test.ts` tests.
