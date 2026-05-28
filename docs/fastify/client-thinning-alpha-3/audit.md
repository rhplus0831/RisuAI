# Alpha 3 Combined Audit

Date: 2026-05-28

Status: **open.** This file combines the latest read-only audit results from
[`../../audit-codex-latest.md`](../../audit-codex-latest.md) and
[`../../audit-claude-latest.md`](../../audit-claude-latest.md) into the Alpha 3
workstream folder.

## Verdict

Both latest audits agree on the core result:

- The original Phase 9 migration, Alpha 1, and Alpha 2 closeouts remain closed
  historical records.
- Alpha 3 is the current live follow-up for Fastify client-thinning/server
  projection gaps.
- A3F1 through A3F13 are real against the audited checkout
  `c42b215f docs: close client thinning alpha 2`.
- The current verification ladder can pass while Alpha 3 bugs remain, so green
  verification is a baseline, not closeout proof.
- Closeout must add repeatable audit coverage where practical before behavior
  buckets are considered closed.

One scope correction from the Claude audit is binding for this folder: A3F5 is
narrowed to chats and messages. Chat folder global-id uniqueness is already
covered by `normalizeGlobalChatFolderIds` and audit rule AEC4 in
`util/client-thinning-audit.ts:1071-1105`.

## Conflict Resolution

The latest audits disagreed on when to update broad status docs:

- Codex suggested updating `docs/fastify/status.md` and
  `docs/fastify/status/next-steps.md` immediately so they point to Alpha 3.
- Claude suggested leaving those broad status docs untouched until R1-R7, the
  behavior fixes, focused tests, and the full ladder are complete.

A sub-agent was asked to verify the conflict before this merge was written. The
verified decision is to follow the rule-first sequencing already present in this
folder: do **not** update `docs/fastify/status.md` or
`docs/fastify/status/next-steps.md` in this merge. Those files are reconciled
only after Alpha 3 closes.

## Verification Baseline

The Codex audit records the full ladder passing:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Recorded results:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 78 files passed, 788 tests passed, 4 skipped.
- `pnpm api:test`: 69 files passed, 1249 tests passed.
- `pnpm build`: passed with existing nonblocking warning classes.
- `pnpm smoke:fastify-browser`: build passed and the Playwright smoke passed.

The Claude audit also read `util/client-thinning-audit.ts` and confirmed the
audit currently passes while missing most Alpha 3 bug classes.

## Confirmed Findings

| Finding                                                                    | Severity | Merged audit result              | Closeout gate                    |
| -------------------------------------------------------------------------- | -------- | -------------------------------- | -------------------------------- |
| A3F1 - Passive bootstrap refresh steals active-writer ownership            | High     | Real                             | R1                               |
| A3F2 - Generic settings blindly replay 409 conflicts                       | High     | Real                             | R2                               |
| A3F3 - Preset copy/import still mint command-path ids                      | High     | Real                             | R3                               |
| A3F4 - Empty-lorebook delete fallback mints a command-path id              | High     | Real                             | R3                               |
| A3F5 - Global chat/message addressing can hit the wrong duplicate id       | High     | Real, narrowed to chats/messages | R4                               |
| A3F6 - Preset import bypasses preset image asset validation                | Medium   | Real                             | R3 overlap plus focused tests    |
| A3F7 - Asset reads can fetch arbitrary URLs with `risu-auth`               | High     | Real                             | R7                               |
| A3F8 - Server backups do not preserve asset bytes                          | Medium   | Real                             | Focused tests/contract decision  |
| A3F9 - Bundle asset walker ignores supported legacy asset-path refs        | Medium   | Real                             | R5                               |
| A3F10 - Fastify asset uploads can lose MIME/extension metadata             | Low      | Real                             | Focused tests/contract decision  |
| A3F11 - Masked array secrets restore by index                              | Medium   | Real                             | R6                               |
| A3F12 - Compatibility adapters can fan out conflicting concurrent commands | Medium   | Real                             | Focused tests/contract decision  |
| A3F13 - Command event sink keeps unbounded event history                   | Low      | Real                             | Focused tests/retention decision |

The independent sweep in the Claude audit found no additional genuine Alpha 3
bug classes. Three proposed additions involving personas, loadouts, and
translator presets were rejected because those collections are flat top-level
arrays, not parent-scoped resources addressed globally.

## Current Audit Coverage Gap

`util/client-thinning-audit.ts` currently registers checks for active-writer
guards, stable command ids, plugin storage gates, asset walker validator drift,
RisuSave import/export shape, chat folder identity scope, module reference
semantics, asset persistence semantics, and provider ownership.

Those checks do not yet cover the following Alpha 3 classes:

- Passive read/bootstrap paths that register active-writer ownership.
- Conflict retry helpers outside the central command wrapper.
- Imported repair helpers that can mint ids inside public command routes.
- Chat/message ids that are only parent-local while routes resolve globally.
- Preset import validator drift.
- Authenticated asset fetch fallthrough to arbitrary URLs.
- Backup/restore asset-byte preservation.
- Client/server asset-reference parser mismatch for legacy paths.
- Upload metadata defaults for non-image assets.
- Index-based restore of wildcard array secrets.
- Multi-command compatibility fan-out against one optimistic snapshot.
- Event sink retention bounds.

AEC4 already covers chat folder identity scope. Do not reopen folder uniqueness
as part of A3F5 unless new evidence shows that audit rule no longer holds.

## Rule-First Closeout Gates

Add these rules before closing the corresponding behavior buckets. Each rule
should fail on the pre-fix tree and pass after the behavior fix.

- **R1 (A3F1):** passive projection refresh must not call a helper that attaches
  `activeWriterSessionHeader()` or otherwise registers writer ownership.
- **R2 (A3F2):** conflict retry blocks that resend the same patch are forbidden
  outside the central command wrapper.
- **R3 (A3F3, A3F4, A3F6 overlap):** public command routes must not call
  imported `repair*` helpers that can mint ids, unless the command is explicitly
  documented as server-generated and audit-visible.
- **R4 (A3F5):** globally resolved chat/message ids must be globally unique, or
  the affected public routes must become parent-scoped.
- **R5 (A3F9):** the server RisuSave asset walker and the client asset-reference
  parser must accept the same reference shapes, or the downgrade must be
  documented and enforced at import/command boundaries.
- **R6 (A3F11):** wildcard secret paths over arrays require stable row identity
  for placeholder restoration, or masked placeholders must be rejected for
  unprovable row changes.
- **R7 (A3F7):** `readServerAssetBytes` must reject references that are neither
  raw server asset ids nor supported local asset paths before adding
  `risu-auth`.

A3F8, A3F10, A3F12, and A3F13 can close with focused regression tests and a
documented contract decision. Add structural audit coverage for them only if the
implementation exposes a repeatable source pattern worth guarding.

## Loop-Exit Checklist

Alpha 3 closes only when all of the following are true:

- R1-R7 are implemented in `util/client-thinning-audit.ts`, with proof that each
  relevant rule fails on the old pattern and passes after the fix.
- A3F1 through A3F13 are fixed or explicitly accepted with documented tests.
- A3F5 remains narrowed to chats/messages, with the folder exclusion noted.
- A3F8 has a recorded backup contract decision: preserve asset bytes, or document
  backups as metadata-only and update any UI/docs that promise byte round-trip.
- A3F10, A3F12, and A3F13 have focused regression tests even without dedicated
  audit rules.
- The full ladder passes on the closeout checkout.
- Only then are `docs/fastify/status.md`,
  `docs/fastify/status/next-steps.md`, and other broad status docs reconciled.
