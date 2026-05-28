# Alpha 3 Combined Audit

Date: 2026-05-28

Status: **closed.** This file combines the latest read-only audit results from
[`../../audit-codex-latest.md`](../../audit-codex-latest.md) and
[`../../audit-claude-latest.md`](../../audit-claude-latest.md) into the Alpha 3
workstream folder, then records the final Alpha 3 closeout.

## Verdict

Both latest audits agree on the core result:

- The original Phase 9 migration, Alpha 1, and Alpha 2 closeouts remain closed
  historical records.
- Alpha 3 is the current live follow-up for Fastify client-thinning/server
  projection gaps.
- A3F1 through A3F13 are real against the audited checkout
  `c42b215f docs: close client thinning alpha 2`.
- The initial verification ladder could pass while Alpha 3 bugs remained, so
  green verification was only a baseline until the behavior buckets landed.
- Closeout added repeatable audit coverage where practical and focused tests for
  documented contract decisions before behavior buckets were marked closed.

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

| Finding                                                                    | Severity | Merged audit result | Closeout gate                    |
| -------------------------------------------------------------------------- | -------- | ------------------- | -------------------------------- |
| A3F1 - Passive bootstrap refresh steals active-writer ownership            | High     | Closed in Bucket 1  | R1                               |
| A3F2 - Generic settings blindly replay 409 conflicts                       | High     | Closed in Bucket 1  | R2                               |
| A3F3 - Preset copy/import still mint command-path ids                      | High     | Closed in Bucket 2  | R3                               |
| A3F4 - Empty-lorebook delete fallback mints a command-path id              | High     | Closed in Bucket 2  | R3                               |
| A3F5 - Global chat/message addressing can hit the wrong duplicate id       | High     | Closed in Bucket 3  | R4                               |
| A3F6 - Preset import bypasses preset image asset validation                | Medium   | Closed in Bucket 2  | R3 overlap plus focused tests    |
| A3F7 - Asset reads can fetch arbitrary URLs with `risu-auth`               | High     | Closed in Bucket 4  | R7                               |
| A3F8 - Server backups do not preserve asset bytes                          | Medium   | Closed in Bucket 4  | Focused tests/contract decision  |
| A3F9 - Bundle asset walker ignores supported legacy asset-path refs        | Medium   | Closed in Bucket 4  | R5                               |
| A3F10 - Fastify asset uploads can lose MIME/extension metadata             | Low      | Closed in Bucket 4  | Focused tests/contract decision  |
| A3F11 - Masked array secrets restore by index                              | Medium   | Closed in Bucket 5  | R6                               |
| A3F12 - Compatibility adapters can fan out conflicting concurrent commands | Medium   | Closed in Bucket 1  | Focused tests/contract decision  |
| A3F13 - Command event sink keeps unbounded event history                   | Low      | Closed in Bucket 6  | Focused tests/retention decision |

The independent sweep in the Claude audit found no additional genuine Alpha 3
bug classes. Three proposed additions involving personas, loadouts, and
translator presets were rejected because those collections are flat top-level
arrays, not parent-scoped resources addressed globally.

## Current Audit Gate Status

`util/client-thinning-audit.ts` currently registers checks for active-writer
guards, stable command ids, plugin storage gates, asset walker validator drift,
RisuSave import/export shape, chat folder identity scope, module reference
semantics, asset persistence semantics, provider ownership, and the Alpha 3
A3R1 through A3R7 rule-first gates.

Bucket 0 added repeatable audit coverage for these Alpha 3 classes:

- Passive read/bootstrap paths that register active-writer ownership.
- Conflict retry helpers outside the central command wrapper.
- Imported repair helpers that can mint ids inside public command routes.
- Chat/message ids that are only parent-local while routes resolve globally.
- Authenticated asset fetch fallthrough to arbitrary URLs.
- Client/server asset-reference parser mismatch for legacy paths.
- Index-based restore of wildcard array secrets.

Bucket 1 landed the A3EC1 fixes and focused A3F12 regression coverage:

- Passive event-driven projection refresh uses a read-only bootstrap fetch and
  no longer sends the active-writer session header.
- Generic data-driven settings patches roll back on 409 instead of replaying
  the same patch against `currentRevision`.
- Whole-chat compatibility command fan-out is serialized so the later commands
  read the command revision cached by earlier responses.

Bucket 2 landed the A3EC2 stable-id fixes and the A3F6 preset-import overlap:

- Preset copy requires `newPresetId` and persists the exact client-provided id.
- Preset import uses `createPresetRecord`, so missing ids and malformed or
  missing image asset refs are rejected without bumping revision.
- Deleting the last global lorebook returns 400 instead of minting a fallback
  lorebook id.

Before Bucket 3, A3R1, A3R2, and A3R3 passed while
`pnpm client-thinning:audit` remained red on A3R4 through A3R7.

Bucket 3 landed the A3EC3 global chat/message id addressing fixes:

- Chat ids are normalized to global uniqueness across characters.
- Message ids are normalized to global uniqueness across chats, with local
  bookmark references updated when a duplicate message id is repaired.
- Chat create/fork routes reject chat ids and embedded message ids already used
  under another parent.
- Message append/replace/generation routes reject message ids already used under
  another chat while preserving same-chat replacement semantics.

After Bucket 3, A3R1, A3R2, A3R3, and A3R4 pass.

Bucket 4 landed the A3EC4 asset ownership fixes:

- Fastify asset reads now reject values that are neither raw server asset ids nor
  supported legacy `assets/<sha>.<ext>` paths before `risu-auth` is attached.
- The RisuSave asset walker accepts the same raw-id and legacy-path shapes as
  the client asset parser, so bundle export includes those referenced bytes.
- Server backups copy the asset directory into the backup snapshot and restore
  it alongside `db.json`.
- Transformer ONNX asset uploads pass a filename and persist
  `application/x-onnx` / `.onnx` metadata instead of falling back to PNG.

After Bucket 4, A3R5 and A3R7 pass. `pnpm client-thinning:audit` remains red on
the remaining A3R6 Bucket 5 gate.

Bucket 5 landed the A3EC5 masked secret row identity fixes:

- Masked array placeholders restore by stable row identity instead of array
  position for `authRefreshes`, `botPresets`, `characters`, and `customModels`.
- Provider settings commands reject masked placeholders when the target row is
  missing identity, duplicates identity, or references no persisted source row.
- Reorder/delete tests prove provider array secrets are preserved on their own
  rows; direct masking tests cover bot presets and character-owned TTS secrets.

After Bucket 5, A3R6 passed and `pnpm client-thinning:audit` was green.

Bucket 6 landed the A3F13 command event retention fix and final closeout:

- `InMemoryCommandEventSink` retains only the latest 1000 command events for
  `list()` diagnostics.
- Older retained history is trimmed on emit, but live subscribers still receive
  every emitted event.
- `server/fastify/__tests__/events.test.ts` proves bounded retained history,
  live fanout preservation, and `clear()` behavior.

The Alpha 3 closeout intentionally relies on focused behavior tests and
documented contract decisions for these classes:

- Backup/restore asset-byte preservation.
- Upload metadata defaults for non-image assets.
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

A3F8, A3F10, A3F12, and A3F13 closed with focused regression tests and
documented contract decisions. Add structural audit coverage for future similar
classes only if the implementation exposes a repeatable source pattern worth
guarding.

## Current Observed Failures

After Bucket 6, `pnpm client-thinning:audit` passes. There are no remaining
R1-R7 audit failures or open Alpha 3 findings.

## Loop-Exit Checklist

Alpha 3 closed after all of the following became true:

- R1-R7 are implemented in `util/client-thinning-audit.ts`, with proof that each
  relevant rule fails on the old pattern and passes after the fix.
- A3F1 through A3F13 are fixed or explicitly accepted with documented tests.
- A3F5 remains narrowed to chats/messages, with the folder exclusion noted.
- A3F8 has a recorded backup contract decision: preserve asset bytes, or document
  backups as metadata-only and update any UI/docs that promise byte round-trip.
- A3F10, A3F12, and A3F13 have focused regression tests even without dedicated
  audit rules.
- The full ladder passes on the closeout checkout.
- `docs/fastify/status.md`, `docs/fastify/status/next-steps.md`, and other
  broad status docs are reconciled.
