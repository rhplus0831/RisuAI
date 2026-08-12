# Stage 1 — Re-adjudication of the recorded divergence ledger

Every divergence previously recorded as "confirmed intentional" (six area
docs in `.archived-docs/audit/docs/`), every WORK-INDEX row resolved as
"accepted divergence", and both deferred items, re-scored against the
CHARTER.md bar (fork-point parity unless individually signed off).

Verdicts: `fix` / `keep` (recommendation — needs maintainer confirmation) /
`decide` (maintainer call) / `resolved` (fixed since) / `standing`
(pre-existing individual maintainer decision; not re-litigated).

**Caveat:** original adjudications date to 2026-08-02/03; the protocol waves
(2026-08-11/12) may have moved some of these behaviors. Stage 4 re-verifies
current code before any fix is implemented.

## Maintainer decision queue (the `decide` rows, ranked by user impact)

1. **CA-OR-3 — streaming `editoutput` runs once at finalization; cancel
   persists raw accumulated text.** Original applied output-script
   processing to what the user sees during streaming, and cancellation kept
   processed text. Cutedog-class: display-transforming scripts are the same
   card ecosystem the continue fix served. The `8bf88e43c` disposition
   plumbing shows per-mode gating through streaming is feasible.
2. **CA-ST-5 — Lua globals reset per invocation** (one-use VMs; original
   persisted script globals per mode). Breaks scripted cards that stash
   state in globals across hooks. Architectural cost to restore is real
   (server VM pooling); alternative is documenting `setChatVar` as the
   supported state channel. Needs an explicit call either way.
3. **CA-LM-3 — legacy memory algorithms removed** (SupaMemory, legacy
   HypaMemory, Hypa V2, Hanurai, experimental V3). A migrating Original-Risu
   user with these settings silently gets different context. Minimum-fix
   option: loud migration notice instead of silent divergence.
4. **CA-OR-4 — post-token stream failure restores the pre-generation
   transcript** instead of retaining partial text (original kept it). Users
   notice lost partials; retention is arguably a feature, not an accident.
5. **CA-OR-10 — `autoContinueChat` removed** (`5b751fcbe`, "one user click =
   one append"). A whole Original-Risu setting is dead. The `8bf88e43c`
   append disposition makes a compatible re-implementation more tractable
   than when it was removed.
6. **CA-LM-5 — lorebook regex keys parse conventionally** (original kept the
   leading slash literal and skipped empty-flag regexes). Changes which
   entries activate for existing cards. Check current upstream first: if
   upstream fixed the same quirk post-fork, keeping is ecosystem-aligned.
7. **CA-PA-1 — stable template cards execute state-changing CBS** (setvar
   persists and is stripped; original left directives literal in the
   prompt). Payload + variable-state divergence for cards authored against
   the literal behavior.
8. **CA-ST-4 — `@@emo` is a text no-op** (no emotion-state side effect).
   Cards driving emotion portraits via `@@emo` lose the behavior.
9. **CA-PR-5 — non-ChatML instruct templates sunset on Kobold/Ooba/Horde**
   (WORK-INDEX PR-18/PR-7, `d589297af`). Legacy-transport users get
   different prompt formatting than Original. Product decision made under
   the old policy — re-confirm under the new bar.
10. **CA-OR-5 — legacy fallback lists run primary-first** (original skipped
    the nominal primary when a fallback list existed). Changes which model
    actually serves requests (output + billing visible). The baseline
    behavior may have been intentional upstream, not accidental.
11. **CA-OR-6 — banned-script / blank-response policies buffer streaming**
    before inspecting. Final text equivalent; confirm whether enabling these
    policies suppresses incremental display (if yes, it is a visible
    streaming-UX divergence; if no, flip to `keep`).

## Resolved since original adjudication

| ID | Divergence | Status |
|----|-----------|--------|
| CA-OR-7 | Buffered Continue kept same row identity/metadata (was keep-and-pin, `generation.chat.test.ts:4485`) | `partially resolved` by `8bf88e43c` (append mode only): Stage-2 auditors confirmed extend mode (`useSayNothing` off) still preserves row identity where the baseline reminted it unconditionally — extend-mode residual is CONSOLIDATED.md cluster 13 (`decide`) |
| CA-OR-8 | Single-pass `editoutput` on buffered Continue (WORK-INDEX OR-6, was accepted divergence in `954a97ab6`) | `partially resolved` by `8bf88e43c` (append mode only): extend mode remains single-pass vs the baseline's unconditional two passes — folded into CONSOLIDATED.md cluster 13 (`decide`) |

## Fix

| ID | Divergence | Rationale |
|----|-----------|-----------|
| CA-OR-1 | Lua edit-output failure falls back to raw provider text and skips regex/run-var/output-trigger stages (original continued into regex derivation) | Error-path only, but user-visible on scripted cards; restoring "continue into remaining stages on hook failure" is cheap and matches baseline |

## Keep (recommended — each needs your confirmation to become final)

| ID | Divergence | Why keep |
|----|-----------|----------|
| CA-PA-2 | Global-note positional injection applied once (baseline applied it twice, inside and after `{{original}}`) | Baseline double-application is an accidental duplication; payload divergence noted |
| CA-PA-3 | Non-Hypa `lastMemory` cutoff only advances on an actual trim | Baseline recorded a synthetic marker with no trim; persisted-field delta is benign on round-trip |
| CA-PA-4 | Depth-prompt CBS evaluated once (no re-roll between preflight and insertion) | Baseline re-roll was accidental nondeterminism; `{{random}}` distribution shift noted |
| CA-HC-1 | `setdefaultvar` initializes truly missing variables | Baseline check was dead code (defeated by the `"null"` sentinel); command now does what cards ask; verify current upstream also fixed it |
| CA-HC-2 | Preview does not persist assembly-time chat mutations | Baseline preview mutated the live chat with no rollback — data corruption, not behavior |
| CA-HC-3 | `[Start a new chat]` marker token cost is counted | Correct budget accounting; near-limit trim boundary can differ from baseline (payload flag) |
| CA-OR-9 | Multi-generation alternates process in isolated cloned state | Baseline cross-contamination of side effects between alternates was accidental; var-write differences flagged |
| CA-OR-11 | Request-trigger rewrites are fresh per retry (WORK-INDEX OR-3) | Baseline accumulated rewrites across same-model retries — accidental compounding |
| CA-ST-3 | Global regex scripts execute (baseline stored `db.globalscript` but never ran it) | Deliberate feature (`9fde68341`), aligns with the global-modules direction; migration edge flagged: imported DBs with stale `globalscript` now execute it |
| CA-ST-6 | Sticky-flag action regexes restart from index zero | Edge-case flag semantics; documented at `scripts.ts:55` |
| CA-ST-7 | Unmatched `$1` stays literal (ST-9) | Matches documented JS replace semantics; baseline was quirk |
| CA-PR-1 | Tool execution is browser-owned rounds, not a provider-side loop | Architecture; conversational outcome equivalent |
| CA-PR-2 | Native Ollama forwards sampler options the baseline omitted | Baseline dropped user-chosen samplers — accidental; output-distribution change for Ollama users flagged |
| CA-PR-4 | Bedrock buffered; Mistral incremental | Bedrock matches baseline capability; Mistral is transport timing with identical final text |
| CA-PR-6 | Chat-card systemization uses independent clones (PA-4) | Baseline shared-mutation bleed between cards was accidental |
| CA-PR-7 | Missing prompt-asset bytes are dropped with an SSE warning (HC-8; baseline failed the generation) | Hard-fail on a missing asset is worse UX; the warning keeps it visible |
| CA-PR-8 | Anthropic image order / cache-point placement (PR-14) | Natural order + final-part cache point; provider-internal |
| CA-PR-9 | Equal-length repeated stream deltas kept (PR-12 edge) | Strict-`>` cumulative detection protects legitimate repeats |
| CA-LM-1 | Hypa V3 summaries are separate raw system rows (no `<Past Events Summary>` wrapper) | Structural; near-limit selection shift flagged as payload divergence |
| CA-LM-2 | New Hypa summaries are worker-deferred | One-generation lag vs baseline; avoids blocking the crossing generation |
| CA-LM-4 | Invalid Hypa ratios clamp with diagnostics instead of aborting | Baseline hard abort on bad config was hostile; visible only on invalid configs |

## Standing individual decisions (in force; listed for visibility only)

| ID | Decision |
|----|----------|
| CA-ST-1 | V2 persistent character/persona/note/lorebook effects stay no-op (maintainer, 2026-08-02) — SSE warnings + editor notices landed in `ec124302c` |
| CA-ST-2 | V2/V1 command + privileged effect families stay no-op (same decision; baseline shipped ungated `command` execution — declining the port also declines that) |
| CA-OR-2 | Group-chat generation is a hard no-port (documented, `providers-and-models.md:788`) |
| CA-PR-3 | Non-server-routable providers: NovelAI text, NovelList, non-legacy Ooba, plugin providers, WebLLM (documented platform scoping) |
| — | D1 (bundle-export keep+warn) and D2 (pre-store restore scrub) data-loss decisions, 2026-08-05; revisit triggers unchanged |

## Deferred items (carried forward)

| ID | Item | State |
|----|------|-------|
| CA-DF-1 | Browser-context CBS (`{{screenwidth}}`, browser locale/time) — HC-7 | Description stale per Stage 2 (A-4.claude, E-7.claude): `{{screenwidth}}`/browser-language now parity-restored via reported client context (`67210c623` rider); `{{screenheight}}` regressed in-delta to empty string (third behavior — small fix candidate, CONSOLIDATED.md cluster 13 sweep); server-locale time remains deferred |
| CA-DF-2 | Anthropic `output-128k` beta header — PR-15 | Still open; Stage 2 provider brief includes verifying the current Anthropic API (the right fix may be deleting the finding) |
