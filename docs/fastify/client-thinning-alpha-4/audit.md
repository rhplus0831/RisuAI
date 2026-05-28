# Alpha 4 Combined Audit

Date: 2026-05-28

This file records the verification audit that opened Alpha 4 - the sub-agent
sweep that confirmed Alpha 3's documented fixes are in place, the ladder
passes, and yet ten findings (B1-B10) survive in the current tree because the
audit script enforces literal pre-fix text rather than the invariant.

## Verdict

The Alpha 3 closeout was internally consistent: every documented A3F1-A3F13
fix is in code at the cited line numbers, every A3R1-A3R7 rule passes, and
the full ladder is green. The Alpha 3 documentation is accurate.

The verification audit also confirmed why the close/reopen loop is still
running:

- Each A3R rule defends the literal pre-fix text. Realistic regression
  rewrites (alias renames, helper extractions, structural rewrites)
  bypass every rule.
- A3F12 closed `dispatchCompatibleChatUpdate` with focused tests and the
  explicit decision that no R-rule was needed. Five sibling call sites that
  share the same anti-pattern remain open.
- A3F8 closed assets but did not extend to the SQLite memory database or
  the legacy storage directory.
- A3F10 closed the ONNX uploader but did not extend to VITS, emotion,
  zip-asset, or module uploaders.
- A3F13 closed the command event sink but did not extend to other
  process-lifetime accumulators (notably `auth.knownKeyHashes`).
- Stale Alpha-3 doc claims survive (notably the `repairPresetRecord`
  "still used by import/bootstrap" line).

These are not new bug classes the audit missed; they are class extensions
the audit's narrow rules cannot detect.

## Verification Baseline

```bash
pnpm client-thinning:audit       # passed
pnpm check                       # 0 errors / 0 warnings
pnpm test                        # 793 passed, 4 skipped (79 files)
pnpm api:test                    # 1267 passed (70 files)
pnpm build                       # passed (pre-existing chunk/dyn-import warnings)
pnpm smoke:fastify-browser       # 1 passed
```

This is the exact closeout baseline Alpha 3 recorded. The audit is therefore
green while B1-B10 are open.

## Sub-Agent Coverage

Five parallel sub-agents verified the four Alpha 3 buckets against code, plus
one independent invariant sweep. Each sub-agent reported its own verdict for
each finding; this file consolidates them.

| Slice | Findings audited | Doc claim verified in code? | New gaps in same domain? |
| ----- | ---------------- | --------------------------- | ------------------------ |
| Bucket 1 (A3F1, A3F2, A3F12) | active-writer + 409 + fan-out | yes | 6 unfixed fan-out call sites; A3R1 + A3R2 brittle |
| Bucket 2 (A3F3, A3F4, A3F6) | preset / lorebook id minting  | yes | `createGlobalLorebookRecord` transitive mint; `repairPresetRecord` dead export |
| Bucket 3 (A3F5) | global chat/message ids                 | yes | `/chats/:chatId/lorebooks` skips global normalize; A3R4 brittle |
| Bucket 4 (A3F7-A3F10) | asset gating + backup + walker + onnx | yes | backup omits `risu.db` and `data/save/`; multiple `saveAsset` callers ship no filename; `getFileSrc` URL pass-through |
| Bucket 5+6 (A3F11, A3F13) | secret row identity + event sink   | yes | A3R6 hardcoded list omits `characters`; A3F13 test does not hit production limit; `auth.knownKeyHashes` unbounded |
| Independent invariant sweep | all of Phase 9                   | n/a | confirmed the fan-out sites independently |

Independently verified in-place by direct code reads after the sub-agent
sweep:

- `POST /api/v1/commands/lorebooks` → `createGlobalLorebookRecord` →
  `repairLorebookEntries` → `createLorebookEntryRecord({ repairId: true })`
  → `randomUUID()`. Confirmed at the four cited file:line locations.
- `SideChatList.svelte:246-248` two-dispatch fan-out. Confirmed.
- `auth.ts:46-51` unbounded Set + JSON write. Confirmed.
- `characterCards.ts:728-733` VITS upload without filename. Confirmed.

## Findings → Criteria → Buckets

| Finding | Class | Maps to | Bucket |
| ------- | ----- | ------- | ------ |
| B1 - composite fan-out at six call sites          | A3F12 class extension | A4EC1 / A4EC2 | 1 |
| B2 - transitive entry-id mint in lorebook create  | A3F3 class extension  | A4EC1 / A4EC3 | 2 |
| B3 - `ensure*Collection` repair-on-read minting   | doc clarification     | A4EC1 / A4EC3 | 2 |
| B4 - backup omits `risu.db`                       | A3F8 class extension  | A4EC1 / A4EC4 | 3 |
| B5 - backup omits `data/save/`                    | A3F8 class extension  | A4EC1 / A4EC4 | 3 |
| B6 - `auth.knownKeyHashes` unbounded              | A3F13 class extension | A4EC1 / A4EC5 | 4 |
| B7 - non-PNG `saveAsset` callers                  | A3F10 class extension | A4EC1 / A4EC6 | 5 |
| B8 - `getFileSrc` URL pass-through                | A3F7 class extension  | A4EC1 / A4EC7 | 6 |
| B9 - `/chats/:chatId/lorebooks` normalize hole    | A3F5 class extension  | A4EC1 / A4EC8 | 6 |
| B10 - `repairPresetRecord` dead export            | A3F3 class extension  | A4EC1 / A4EC3 | 2 |

## Audit-Script Soundness Summary

Each A3R# rule was reviewed for realistic bypass paths. Every rule admits at
least one sincere rewrite that bypasses it without re-introducing the bug,
and at least one realistic regression that reintroduces the bug while passing
the rule. The pattern across all seven rules:

- **Surface is too narrow**: rule inspects a single named function in a
  single file. A sibling function in another file with the same anti-pattern
  is invisible.
- **Trigger is a literal string**: substring matching defeats refactors that
  preserve the bug (`find` instead of `some`, `const x = result.currentRevision`
  instead of inline access).
- **Allowlist is hardcoded**: derived sets (`SECRET_PATHS`,
  `ARRAY_ROW_IDENTITY_KEYS`, asset-walker collectors) are duplicated as
  string literals in the rule, so a new array path / collector / shape
  silently extends the surface without extending the rule.

Alpha 4 Bucket 0 rewrites the audit so every rule asserts the structural
invariant the docs describe.

## Reproduction Notes

To reproduce this audit verdict on the current Alpha-3 checkout:

```bash
pnpm client-thinning:audit       # passes; confirms the audit is green
rg -n 'dispatchReorderChatFoldersByIds.*\n\s*dispatchReorderChats' src/ -U  # B1
rg -n 'createGlobalLorebookRecord' server/fastify/src/routes/ \
  ; rg -n 'repairLorebookEntries' server/fastify/src/commands/  # B2
rg -n 'knownKeyHashes' server/fastify/src/auth.ts               # B6
rg -n 'saveAsset\(' src/ts/characterCards.ts                    # B7
```

Each command surfaces the unfixed call site that the audit cannot see.
