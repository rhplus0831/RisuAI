# Stage 4 — Consolidated finding ledger (working)

75 raw findings from 12 reports (6 briefs × Codex/Claude blind pairs),
deduplicated into the clusters below. `sources` cite report findings as
`<brief>-<n>.<track>`. Verification: every cluster starts `pending`;
`verified`/`refuted`/`adjusted` set only after the project manager confirms
the claim in current code. Dispositions are proposals until the maintainer
signs off.

## Tier 1 — fix candidates (verify first)

| # | Cluster | Sources | Sev | Proposed | Verify |
|---|---------|---------|-----|----------|--------|
| 1 | Output-trigger `sendAIprompt` resend runs as append-mode Continue: literal `*says nothing*` baked into the auto-follow-up assistant row + its payload (introduced by `8bf88e43c` over a pre-delta carrier) | E-1.claude | high | fix: route server-requested resends as plain sends | **CONFIRMED** (PM 2026-08-12: `index.svelte.ts:653` resend→`continue:true`; `assemble.ts:3087-3093` append→`continueBase='*says nothing*'`; baseline `index.svelte.ts:1762` plain `sendChat({signal})`) |
| 2 | Legacy monolithic `.risup`/preset-JSON imports became prompt-only: provider/model half dropped, sampler values inert (in-delta `a14730dac`; regression vs fork point AND pre-delta fork) | F-2.claude, F-1.codex | high | decide: `a14730dac` was a deliberate "prompt-only" boundary (comment in code), but has no sign-off row; middle option = route model-bearing legacy files back through the still-live `addImportedLegacyPreset` (`database.svelte.ts:6270`) | **CONFIRMED** (PM 2026-08-12: detector deleted by `a14730dac`; HEAD comment declares intent; sampler overrides inert without `overrideModelParameters`) |
| 3 | Stop before operation acceptance removes the user's just-sent message from the transcript (fork point never unwound a sent turn) | B-5.codex, D-5.codex, D-2.claude | high | decide: deliberate cancel-first tombstone design (wave 4); fork-parity alternative = keep the accepted row, cancel only the generation; composer draft is preserved either way | **CONFIRMED** (PM 2026-08-12: append `generationOperations.ts:453`, rollback `:1084-1091`, tombstone `routes/generationOperations.ts:731,739`; baseline abort paths never touch the sent row) |
| 4 | Continue with a non-empty composer no longer sends/consumes the typed text (fork: pushed user row + merged into continued reply into one char row) | A-2.claude | med | decide, lean fix: baseline merge is a footgun but the bar is parity; the guard predates the delta (present at `f2dc174f4`), so this is an exposed pre-delta divergence the parity audit's "verified clean" missed | **CONFIRMED** (PM 2026-08-12: HEAD `DefaultChatScreen.svelte:1647` `!continueResponse` guard on build+clear; baseline ran input trigger + pushed row + cleared composer unconditionally) |
| 5 | Legacy Kobold endpoint URL joining is not fork-point parity for path-bearing URLs — `59f4b3552` claimed parity | A-5.claude, F-4.claude, F-5.codex | low | fix (the commit's own contract): baseline rule = replace path only when `pathname.length < 3`, else post to the user path verbatim; if the segment-join is kept for modern servers it needs compatibility gating + a sign-off row | **CONFIRMED** (PM 2026-08-12: HEAD `kobold.ts:78-95` overlap-join vs baseline `request.ts:960-962` pass-through) |
| 6 | Retrying an interrupted accepted send can append + transform the user turn a second time (needs an `editinput`/input-trigger transform + restart + manual retry) | D-1.codex | med-high | fix: key retry idempotency to `acceptedMessageId`, don't rerun committed submit transforms | **CONFIRMED** (PM 2026-08-12: retry tail check `routes/generationOperations.ts:889-892` is ID+role only; dedup `assemble.ts:1029` keys on raw `data` equality) |
| 7 | Settled Stop can hide the Stop control for a later live Continue/Regenerate (7a); graceful shutdown/startup sweep force-terminalizes `stopping` → `cancelled` before the runner persists the streamed partial (7b) | D-2.codex, D-3.codex | high | fix both: scope cancellation controls to the active operation/job; never terminalize `stopping` without a committed result or replayable cancellation-finalization record | **CONFIRMED** (PM 2026-08-12: 7a — control = last-per-chat `.at(-1)` `DefaultChatScreen.svelte:392-395`, settled state hard-overrides live activity `:412-428`; 7b — `app.ts:296-306` transitions `stopping`→`cancelled` then settles runners) |
| 8 | Effect-ledger/patch-path defects: (8a) Lua `setDescription` permanently lost — mutation contract is `name\|firstMessage\|backgroundHTML` only; (8b) claimed durable effect strands forever (recovery selects `pending` only, no lease); (8c) terminal message-patch applier has no character/lore handling (staleness until event-stream heal); (8d) one AbortController per memory batch — cancelling one job aborts siblings and can exhaust their attempts | E-2.codex, E-4.codex, E-6.codex, E-5.codex | med | fix all four (fork-only infra defects, no parity tradeoff); 8a also a parity break (baseline `setDescription` persisted) | **CONFIRMED** (PM 2026-08-12: `assemble.ts:376-380` key union; `generationEffects.ts:276,319-320`; `serverMessagePatch.ts` zero hits for character/lore mutations; `memoryWorker.ts:206-215` shared controller) |
| 9 | Half-streaming Stop: partial vanishes from display while server persists it; row later resurrects as a ghost on rehydration (local-provider variant loses the partial entirely) | C-2.claude | med | fix (defect in `ba5bd8be5`'s empty-row cleanup interacting with buffer-until-done; non-half-streaming cancel confirmed clean) | **CONFIRMED** (PM 2026-08-12: `serverChat.ts:1079-1088` half-stream records throughput only, `result` stays `''`; `streamResponse.ts:266-275` abort path splices the empty row; server persists raw partial independently) |
| 10 | Replay caps can evict the prompt needed to consume the canonical terminal; retried extend-Continue reattach can transiently duplicate partial | C-4.codex, C-3.codex | med | fix if reproducible — repro assigned to the Stage-3 harness / fault-injected test before fix-queue admission | PLAUSIBLE (mechanism-consistent; not independently traced; both transient-display class) |

## Tier 2 — maintainer decisions (parity vs deliberate fork behavior)

| # | Cluster | Sources | Proposed | Verify |
|---|---------|---------|----------|--------|
| 11 | Append-mode streaming Continue: new assistant row streamed from empty vs fork's in-place extension of the durable say-nothing **user-role** row (display + persistence + row identity) | B-3.codex, C-1.codex, B-1.claude, C-1.claude | decide: fork-point behavior is itself odd (user-role continuation row); recommend keep new-assistant-row, sign off as divergence | pending |
| 12 | Append-mode Continue boundary transient vs fork's durable pre-dispatch persist (failure/cancel leaves different residue; cancel display/persist mismatch) | B-4.codex, C-2.codex, B-3.claude, A-3.claude | decide: recommend keep transient EXCEPT resolve the display-vs-persisted mismatch on cancel | pending |
| 13 | Extend-mode buffered Continue keeps row identity + single-pass `editoutput` (baseline reminted + double-ran regardless of say-nothing) — the deliberate `8bf88e43c` design, but unsigned under the charter | B-1.codex, B-2.codex, A-1.codex, B-4.claude, B-5.claude, E-6.claude | decide: sign off extend-mode as the fork's explicit mode (ADJUDICATION CA-OR-7/8 corrected to "partial") | pending |
| 14 | Non-Hypa context-truncation confirm gate (`656be4b1e`) blocks sends the fork silently trimmed | A-1.claude, D-3.claude | decide: recommend keep (deliberate feature); sign-off row needed | pending |
| 15 | Script-write conflict fencing: post-gen writes dropped on live-state conflict vs fork last-writer-wins; whole-array local-lore fence drops the entire scripted lore result on ANY unrelated concurrent edit; assembly-stage conflicts hard-fail | E-2.claude, E-3.codex | decide: keep per-key fencing (data-loss C4-C6 policy), but the coarse whole-array lore fence deserves a per-entry semantic op — recommend fix for that sub-item | **CONFIRMED** (mechanism pinned by `generation.chat.test.ts:4668-4811`, `durableGeneration.test.ts:2624-2745` — deliberate design, divergence real) |
| 16 | Queued finalization terminally dropped (message + side effects) if the transcript moves before replay — and an ordinary second send is ADMITTED during the queued window (`finalizing` excluded from the one-live-operation fence), so the user can innocently destroy their own provisional reply | E-3.claude, E-1.codex | decide, lean fix: keep MS-05 "drop, don't misplace" for genuine conflicts, but add a same-chat admission fence (or sequence the new send after the retained attempt) so a normal send can't be the trigger | **CONFIRMED** (PM 2026-08-12: index+admission cover only accepted/launching/owned_by_job/stopping; `finalizationTargetIsFresh` requires exact length + deep-equal tail) |
| 17 | CharX/card import fail-closed (oversized entry/data-URI rejects whole file vs fork partial import) — data-loss C9 decision vs compat bar | F-1.claude, F-3.codex, F-4.codex | decide: recommend keep (data-loss wins; error names files); sign-off row | pending |
| 18 | Standalone CHAT block rejects entire save vs importing supported blocks | F-2.codex | decide: recommend keep (43ac4a1cc diagnostic); sign-off row | pending |
| 19 | Reroll history chat-scoped vs fork character-scoped | B-8.codex | decide: recommend keep (multichat model) | pending |
| 20 | `/multisend` stops at first failure vs fork best-effort; PO-multisend rewrite diffs (exact-result selection, final-entry flush, plural Notes, ~100-line cap removed, export gating) | B-8.claude, B-9.claude, B-10.claude, B-6.codex, B-7.codex | decide: recommend keep-all (each fixes a fork bug); one sign-off row | pending |
| 21 | Fork-exported cards carry live activation config on Agent-only lorebook entries → they activate in Original | F-5.claude | decide: export-time strip vs keep | pending |
| 22 | CharX `prebuiltAssetExclude` export rewriting — tracks conflicted on baseline consequence | F-7.codex vs F-6.claude | keep: RESOLVED in favor of F-6.claude — baseline exclusions were exported as internal storage keys and imports mint fresh paths, so the filter was already inert after ANY round-trip into Original; fork-exported cards are equivalently inert, and fork-internal round-trips improved. F-7.codex's fix is infeasible (no deterministic post-import ID exists in Original) | **ADJUSTED→keep** (PM 2026-08-12) |

## Tier 3 — recommended keeps (sign-off in bulk)

| # | Cluster | Sources |
|---|---------|---------|
| 23 | Acknowledged failable Stop lifecycle ("Stopping…", Retry-Stop/Refresh on network failure) vs fork instant infallible abort — protocol-inherent | D-1.claude, D-6.codex |
| 24 | Pre-token Stop removes the empty assistant placeholder the fork retained | D-4.codex, D.claude pre-delta note |
| 25 | Restart→`abandoned` + billing-aware retry confirmation (standing accepted-send protocol rule) | D-6.claude, D-7.codex |
| 26 | Completion-wins-over-Stop during finalization; persistent failed-send recovery banner | D-4.claude, D-5.claude |
| 27 | Replay-gap display freeze without user-facing signal; transient bubble regression on reconnect replay | C-3.claude, C-4.claude |
| 28 | Durable `generationInfo` gains protocol keys the fork never wrote (consider export-time scrub) | B-6.claude |
| 29 | `/multisend` rows gain `time` + client-minted `chatId` | B-7.claude |
| 30 | Ephemeral effects (notification/TTS/sound) skipped after any late claim, even watched queued→committed replays (MS-06 AV-03 policy) | E-4.claude |
| 31 | Lua durable-write envelope: visibility timing + minted lore UUIDs in persisted JSON (ST-3/identity policy) | E-5.claude, E-7.codex |
| 32 | Cold-storage stub chats refuse export (fork exported corrupt stubs) | F-3.claude, F-9.codex |
| 33 | Incomplete bundle restore surfaces a completion result | F-8.codex |
| 34 | Ooba Legacy WS streaming removed (stability-audit decision; needs its visibility row) | F-6.codex |
| 35 | Concurrent sends across chats (chat-multitasking workstream, standing) | B-9.codex |
| 36 | Append-mode boundary skip-if-last-row-already-user divergence (fork skipped; current unconditional) — fold into cluster 11/12 decision | B-2.claude |

## Adjudication corrections applied

- CA-OR-7 / CA-OR-8 downgraded `resolved` → `partially resolved` (append
  mode only); extend-mode residuals live in cluster 13.
- CA-DF-1 description stale: `{{screenwidth}}`/browser-language now
  parity-restored via reported client context (`67210c623` rider,
  parity-restoring); `{{screenheight}}` became empty-string (third
  behavior) — small fix candidate folded into cluster 13's sweep.
  Sources: A-4.claude, E-7.claude.

## Verification status (PM pass, 2026-08-12)

**Tier 1: 9 of 10 clusters CONFIRMED** by direct code reads on both sides
(1–9, 16 promoted from Tier 2); cluster 10 PLAUSIBLE, repro assigned to the
Stage-3 harness. Zero findings refuted; one ADJUSTED (22 → keep). Tier-2
rows 11–13 are corroborated 4–6× across blind tracks and their mechanics
were directly observed during the cluster-1/9 code reads; 14 is a deliberate
in-delta feature commit (`656be4b1e`, twice independently flagged); 15/16
confirmed above; 17/18 are deliberate data-loss-audit designs consistently
described by both tracks. Tier-3 rows await bulk maintainer sign-off; no
code claim in them is load-bearing.

**Fix queue (verified defects, no parity tradeoff — ready on maintainer
go):** clusters 1, 5, 6, 7a, 7b, 8a–8d, 9, plus the cluster-15 whole-array
lore-fence sub-item and cluster-16 admission fence if the maintainer takes
the lean-fix option.

**Decision queue (verified mechanisms, maintainer call):** clusters 2, 3, 4,
11, 12, 13, 14, 15, 16, 17–21 here, plus the 11-item Stage-1 queue in
ADJUDICATION.md.

## MAINTAINER DISPOSITIONS (interview, 2026-08-12) — AUTHORITATIVE

Every open decision was resolved in a structured interview. This section is
the sign-off record required by the charter.

**Fix queue (approved "Go — fix all", plus interview additions):**
- Clusters 1, 5, 6, 7a, 7b, 8a–8d, 9 — as proposed.
- Cluster 16 — ADD same-chat admission fence while a finalization is
  replayable (reject/hold with notice).
- Cluster 15 sub-item — replace the whole-array local-lore fence with a
  per-entry semantic merge (per-key fencing elsewhere stays).
- Cluster 12 sub-item — fix the cancel display-vs-persisted mismatch
  (boundary stays transient).
- Cluster 4 — FORK PARITY: Continue consumes composer text (input trigger →
  user row → consumed → reply continues from it).
- CA-OR-3 — middle path: cancelled/stopped persists run through `editoutput`
  before storage; mid-stream display stays raw; finalization stays
  single-pass.
- CA-OR-4 — FORK PARITY: post-token failure retains the partial as a failed
  assistant row (flips pins `generation.chat.test.ts:5013`/`:6337` + doc
  `providers-and-models.md:700`).
- CA-LM-3 — one-time loud migration notice for legacy memory settings.
- CA-ST-4 — `@@emo` joins the unsupported-effect catalog (SSE warning +
  editor annotation).
- Cluster 2 — CUSTOM: import-time dialog shows the `.risup`'s primary +
  auxiliary model and asks whether to import the model half as legacy
  routing (`addImportedLegacyPreset`); user can cancel if they already have
  a profile for that model family.
- Cluster 21 — CUSTOM: on lorebook/card export, agent-only entries are
  neutralized — "always activate" disabled AND all activation keys cleared,
  so they are no-op even in Original.
- Clusters 17+18 — POLICY REVERSAL: tolerant + report. Imports salvage what
  they can and show a completeness report naming dropped files/blocks
  (supersedes fail-closed C9/`43ac4a1cc` behavior; visibility requirement
  stays).
- NEW-H1 (harness) — restore Original's empty-send-with-say-off dispatch
  (assistant-tail empty send generates a follow-up instead of erroring).
- NEW-H2 (harness) — map legacy model IDs (`gpt4o` → `gpt-4o`) before the
  provider wire.

**Signed keeps (divergence accepted, this interview is the sign-off):**
cluster 3 (Stop-before-accept unsend), 11 (append-mode new assistant row),
12 (transient boundary), 13 (extend-mode identity + single-pass — closes
CA-OR-7/8), 14 (truncation confirm gate), 19, 20, 22, CA-ST-5 (isolated Lua
VMs), CA-OR-10 (auto-continue stays removed), CA-LM-5 (conventional regex
keys), CA-PA-1 (stable-card CBS executes), CA-PR-5 (instruct sunset
re-confirmed), CA-OR-5 (primary-first), CA-OR-6 (policy buffering), all
Tier-3 rows (23–36), and all 22 Stage-1 recommended keeps.

**Harness updates:** cluster 10 upgraded PLAUSIBLE → **CONFIRMED** (both
claims reproduced by `test/compat-harness/cluster10.runner.ts`) — joins the
fix queue. NEW-H3 recorded as a baseline-side multisend defect annotating
cluster 20 (no fork action; UI-level confirmation before any cluster-20
rewrite).

**Wave status:** W1 LANDED `9ce5df9fa` (clusters 1, 4, 12-mismatch, NEW-H1
fixed; PM-verified: diff hunks match spec, focused suites green, harness
re-run shows exactly the two NEW-H1 cells converged — residual deltas are
signed cluster 28 + queued NEW-H2 — goldens updated).

W2 LANDED `0e46fed68` (cluster 9, CA-OR-3 middle path, CA-OR-4 fork
parity, cluster 10 — PM-verified: doc pins updated, cluster-10 golden
healthy on both races, independent harness re-run matched).

W3 LANDED `f256dd250` (clusters 6, 7a, 7b, 16 — PM-verified: shutdown
stopping-cancel branch removed, `generation_finalization_pending` fence +
notice live, retry threads acceptedMessageId; harness matrix unchanged,
cluster-10 healthy).

W4 LANDED `0cf091c25` (clusters 8a–8d + 15 lore merge — PM-verified:
`desc` in the mutation union (`assemble.ts:383`), schema-v32 claim leases,
per-job memory abort controllers, terminal patch applies character/lore
with freshness guards; harness matrix unchanged).

W5 LANDED `19fbcfb14` (clusters 2, 21, 17+18, 5, NEW-H2, CA-LM-3,
CA-ST-4 + ko parity sweep — PM-verified: Kobold rule byte-matches baseline,
20 ko.ts strings, request-divergent harness cells 16→4).
RESIDUE `be74a491b` (PM, full-gate findings): polyfill import crash in the
smoke server (agentLorebookInputs), alias table completed against the
fork-point catalog (gpt-4.1 family + dated gpt-4o; bare `gpt-5` left
unmapped as a valid live ID), effect-lease route manifest entry, three
stale pins updated to approved behavior.

**AUDIT CLOSED 2026-08-12.** Full gate green at `be74a491b`: format, check,
check:server, frontend 6135/6135, gates, ui-map, server 3276/3277(1 skip),
smoke 15/15; `pnpm test:compat-harness` green (16-cell matrix + healthy
cluster-10 runners) — NOTE it requires the baseline worktree at
`/home/codex/risu-baseline-71c476e9c` and is not part of test:all. One
load-flake observed once (activeWriterSession offline-freeze; passes in
isolation; predates the waves; deflake task chip filed).

**Wave plan:** W1 continue/send semantics (1, 4, 12-mismatch, NEW-H1);
W2 stream persistence (9, CA-OR-3, CA-OR-4, 10); W3 lifecycle/protocol
(6, 7a, 7b, 16); W4 side effects (8a–8d, 15 lore merge); W5 import/export +
polish (2, 21, 17+18, 5, NEW-H2, CA-LM-3, CA-ST-4). Each wave: Codex
implementation + regression pins (flipping overturned pins) + paired ledger
update.
