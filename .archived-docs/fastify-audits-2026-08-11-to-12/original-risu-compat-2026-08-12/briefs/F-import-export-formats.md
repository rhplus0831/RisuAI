# Brief F — Import/export formats & remaining UI-visible flows

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**data formats Original Risu must round-trip** (character cards, CharX,
CHAT files, presets, bundles) and **UI-visible flows changed in the delta**
(import acceptance/rejection, translation display).

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. Two directions BOTH matter:
  (1) files Original Risu produces must import with fork-point-equivalent
  results; (2) files this fork exports must be readable by Original Risu
  with equivalent content.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences:
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md` and the
  intentional sections under `.archived-docs/audit/docs/`. Report only NEW
  divergences, or evidence an adjudicated entry no longer matches code.
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree), plus a concrete repro
  scenario (a specific file shape + action → divergent result).

## Delta entry points (start here, then follow the code)

- `cc0a862af` truthful character creation/import completion — does truthful
  failure now REJECT files the fork point (and Original Risu) accepted
  tolerantly? Enumerate newly-rejecting paths.
- `43ac4a1cc` standalone CHAT save-block diagnostic + `23d3e98f6` bundle
  missing/orphaned asset surfacing — same question: stricter-than-baseline
  acceptance is a compat break even when the error message is nice.
- `bcc9727db` + `932386424`-era CharX prebuilt-asset exclusions — is every
  exported CharX still readable by Original Risu, with no assets Original
  would have included silently missing?
- `59f4b3552` Kobold URL normalization (claims baseline parity — verify
  against the worktree) + Ooba legacy streaming disable.
- `4ed196b1f` stored user translations in bot-only mode — compare bilingual
  display rules against fork-point `translator.ts` behavior.
- Export writers under `src/ts/characters/` / `src/ts/process/` and their
  server counterparts; check schema-version gates added in the delta
  (v27–v31) never leak into exported formats.

## Report format

Findings with IDs `F-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
