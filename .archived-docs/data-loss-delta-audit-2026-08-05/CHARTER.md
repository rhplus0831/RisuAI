# Audit charter: Data-loss delta audit (pre-beta), 2026-08-05

Status: DRAFT — pending maintainer review. No audit passes have run yet.

## Purpose

Pre-promotion audit before tagging a beta-status release (target version
~2028.8.1b). The full data-loss audit of 2026-07-21 was remediated and closed
on 2026-07-23 (11 fix commits + residual tier-3 closure; see
`.archived-docs/audit-scopes-2026-07-23/data-durability.md`). This audit does
**not** repeat it. It audits only what changed since.

## Delta under audit

Everything in `28eb3fb66..e1ac763da` (2026-07-23 closure record → HEAD,
2026-08-05): **102 commits, 437 files, ~30.7k insertions**, including the
entire generation-parity remediation, two new schema migrations (v26 → v28),
and several new durable stores. Findings use IDs `DL2-<pass>-<n>` to avoid
colliding with the July audit's A–E series.

## In scope — five passes

### Pass 1 — Round-trip completeness for post-closure stores

Every table/settings key born in the delta must survive device backup →
restore, `.risu` export → import, and (where applicable) the portable-save
no-secret contract — or be *documented* as deliberately excluded.

- **`request_history` (schema v28, `935e49a24`, `19d16c6f0`): named suspect.**
  Pre-audit evidence: zero mentions in `server/fastify/src/repository.ts`
  (backup/restore machinery) and zero coverage in
  `server/fastify/__tests__/backups.test.ts`, while `greeting_translations`
  is allowlisted at `repository.ts:2705` and covered. Determine whether
  exclusion is intentional (telemetry-class data); either fix or document.
- `greeting_translations` (v27): landed with backup coverage on closure day —
  light re-check of write paths only (`repository.ts:509`, `:714`).
- Provider credential store (`providerCredentials`, `c8d39a9c6`): round-trip
  vs the no-secret portable contract (`risuSaveCodec.test.ts` no-secret
  suite) — credentials must round-trip in *device* backups but never leak
  into *portable* exports.
- Reload-durable composer/module draft recovery stores (`2c757ee2b`):
  locate their storage first (not in `db.ts` table list), then decide whether
  backup inclusion is expected.
- New settings keys added across the delta (agent presets `0522cb4cb`,
  prompt-preset archive flags `ee5382a9a`, LLM Gateway options `b11cbdfeb`,
  Strip CoT `28d40ffdc`, floating input `2b3fef527`, Mood Light privacy
  `65884c0ad`, …): enumerate from `databaseDefaults.ts` diff; each needs the
  new-scalar-key hydration pattern (`?? default` + `getValue` fallback) and
  backup allowlist membership.

### Pass 2 — Script-originated durable writes

The delta gave scripts new write access to persistent state; the July audit's
D-class findings were exactly this shape.

- Durable Lua character/lore writes (`492f99e9e`): must route through the
  guarded repository/outbox machinery, re-read state inside
  `withTrustedResourceWrite`, and never insert an `await` into a destructive
  transaction body.
- Persisted `@@inject` rewrites + stable-card re-expansion (`b193042e0`).
- Script message-index preservation (`5f4109fee`) and IGP sequencing after
  server terminal derived text (`400183698`): index-shift/displacement risks
  against concurrent message mutation.
- Lorebook prompt-injection restore (`a4c00c5cb`) and history slots in input
  hooks (`559b61a4b`): confirm read-only or properly guarded.

### Pass 3 — Destructive and confirm-gated flows

- **Reset chats after export confirmation (`2c23cf1f7`): named suspect.**
  The reset must be gated on *verified durable export* (file handed to the
  browser / write completed), not merely on the user clicking confirm.
  Check ordering, error paths, and what happens if export throws mid-way.
- Settings item deletion confirmation (`54e3b529e`): confirm-then-delete
  ordering, latched targets (no upstream `await` before target capture).
- Prompt-preset archive (`ee5382a9a`): archive must be non-destructive and
  reversible; archived presets must survive round-trips (feeds Pass 1).
- Mood Light trashed-bot hiding (`e9119ffce`) and management dialog
  (`588f0fe7c`): hiding must not orphan or GC referenced data.

### Pass 4 — Import boundaries

- Bounded CharX imports (`dc84d3da1`, `85e808621`): bounding must fail loudly
  (mirror `risusave_incomplete_blocks`), never silently truncate assets, and
  clean up staged assets on abort.
- Character/lorebook identity normalization at import and server boundaries
  (`c80c75126`, `d89b0c6d4`, `88066c2a8`): identity rewrite must not orphan
  references (chats, greetings-translation rows, assets) or break the
  lorebook identity-dirty scope contract.
- Post-import greeting display (`64acdef60`): read-only expectation — verify.

### Pass 5 — New-store lifecycle and secrets

- Credential scrub: mask-path removals REQUIRE a load-time scrub in
  `repository.ts` (leak pattern from `c8d39a9c6` e2e probe). Verify scrub
  coverage exists for providers added *after* the store landed: LLM Gateway
  (`d9981b5c5`, `b11cbdfeb`, `0b6ef0dfb`), Neuralwatt (`78e726e2a`).
- `request_history` growth/retention: unbounded durable growth is a
  data-integrity risk (disk exhaustion corrupts everything); check retention
  policy and delete paths.
- `greeting_translations` GC: rows must be cleaned (or deliberately kept) on
  character delete; no dangling-row accumulation.
- Deletion lifecycle of agent-preset modules (`0522cb4cb`,
  `76dcd9f99`): module removal vs presets referencing it.

## Cross-cutting invariants (hold every delta surface against these)

Unchanged from the July charter — re-verified only where the delta touches
them, not globally:

- Destructive repository transaction bodies are synchronous critical
  sections — never add an `await` inside one.
- Optimistic writes wrap in `withTrustedResourceWrite` and RE-READ state
  inside the wrap.
- Outbox rows are scoped by (writerSessionId, databaseLineage); foreign-session
  same-lineage rows are dormant, never deleted; only exact mutation-ID
  settlement may acknowledge.
- Latch interaction targets synchronously before any upstream `await`.
- New scalar settings keys are `undefined` on existing server DBs.
- Restore-journal boot recovery runs before legacy import/routes.
- First-run seeding is client-driven; the server never invents a database.

## Out of scope — do not re-audit

- The July verified-SAFE list: migrations up to v26, future-schema refusal,
  corrupt-DB fail-closed boot, initialize race, receipt-ACK sequencing,
  pre-delta `withTrustedResourceWrite` coverage, ordinary
  delete/branch/copy/regenerate flows, scoped-loader whole-DB write-back.
  (Migrations v27/v28 themselves ARE in scope: up-path on existing DBs.)
- All `ACCEPTED` items in the archived scope files (streamed backup download,
  restore-in-flight lineage rotation, remote/cache-only block skips).
- Dismissed finding IDs from stability/perf audits v1–v4.
- Plugin V2 (permanently unsupported; server support dropped in `fa91e7c15` —
  the *removal commit* is in scope only for orphaned-data checks).
- Generation *correctness* (prompt content, provider behavior) — the parity
  workstream owns that (`docs/audit/WORK-INDEX.md`); this audit cares only
  about durable-state writes those commits perform.

## Method

1. Five read-only audit passes, one per pass above — each run **dual-track**
   (maintainer-approved 2026-08-05): one Codex agent and one Claude subagent
   receive the identical brief (`briefs/pass-<n>.md`) and run independently,
   neither told of the other. Findings must carry file:line evidence and a
   concrete loss scenario (what user data, destroyed how); each brief also
   licenses free-hunt findings inside its pass surface. Raw reports land in
   `reports/<track>-pass<n>.md`.
2. Consolidation by the project manager: dedupe the ten reports into a
   cross-model agreement matrix; every critical/high finding and every
   single-track finding is independently re-verified against the code before
   entering the final report. Agreement is a confidence signal, not proof
   (the parity review validated independent verification: 51/51 real, plus
   3 residual gaps found only during verification).
3. Findings classified with the July severity ladder (critical/high = durable
   user-data destruction or silent loss; medium = artifact-only or
   race-window loss; low = hygiene). Fix commits name their finding ID.
4. **Structural deliverable regardless of findings:** a test that diffs the
   live schema table list against the backup/restore/export allowlists, with
   an explicit documented-exclusion list — so the A-5 class (new table
   missing from round-trip) is caught at table-creation time by CI, not by
   the next audit.

## Exit criteria

- Every critical/high finding fixed with a regression pin, or explicitly
  `ACCEPTED` by the maintainer with a trigger condition.
- The allowlist-completeness test (Method §4) landed.
- This charter updated with per-pass outcomes, then archived to
  `.archived-docs/` per the audit-closure policy.

## Sources

Memory: `data-loss-audit-2026-07-21`, `provider-credential-store`,
`lorebook-identity-dirty-scope`, `per-chat-sparse-field-pattern`,
`new-scalar-settings-key-hydration`. Archive:
`.archived-docs/audit-scopes-2026-07-23/` (charter format, verified-safe
lists, ACCEPTED registry). Delta: `git log 28eb3fb66..e1ac763da`.
