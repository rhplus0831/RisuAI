# Original-Risu Compatibility Audit — Charter

**Opened:** 2026-08-12. **Trigger:** commit `8bf88e43c` (continue-writing fix)
overturned two divergences the 2026-08-02 parity audit had adjudicated as
"accepted divergence, keep-and-pin" (buffered-Continue row identity,
OR-6 single-pass `editoutput`). The failure mode was wrong *adjudication*
under a bar that has since shifted, not weak detection — so every prior
keep-and-pin is a candidate regression, and everything landed after the
parity audit's verification point has never had a parity pass.

## Compatibility bar (maintainer-approved 2026-08-12)

**User-visible behavior must match Original RisuAI at the fork point
`71c476e9c` exactly, unless the maintainer signs off the specific divergence
under this charter.**

This supersedes the blanket policy of 2026-08-02 ("where the baseline
behavior is demonstrably accidental and the current behavior is saner, keep
current, pin it"). Saner-than-baseline is no longer sufficient grounds to
keep a divergence; it is grounds to *recommend* a keep, which the maintainer
must individually confirm. Divergences already backed by an **individual**
(non-blanket) maintainer decision — ST-1/ST-2 V2 trigger no-ops
(2026-08-02), the D1/D2 data-loss decisions (2026-08-05) — remain in force
without re-litigation, but are listed in ADJUDICATION.md for visibility.

## In-scope observable surfaces

1. **Persisted transcript shape and mutation semantics** — row identity,
   metadata, ordering, reroll/displacement, continue/regenerate effects.
2. **Outgoing request payload** — prompt text, message ordering, roles,
   sampler parameters, headers, for identical inputs.
3. **Script/CBS/trigger-visible state** — history reads, chat variables,
   `editinput`/`editoutput` pass counts and ordering, Lua-observable state.
4. **Import/export data formats** — anything Original Risu must round-trip.
5. **UI-observable generation lifecycle** — streaming display semantics,
   failure/cancel outcomes, say-nothing-class visible turns.

## Out of scope

- Server internals, SSE wire shape, the durable generation-operation
  protocol (governed by the additive-only rule).
- Features ported from post-fork upstream (reference = `docs/upstream-sync/`
  ledger and the upstream source they were specced from, not the fork point).
- Permanently-unsupported surfaces with standing policy: plugin V2,
  group-chat generation (documented no-port), non-server-routable providers
  — listed once in ADJUDICATION.md for a final sign-off, then closed.

## Baseline

`git worktree add --detach <dir> 71c476e9c` (last upstream merge,
2026-05-18). **Never** compare against `~/Risuai` (168 commits ahead of the
fork point — false positives).

## Verdict vocabulary

- `fix` — restore parity (dual-mode gating like `8bf88e43c` is acceptable).
- `keep` — recommended sign-off; divergence is architecturally required or
  invisible at the five surfaces above. Not final until maintainer confirms.
- `decide` — genuinely user-visible with a real tradeoff; maintainer call.
- `resolved` — already fixed since the original adjudication.

## Stages

0. This charter.
1. `ADJUDICATION.md` — re-score every recorded divergence (six area docs'
   intentional sections, WORK-INDEX accepted-divergence rows, deferred
   items) against the bar above.
2. Dual-track blind discovery (Codex + Claude pairs, six surface briefs in
   `briefs/`, reports in `reports/`) over the unaudited delta
   `f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12).
3. Differential golden-transcript harness: fixture-driven diff of persisted
   transcript + request body, fork-point client vs current stack, matrix
   {send, regenerate, continue, multisend} × {stream, buffered} ×
   {useSayNothing on/off} × {solo, group}. Becomes permanent CI.
4. Consolidation, per-finding adversarial verification by the project
   manager, WORK-INDEX v2, maintainer dispositions, Codex fix waves with
   regression pins — **including flipping the pin test wherever a prior
   keep-and-pin verdict is overturned** (pins encode adjudications; a pin
   enforcing a revoked adjudication is itself a defect).
