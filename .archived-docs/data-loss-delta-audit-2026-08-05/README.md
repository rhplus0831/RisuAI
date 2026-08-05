# August 5, 2026 Data-Loss Delta Audit (DL2)

Archived after full closure on 2026-08-05, the same day the audit ran. This
was the pre-beta data-loss audit of delta `28eb3fb66..e1ac763da` (102
commits landed after the 2026-07-23 audit closure), executed as five matched
pairs of Codex + Claude auditors on identical briefs (mutually blind),
consolidated and independently verified by the project manager.

Outcome: **16 verified defects, all fixed with regression pins the same
day**; two maintainer decisions recorded (D1 keep+warn — implemented; D2
ACCEPTED with fork-point evidence and a revisit trigger); the Method §4
backup-allowlist completeness test landed in CI, converting the recurring
A-5 bug class (new durable table silently missing from round-trips) from an
audit finding into a CI failure.

These documents are a historical record, not a source of current behavior;
line numbers and contracts may have drifted. Fix commits are listed in the
headline of [CONSOLIDATED.md](CONSOLIDATED.md).

## Contents

- [CHARTER.md](CHARTER.md) — scope, the five pass definitions, dual-track
  method, exit criteria.
- [CONSOLIDATED.md](CONSOLIDATED.md) — the closed conclusion: cross-track
  agreement matrix, all findings with verification verdicts and fix
  commits, D1/D2 decision records, verification notes.
- [briefs/](briefs/) — the five identical per-pass auditor briefs.
- [reports/](reports/) — the ten raw dual-track pass reports
  (`codex-pass<n>.md` / `claude-pass<n>.md`), preserved verbatim.

## Method note (why dual-track)

Six of the sixteen defects — including all three highs — were found by
exactly one of the two model tracks, and zero findings were refuted during
independent verification. The cross-model agreement matrix plus
adversarial re-verification of every high and every single-track finding
is the reusable shape for future pre-release audits.
