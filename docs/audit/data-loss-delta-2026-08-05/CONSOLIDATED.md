# DL2 consolidated conclusion — data-loss delta audit, 2026-08-05

Consolidated and independently verified by the project manager from the ten
dual-track reports in `reports/` (five matched Codex/Claude pairs, identical
briefs, mutually blind). Every critical/high claim and every single-track
finding was re-verified against HEAD (`e1ac763da`) before inclusion; verified
evidence lines are cited from my own reads, not copied from the reports.
Read-only discipline held: tracked diff hash unchanged before/after all ten
runs; the only new files are this workstream's briefs/reports.

## Headline verdict

**Hold the beta tag until the three HIGH items land.** Two are silent
generation-time data loss introduced by delta commits; one is a secret-residue
disclosure. The medium cluster C4–C7 shares one root cause (assembly
persistence not fenced to its own baseline) and should be fixed as one unit,
ideally also pre-beta. Everything else can be batched post-tag or explicitly
ACCEPTED.

## Cross-track agreement matrix

| Pass | Codex verdicts | Claude verdicts | Resolution |
| --- | --- | --- | --- |
| 1 round-trip | 1 finding (credentials in portable exports, high) | 4 findings (all ≤ medium); refutes charter's no-secret hypothesis | Facts agree; Codex's "finding" is documented contract → reclassified DECISION D1 |
| 2 script writes | 3 findings (1 high, 2 medium) | 5 findings (1 high, 4 medium) | Disjoint highs — BOTH real (C1, C2); transcript-replacement finding found by both (C5) |
| 3 destructive | 2 findings (medium) | 3 findings (medium/low) | Reset-fence found by both (C7); cold-stub (C8) and archive-flag (C12) each single-track, both verified |
| 4 import | 2 findings (medium) | 5 findings (medium/low) | module.risum truncation found by both (C9); dup-id greeting misassociation (C13) Codex-only, verified |
| 5 lifecycle | 2 findings (both high) | 2 free-hunt lows | Nested-secret scrub gap (C3) Codex-only, verified — Claude's SAFE covered only top-level; retention facts agree, severity settled at medium (C11) |

Model-diversity outcome: 6 of the 16 verified defects were found by exactly one
track (Codex-only: C1, C3, C12, C13; Claude-only: C2, C8, C10, plus most lows) —
the dual-track design earned its cost. Zero findings were refuted during
verification; one charter hypothesis was refuted (D1).

## HIGH — fix before the beta tag

All three RESOLVED 2026-08-05: C1+C2 in `ce5d74b18`, C3 in `a72d0a680`
(regression-pinned; both typechecks green).

### C1 — Input-trigger Lua lore writes are silently dropped — FIXED `ce5d74b18`
(codex-pass2 DL2-P2-1; high/certain; VERIFIED)
`applyInputTrigger` hands the trigger a shallow copy
(`assemble.ts:1078-1080`); `upsertLocalLoreBook` reassigns `localLore` on that
copy (`luaRuntime.ts:1842-1857`); the copy is adopted only when the transcript
changed (`assemble.ts:1092-1098`), and `buildLocalLoreMutation` reads
`state.currentChat.localLore` (`assemble.ts:1315-1317`). A lore-only input
trigger therefore persists nothing, silently. (Output triggers pass the real
object at `assemble.ts:2710` and are unaffected.)
Fix direction: merge durable non-transcript fields from the trigger result
into assembly state unconditionally; keep the conditional adoption only for
`message`.

### C2 — Legacy id-less `localLore` + Lua lore upsert kills the whole finalization, silently inline — FIXED `ce5d74b18`
(claude-pass2 DL2-P2-1; high, mechanism certain / precondition probable; VERIFIED)
`validateLocalLoreEntryIds` requires every entry to carry an id and throws
`ValidationError` (`generationChat.ts:2746-2761`), which is terminal
(`:2970-2972`); the lore apply shares the atomic mutate with the assistant
message append (`:2839-2878+`), so the generated message rolls back too; the
inline path swallows the error with no frame (`:2118-2128`). Pre-identity-work
chats keep id-less entries indefinitely (no load-path repair).
Fix direction: mint ids for id-less pre-existing entries at the finalization
boundary (repair-and-continue), never reject the message persist over them.

### C3 — Pre-store inline secrets survive unmasked inside preset tables — FIXED `a72d0a680`
(codex-pass5 DL2-P5-1; high/certain; confidentiality loss; VERIFIED)
At the delta base, preset save copied `modelProfiles` wholesale
(`28eb3fb66:database.svelte.ts:4948+`), when profiles could carry inline
`providerOptions.apiKey`/Vertex keys. The load-time scrub touches only
`settings.modelProfiles` (`repository.ts:270-293`, applied at `:358`);
preset rows hydrate unrepaired (`repository.ts:1448-1462`), and
`PROVIDER_SECRET_PATHS` has no `botPresets[*].modelProfiles[*]` /
`modelPresets[*].modelProfiles[*]` entries (`providerSecretMask.ts:12-55`) —
so pre-upgrade rows serve raw keys to the client and into the bug-report
export.
Fix direction: extend the scrub to nested `modelProfiles` in both preset
tables (transactional, before any read); add nested mask paths as defense in
depth; regression-pin via a pre-store fixture row.

## MEDIUM — the assembly-persistence staleness cluster (fix as one unit)

All three RESOLVED 2026-08-05 in `f4356c498`: assembly persist is strict
(per-key chat-var freshness + live-vs-`initialMessages` fence before the
transcript replacement); finalization drops conflicting script mutations
individually while always persisting the assistant message, surfacing drops
via the additive `warning` SSE event (`stale_generation_script_mutations`),
retry metrics/logs, and a persisted-only `messagePatch`.

### C4 — Assembly scriptstate writes overwrite newer values — FIXED `f4356c498`
(codex-pass2 DL2-P2-2; certain; VERIFIED) `persistAssemblyMutations` applies
`Object.assign(chat.scriptstate, patch)` with no per-key `before` validation
(`generationChat.ts:1469-1477`) and reads `baseRevision` only after assembly
(`:1439`). The finalization-path validator
(`validateGenerationChatVarMutationsFresh`) exists but is unused here.

### C5 — Full-transcript replacement fallback clobbers concurrent writes — FIXED `f4356c498`
(codex-pass2 DL2-P2-3 + claude-pass2 DL2-P2-F2; cross-track agreement;
certain; VERIFIED) When append isn't possible, persistence calls
`replaceActiveChatMessages` with only id-uniqueness checks
(`generationChat.ts:1479-1491`) — no live-vs-baseline comparison. Delta
commits widened the trigger surface (agent-preset before-main input modifier
with awaited LLM calls; id-less `@@inject` fallback,
`assemble.ts:1815-1831`).

### C6 — Freshness checks that DO exist fail the whole generation, silently inline — FIXED `f4356c498`
(claude-pass2 DL2-P2-2; certain; VERIFIED) Character-field/local-lore
freshness runs unconditionally inside the finalization mutate
(`generationChat.ts:2858-2867`); staleness (a routine concurrent user edit
during a long stream) throws terminal `ValidationError`, rolling back the
assistant message; inline continue/regenerate swallows it (`:2118-2128`).
Fix direction for C4–C6 together: fence assembly/finalization persistence to
an assembly-start baseline; on per-key staleness drop only the conflicting
script mutation (persist message + rest, emit warning frame), never the
generated message.

## MEDIUM — other verified defects

### C7 — Export-then-reset is not fenced to the exported state — FIXED `eb8136cde` (with L8)
(codex-pass3 DL2-P3-1 + claude-pass3 DL2-P3-F1; agreement; VERIFIED)
Messages landing between export completion and the double-confirmed reset
(unbounded dialog dwell; SSE keeps the revision cursor fresh) are deleted and
exist in no export. Fix: compare per-chat last-message identity against the
export-time snapshot at dispatch; abort and re-prompt on drift.

### C8 — Cold-storage stub chats export as pointer stubs the reset then orphans
(claude-pass3 DL2-P3-1; probable; VERIFIED at mechanism level)
`exportAllChats` serializes `char.chats` as-is (`characters.ts:1049-1060`);
for upstream-migrated cold-storage chats the durable rows ARE the pointer
stub; cold-storage GC/creation are no-ops in this fork
(`coldstorage.svelte.ts:71-77`). Fix: detect `coldStorageHeader` pointers and
inline-resolve or fail the export loudly.

### C9 — CharX import silently truncates: oversized `module.risum` (scripts lost) and oversized data-URI assets — FIXED `932386424`
(codex-pass4 DL2-P4-1 + claude-pass4 DL2-P4-1/P4-2; agreement; VERIFIED)
Entries >50MB are excluded with `excludedFiles` having zero consumers
(`processzip.ts:349-355`); export moves trigger/regex scripts exclusively
into `module.risum` (`characterCards.ts:1561-1578`), so the import succeeds
without them. Data-URI variant flashes an alert that progress/success
overwrite. Fix: fail the import (mirror `risusave_incomplete_blocks`) when
any card-referenced or module entry was excluded.

### C10 — Server Lua `setDescription` is silently non-durable
(claude-pass2 DL2-P2-F1; certain; VERIFIED) `characterFieldSnapshot` tracks
only `name`/`firstMessage`/`backgroundHTML` (`assemble.ts:788-794`);
`setDescription` mutates only the request snapshot (`luaRuntime.ts:1788-1792`).
SPA persisted it durably — a parity gap missed by ST-3's four-setter scope.
Fix: add `desc` to the tracked field set.

### C11 — `request_history` is count-bounded but not byte-bounded
(codex-pass5 DL2-P5-2, severity settled medium: facts agreed by both tracks;
default limit 20 caps typical growth, but 10,000×unbounded rows can exhaust
the volume shared with `risu.db`). Fix: per-field byte caps + total byte
budget in pruning.

### C12 — Standalone preset export drops the `archived` flag
(codex-pass3 DL2-P3-2; certain; VERIFIED — `archived` appears in
`presetSplit.ts` only as a type at `:153`, never in `PROMPT_PRESET_FIELDS`;
`promptPresetExportPayload` feeds both JSON and `.risup`). Organization
metadata only. Fix: include+normalize `archived` in the export payload.

### C13 — Duplicate-`chaId` portable import misassociates greeting translations
(codex-pass4 DL2-P4-2; mechanism certain, narrow precondition; VERIFIED —
extraction stamps rows with pre-normalization `chaId`
(`importSnapshot.ts:243-253`, `:291-305`) before the dup remint
(`commands/characters.ts:72-80`)). Cache-class rows; same-index+hash dups
reject the whole import instead. Fix: normalize identities before extraction.

### C14 — Asset-GC grace can reclaim staged assets of a >60-minute import
(claude-pass4 DL2-P4-F2; speculative wall-time precondition; mechanism
verified — `ASSET_GC_GRACE_MS` = 60 min by file mtime, no staged-asset
refresh during import). Fix: refresh staged mtimes or take an import lease.

## DECISIONS for the maintainer (not defects)

### D1 — Portable `.risu` exports carry raw provider credentials
(codex-pass1 DL2-P1-1 vs claude-pass1 refutation; facts agreed; VERIFIED —
documented contract at `docs/structure/assets-and-saves.md:320`: "Included
unmasked in whole-database settings; portable save files must be handled as
secrets".) Not a regression (inline keys exported identically pre-store).
Decide before beta: keep (then surface a user-facing warning at export time
and in release notes) or split portable-content exports from device backups
and redact there. The charter's hypothesis is retired either way.

### D2 — Restoring a pre-2026-07-23 backup destroys inline profile secrets without minting credentials
(claude-pass1 DL2-P1-2; deliberate, test-pinned
`staleInlineModelProfileSecrets.test.ts:119`; VERIFIED.) Decide: ACCEPT with
a user-facing notice when the scrub fires, or mint `providerCredentials`
rows from scrubbed inline secrets (mirroring the legacy-scalar conversion).
Note: fixing C3 by widening this same scrub raises the same question for
preset rows.

## LOW — batch or accept

- L1 request_history absent from in-code exclusions comment + no allowlist
  test (claude-pass1 DL2-P1-1; VERIFIED — `repository.ts:2684-2689` lists
  three of four exclusions) — FIXED `7f60b8585` (exclusions registry +
  Method §4 test).
- L2 request_history survives device restore across lineage rotation —
  previous install's transcripts readable (claude-pass5 DL2-P5-F1; certain)
  — FIXED `7f60b8585`: DECIDED clear-on-restore (stays excluded from
  backups as device-local telemetry; both restore branches clear it; policy
  doc updated).
- L3 `floatingChatInput` settings item lacks `getValue ?? true` fallback
  (claude-pass1 DL2-P1-F1; VERIFIED; display-only).
- L4 Import stores `__RISU_SECRET_MASKED__` placeholders as literal
  credentials (claude-pass1 DL2-P1-F2; VERIFIED —
  `resolveMaskedProviderSecretPlaceholders` is absent from the import path).
- L5 Agent-only lorebook repair silently blanks activation fields on
  imported third-party cards (claude-pass4 DL2-P4-F1; VERIFIED —
  `lorebooks.ts:608-615`).
- L6 CharX importer ignores fflate's per-entry error argument
  (claude-pass4 DL2-P4-F3; speculative; hygiene).
- L7 One invalid `greeting_translations` row bricks every broad character
  write (claude-pass5 DL2-P5-F2; mechanism VERIFIED —
  `replaceAllCharactersInTable` validates all rows up front,
  `repository.ts:505`; precondition speculative). Snapshot path should drop
  invalid cache rows instead of throwing.
- L8 10-second blob-URL revoke vs slow save-as exports gating the reset
  (claude-pass3 DL2-P3-F2; speculative browser-behavior link) — FIXED with
  C7 in `eb8136cde` (reset-gating export skips revocation).

## Structural deliverable (Method §4 — land regardless)

LANDED `7f60b8585`: `SQLITE_BACKUP_EXCLUDED_TABLES` (table → rationale:
`push_subscriptions`, `database_metadata`, `command_mutation_receipts`,
`request_history`, `schema_version`) exported beside the allowlist, plus a
backups test that enumerates the production schema and fails on any table
in neither set, in both sets, or stale in either. Closes the A-5 recurrence
class that produced L1/L2 and the charter's Pass-1 suspicion. (The
enumeration confirmed zero unclassified tables at landing time.)

## Suggested remediation order

1. C1 + C2 + C10 (one workstream: server Lua write durability; shared files)
2. C3 (+ D2 decision, same scrub surface)
3. C4 + C5 + C6 (assembly persistence fencing, one design)
4. C7 (+ L8) and C9 (loud import/export incompleteness)
5. Method §4 test + L1/L2 decision + D1 decision (pre-beta release notes)
6. C8, C11–C14, L3–L7 as a batch

## Verification notes

- Verified myself line-by-line: C1–C6, C8 (mechanism), C10, C12, C13, D1,
  D2, L1, L3, L4, L5, L7. Accepted on cross-track agreement with consistent
  citations after spot-checks: C7, C9, C11. Recorded with reporter
  confidence, mechanism-only checks: C14, L2, L6, L8.
- The eleven pre-existing `sendChat.fixtures.serverBacked` baseline failures
  are unrelated to every finding above (no finding relies on test behavior).
- Reports' "Not examined" sections were compared for coverage holes: every
  deferred item is owned by another pass or explicitly out of scope; no
  surface fell between passes.
