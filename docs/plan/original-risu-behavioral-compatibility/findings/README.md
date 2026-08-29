# Findings And Decisions

[`findings.json`](findings.json) is the canonical incompatibility and raw-report
mapping register. Validate it against
[`findings.schema.json`](findings.schema.json). [`decisions.json`](decisions.json)
is the authority register for accepted divergences and explicit unsupported
behavior; validate it against
[`decisions.schema.json`](decisions.schema.json). The registers are separate so
discovering a difference cannot implicitly approve it.

Phase 0 imports prior individually signed decisions and maps historical reports.
Historical prose remains source evidence; this directory owns the normalized
current-workstream IDs.

## Finding Rules

- Canonical IDs use `ORC-<CATEGORY>-<number>`, for example `ORC-G-001`.
- A raw report maps exactly once to a canonical finding, a decision, or a
  documented not-a-finding outcome.
- Severity, evidence maturity, verification state, and disposition remain
  independent fields.
- `confirmed` requires both-side code evidence and a reproducible semantic
  difference unless reproduction is impossible and that limitation is recorded.
- A resolved finding keeps its original reproduction and adds implementation
  commit, regression evidence, verification commit, and residual risk.
- Do not mark a difference `signed-keep` or `standing-unsupported` without a
  valid decision ID.

## Decision Rules

- Each decision covers one user-visible divergence or one tightly cohesive
  unsupported boundary.
- Record approver, date, rationale, affected inventory rows, visible behavior,
  diagnostics, tests, and revisit condition.
- Broad statements such as “Fastify behaves differently” are not valid
  authority.
- Imported decisions preserve their original authority and link the archived
  source. Unclear historical outcomes return to `proposed`.
