# Open Findings

Date: 2026-05-28

The findings below are the current alpha task list. They were cross-verified
against the codebase from [`../../audit-codex.md`](../../audit-codex.md) and
[`../../audit-claude.md`](../../audit-claude.md); see
[`audit.md`](./audit.md).

## Summary

| Finding | Severity | Criterion | Status | Bucket |
| ------- | -------- | --------- | ------ | ------ |
| AF8     | Low      | AEC6      | Open   | 7      |
| AF9     | Low      | AEC7      | Open   | 8      |
| AF10    | Low      | AEC6      | Open   | 7      |

## AF8 - Asset re-upload does not heal missing blob files

Severity: **Low**

Source: lower-confidence edge from `docs/audit-codex.md`, conditionally
confirmed.

Evidence:

- `addAsset` returns existing metadata without rewriting the file at
  `server/fastify/src/repository.ts:151-155`.
- Asset GET 404s if the blob is absent at
  `server/fastify/src/routes/assets.ts:78-86`.

Impact:

If metadata exists but the blob was lost, re-uploading the same asset id can
leave the asset unreadable.

Done when:

- Re-upload semantics are defined and tested. Prefer healing the blob when
  metadata exists but the file is missing.

## AF9 - Client-thinning closeout docs conflict

Severity: **Low**

Source: `docs/audit-codex.md` P3.

Evidence:

- `docs/fastify/client-thinning/README.md:64` says EC1-EC7 are closed.
- `docs/fastify/client-thinning/final-audit.md:10-11` says EC1-EC7 remain open.
- `docs/fastify/status.md:17-23` carries older verification status.

Impact:

Future reviewers and task agents can choose the wrong closeout state.

Done when:

- This alpha directory records the current open state.
- Historical docs are either reconciled or explicitly marked as historical
  snapshots after alpha closeout.

## AF10 - Optional asset-clear paths lack regression tests

Severity: **Low**

Source: `docs/audit-claude.md` F-C.

Evidence:

- Optional clears are allowed by `server/fastify/src/commands/assets.ts:12-17`.
- Tests cover malformed/missing audio refs at
  `server/fastify/__tests__/commands.test.ts:5218-5294`, but not `null`, `""`,
  or `"-"`.

Impact:

No current behavior violation was found, but regression coverage is incomplete
for the clear values the validator intentionally accepts.

Done when:

- Character audio asset create/patch tests cover `null`, `""`, and `"-"` for
  `vits.files.*` and `gptSoVitsConfig.ref_audio_data.assetId`.
