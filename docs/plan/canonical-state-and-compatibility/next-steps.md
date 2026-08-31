# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Closed Workstream

Phases 0-7 are complete. There is no remaining implementation slice. Preserve
the compatibility baseline beside this plan when archiving it under
`.archived-docs/architecture-and-migration/` and update the architecture
inventory's canonical path in the archival commit.

## Retained Follow-Up Triggers

- Remove an explicit compatibility surface only through a new, separately
  approved migration after its supported reader/exporter contract is retired.
- Keep legacy/import normalization out of ordinary commands and runtime reads.
- Keep the final 28-surface/63-probe inventory gate active after archival so a
  new mirror, fallback, or repair boundary cannot appear silently.
- Treat broad typecheck, full-suite, and browser-matrix reruns as CI/release
  responsibilities; focused closeout evidence is recorded in
  [`latest-verification.md`](latest-verification.md).
