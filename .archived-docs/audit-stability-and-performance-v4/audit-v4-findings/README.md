# V4 Audit — Detailed Findings

Full-detail companion to the v4 stability/performance audit. The summary
document — IDs, titles, canonical severities, cross-cutting themes, and the
suggested remediation order — is
[`../audit-stability-and-performance-v4.md`](../audit-stability-and-performance-v4.md);
this directory expands every finding with the complete verified record: the
corrected mechanism, impact/trigger analysis, the adversarial-verification
votes and their sharpenings (including empirical measurements), and the fix
sketch.

Audit window: tree `4ccc15194` → `b355586a6` (2026-06-07); the v3 plan's
phases 0-3 landed concurrently and every verdict was checked against the
moving tree. Line numbers were captured in that window and will drift —
symbol names are the durable anchors.

## Files

| File | Contents |
| ---- | -------- |
| [`high-and-medium.md`](high-and-medium.md) | H1-H2, M1-M5 — full depth, per-lens votes, empirical verification results |
| [`low-server.md`](low-server.md) | L1-L16 — server: generation/durable lifecycle, assembly/triggers, persistence/schema/boot, memory, import/export, transport |
| [`low-client.md`](low-client.md) | L17-L38 — client: send path, render/window, translator, stage-4/MCP/media, plugins/auth |
| [`informational.md`](informational.md) | I1-I30 — verified inventory below the low bar, with calibration rationale |
| [`dismissed-and-verified-clean.md`](dismissed-and-verified-clean.md) | R1-R6 refuted candidates (with re-open criteria) + the four verified-clean sweep results |

## How each entry was verified

Every high/medium claim was judged by three independent lenses
(liveness/reachability, mechanism+novelty, severity calibration); every
low/info claim by a lone skeptic instructed to refute. Majority verdicts;
severity is the calibrated median. Where a verifier corrected the finder's
claim, the entry presents the CORRECTED mechanism and notes the original.
Two informational entries (I26, I29) were accepted on the round-3 sweep's
own code-level verification without a separate skeptic pass and are marked
as such.

Entries cite finder candidate ids (`C*` round 1, `S*` round 3) and
verification cluster ids (`U-C*`, `V-S*`); the raw candidate + per-lens
verdict data lives outside the repo (session scratch) — the entries here
preserve everything decision-relevant.

## Reading guide

- Fixing something? Start from the main doc's Suggested Remediation Order,
  then open the matching entry here for the full mechanism, the verifier
  amendments to the fix sketch, and the named in-repo pattern to reuse.
- Re-auditing? Read `dismissed-and-verified-clean.md` first — those
  candidates were refuted against current code and carry explicit re-open
  criteria; do not re-report them without that evidence.
- Findings tagged `extension of vX-YY` sharpen prior-audit items; the prior
  IDs stay owned by their registries
  (`../../audit-stability-and-performance-v3/active-risk-analysis.md`
  for v3, the archives for v1/v2). In particular v4-L11 folded into the v3
  Phase-3 M2 row and v4-L30/L33 into the v3 Phase-5 projection-guard batch.
