# Saved Toggles Rework

> Archived completion and decision record. This describes the implementation
> and validation state on 2026-07-20, not the current Saved Toggles contract.

Status: completed on the `fastify` branch on 2026-07-20 in commit `28b47658c`.

## Settled Design

The former dropdown and separate Save, Apply, and Delete controls became one
state button. Its state precedence is:

1. Unused
2. Unlinked
3. Mismatch
4. `<name> (Edited)`
5. `<name>`

`togglePresetId` is per-chat and mirrors `agentPresetId` through all relevant
paths, including loadouts. Empty or absent means Unused. A deleted referenced
preset becomes Unlinked and must never cause automatic reselection.

The App-level `chatGenerationTogglePresetListModalStore` hosts the dialog. A
row click only selects; it neither applies nor closes the dialog. Similarity
ordering is snapshotted when the dialog opens: Jaccard similarity first,
boolean-`1` active-count distance as the next comparison, then descending
`updatedAt`, then name. Rename and delete remain; drag ordering and numbering
were removed.

Save retains the overwrite-versus-new choice and adds a warning when
overwriting from Mismatch. The footer provides Unselect.

## Pick Contract

Pick proceeds through source selection, preset selection, and confirmation:

- The source is the current prompt preset or module.
- A target preset is eligible only if every source key exists and the value
  kinds match. Ineligible rows remain visible but disabled with a reason.
- Confirmation identifies the source and changed-key count.
- The operation merge-patches only the source keys.
- Pick never sets `togglePresetId`.

`jailbreakToggle` was removed from the saved-toggle preset schema.

## Validation Record

The recorded `pnpm check` and `pnpm check:server` runs were clean, with 279
focused tests passing.

The parent commit `5db95a1a3` already had a
`memoryChunkPlanner.test.ts` job-order failure and five branch-action failures
in `Chat.customHtml.test.ts`. They were reproduced against a clean parent and
were explicitly not caused by commit `28b47658c`. As of 2026-07-20 they still
failed and should not be attributed to this workstream.
