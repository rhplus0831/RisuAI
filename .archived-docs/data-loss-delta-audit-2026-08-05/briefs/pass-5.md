# DL2 data-loss delta audit — Pass 5 brief: New-store lifecycle and secrets

You are a read-only data-loss auditor for the RisuAI fastify repository at
`/home/codex/risuai-fastify` (branch `fastify`). This brief plus the charter
it references is your complete assignment.

## Assignment

1. Read `docs/audit/data-loss-delta-2026-08-05/CHARTER.md` in full.
2. Your surface is the charter section **"Pass 5 — New-store lifecycle and secrets"**. Work
   every enumerated check in that section to a verdict.
3. Honor the charter's "Out of scope — do not re-audit" list, and hold every
   delta surface against the charter's "Cross-cutting invariants".
4. The delta under audit is `28eb3fb66..e1ac763da` (use `git log` / `git
   show` freely; the charter's commit hashes locate surfaces). Audit the
   code at HEAD — the live code is the truth, not the charter's
   descriptions. Where the charter names pre-audit suspects, treat them as
   hypotheses to confirm or refute, not as established findings.
5. Free hunt: also report any data-loss risk you notice inside your pass
   surface that is not on the enumerated list. Do not wander into other
   passes' surfaces.

## Hard rules

- READ-ONLY: do not modify, create, or delete any repository file, and run
  no state-mutating commands (no git write operations, no installs, no dev
  servers, no test-suite runs). Single exception: create your report file at
  the exact path given in your task instructions.
- Findings without file:line evidence and a concrete loss scenario are
  worthless — every finding must name what user data is destroyed, by what
  exact sequence.
- Prefer depth over breadth: a check marked UNRESOLVED with an honest
  explanation of what blocked you beats a hollow SAFE.

## Severity and confidence

- **critical / high** — durable user-data destruction or silent loss.
- **medium** — artifact-only loss, or loss confined to a race window.
- **low** — hygiene / hardening.
- Confidence: **certain** (traced end-to-end in code) | **probable** (strong
  evidence, one link unverified) | **speculative** (plausible mechanism, a
  key link unconfirmed — say which link).

## Required report format (markdown)

```markdown
# DL2 Pass 5 report — <track name from your task instructions>

## Checks
One bullet per enumerated charter check for this pass:
- <check> — SAFE | FINDING DL2-P5-<k> | UNRESOLVED — 1-3 lines of
  file:line evidence (SAFE claims need evidence too; UNRESOLVED must say
  what blocked resolution).

## Findings
### DL2-P5-<k> — <short title>
- Severity: <severity> / Confidence: <confidence>
- Evidence: file:line citations + the decisive short code excerpt
- Loss scenario: user does X → system does Y → data Z is durably
  lost/corrupted
- Fix direction: 1-2 lines

## Free-hunt findings
Same finding format, IDs DL2-P5-F<k>.

## Not examined
Explicitly list anything in your surface you did not reach.
```
