# July 23, 2026 Audit Scopes

Archived after the planned 2026-07-23 implementation tranche. Seven fix commits landed that day
(`8f0433e66` promptTemplate parity, `a60066671` backup round-trips,
`92dcf55e3` onboarding settlement, `e68d3e991` outbox order atomicity,
`1da791a65` transfer bounds/metrics, `2c757ee2b` draft durability,
`73b53c33a` greeting translation storage), each implementing its plan in
`plans/` with the recommended decisions. Remaining entries are `ACCEPTED`
contracts, `EVIDENCE-GATED` deferrals, or decision items (`enableLorebookStubs`).
The scope files retain their as-of-2026-07-23 priorities, issue history,
verified-safe findings, and unresolved labels. Those labels are not a current
backlog or a source of current behavior; re-verify them against the live code.
Paths that start with `docs/audit/` record this workstream's original working
location.

This workstream was built from three sources: the
project memory index, `.archived-docs/` (topic-grouped history of every closed
workstream and audit), and `git log` (~2,000 `fix:` commits with
symptom-naming messages).

Each scope file is a self-contained brief that can be handed to an auditor
(human or agent) as-is: what is in bounds, what already broke there and why,
what is still open, and what has been verified safe and must not be re-audited.

## Historical Status Legend

| Tag              | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `VERIFIED-OPEN`  | Re-confirmed against current code during the 2026-07-23 verification passes.          |
| `UNVERIFIED`     | Copied from a dated source; not yet re-checked. Verify before acting.                 |
| `ACCEPTED`       | Known gap deliberately accepted by maintainer decision; revisit only on its trigger.  |
| `EVIDENCE-GATED` | Deliberately deferred until named runtime metrics justify it. Not an audit target.    |

## Scopes

| Scope                                              | Charter (one line)                                                                     | Historical priority on 2026-07-23 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| [Data durability](data-durability.md)              | Backup/restore/import/export lifecycle, boot import, asset GC, safety snapshots.        | Medium — majors remediated 07-21/23; residual tier-3 list remains. |
| [Writer coordination & outbox](writer-outbox.md)   | Active-writer lease, takeover, lost-writer latch, pending-mutation outbox, multi-tab.   | Medium — one known residual race; recent heavy churn. |
| [Client↔server sync & hydration](sync-hydration.md) | Bootstrap, resource projection, revision fencing, SSE events, settlement semantics.     | Medium — the SSE-liveness/409 gap turned out already fixed (`5b0d2da81`); remaining opens are decision items. |
| [UI state & persistence feedback](ui-state-feedback.md) | Rendered-state divergence, outcome surfacing, save feedback, input editability.     | Low-medium — 4 audit rounds closed; pattern checklist for new code. |
| [Generation & model config](generation-models.md)  | Prompt assembly, generation pipeline, durable generation, presets/profiles/templates.   | High — contains the one confirmed long-standing unfixed bug. |
| [Translation](translation.md)                      | Client+server translation pipeline, caches, presets, bilingual UI, auto-translation.    | Low — newest subsystem, recently reworked; known gaps are ACCEPTED. |
| [Identity & import normalization](identity-import.md) | Entity IDs at creation/import boundaries; import fidelity.                           | Low — just remediated 07-23; deferred items are symptom-gated. |
| [Performance & transfer size](perf-transfer.md)    | Stability/perf audit aftermath, transfer-size findings, test-suite performance.         | Low-medium — re-verified 2026-07-23: 21/29 transfer findings (all highs/mediums) remediated; 6 low-tier open, 2 partial. |

## Cross-cutting exclusions (apply to every scope)

- Plugin V2 is permanently unsupported by maintainer policy (deprecated in
  favor of Plugin V3). Do not audit V2 code paths for server parity.
- Dismissed finding IDs from the v1–v4 stability/perf audits must not be
  re-opened. Each version's dismissed/refuted IDs live in its archived
  `active-risk-analysis.md` / dismissed-findings files under
  `.archived-docs/performance-and-stability/stability-audits/`.
- Archival completeness gates were deliberately deleted on 2026-07-14
  (`49814e919`): `fixCompletenessGate`/`V2`/`V3`, `commandMutationBudget`,
  `cloneCostGateCompleteness`, A4R*/EC* rules. Do not look for or re-add them.
- Legacy Global Lorebook/Regex navigation is hidden by preference; new global
  functionality routes through modules.
- Group chat is removed. Dead strings/comments remain (known cleanup item);
  runtime guards enforce removal.

## Cross-cutting invariants (hold all new code against these)

- Never scroll the window: document root is pinned (`viewportScrollGuard.ts`,
  `#app { overflow: clip }`).
- Never JSON-clone the characters array on hot scalar-only paths.
- New client-side SHA-256 goes through `src/ts/sha256Fallback.ts` — the app
  must work on insecure origins without `crypto.subtle`.
- Optimistic local writes wrap in `withTrustedResourceWrite` and RE-READ state
  inside the wrap (never a captured pre-wrap reference).
- When inserting an `await` (confirm dialog, hydration) upstream of an action
  that reads live active-chat/message state, latch the target synchronously at
  interaction time first.
- New scalar settings keys are `undefined` on existing server DBs: read sites
  need `?? default` plus a `getValue` fallback.

## Verification process

Open items were re-verified on 2026-07-23 by three parallel read-only Codex
passes (transfer-size findings; data-loss residuals; five point checks).
Verdicts are folded into the scope files with `VERIFIED-OPEN`/`FIXED` tags.
Anything still tagged `UNVERIFIED` was outside those passes — re-check it
against current code before scheduling work on it.
