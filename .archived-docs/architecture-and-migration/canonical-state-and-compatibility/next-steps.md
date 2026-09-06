# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Closed Workstream

Phases 0-7 are complete and this plan is archived intact. The compatibility
baseline remains beside it at the canonical path consumed by the architecture
inventory.

## Retained Follow-Up Triggers

- Remove an explicit compatibility surface only through a new, separately
  approved migration after its supported reader/exporter contract is retired.
- Keep legacy/import normalization out of ordinary commands and runtime reads.
- Keep the final 28-surface/63-probe inventory gate active after archival so a
  new mirror, fallback, or repair boundary cannot appear silently.
- Treat broad typecheck, full-suite, and browser-matrix reruns as CI/release
  responsibilities; focused closeout evidence is recorded in
  [`latest-verification.md`](latest-verification.md).
