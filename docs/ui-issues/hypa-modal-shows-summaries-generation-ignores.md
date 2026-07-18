# Hypa modal shows summaries that generation memory ignores after a model change

## Summary

The Hypa V3 modal lists all persisted summaries for a chat regardless of the
model that produced them, while server-side prompt assembly filters memory to
the active summarization model plus legacy rows. After a summarization-model
change, the modal shows and lets the user edit rows that generation silently
ignores, and its footer computes the next summarization target from the
unfiltered list.

## Location

- `src/lib/Others/HypaV3Modal.svelte:151` — the modal calls
  `listServerMemorySummaries(chatId, undefined, signal)` with no model filter.
- `server/fastify/src/routes/memoryReads.ts:56-76` — the list endpoint
  supports an optional `model` query the client never sends.
- `server/fastify/src/prompt/assemble.ts:1785` — assembly applies
  `filterMemorySummariesForModel(summarySnapshot.summaries,
  input.settings.summarizationModel)`.
- `server/fastify/src/memorySummaryCompatibility.ts:22-34` — the filter keeps
  legacy-model rows plus active-model rows only; other-model rows are dropped.
- `src/lib/Others/HypaV3Modal.svelte:109-126` — `serverSummaryView` does not
  surface `summary.model`, so rows are visually indistinguishable.

## Trigger

1. Generate summaries with summarization model A.
2. Switch the Hypa summarization model to B in settings and keep chatting (new
   summaries are created under B).
3. Open the memory modal.

## Expected behavior

The modal reflects the memory the chat will actually use, or at least
distinguishes rows belonging to an inactive model so edits to dead rows are
recognizable.

## Actual behavior

Model-A and model-B summaries are interleaved and fully editable. Edits,
important stars, categories, and tags on model-A rows persist but never
influence generation, because assembly filters them out. The modal-footer
"next summarization target" is also computed from the unfiltered last row.

## Underlying cause

The client list request omits the `model` query the endpoint supports, and the
view drops the `model` field, so the modal's notion of "the chat's memory"
diverges from the assembly's model-scoped view.

## Affected data flow

1. Modal → `GET /api/v1/memory/summaries/:chatId` (no model) → full list → UI.
2. Generation → `filterMemorySummariesForModel` → different subset feeds the
   prompt.

## Severity and likely user impact

**Low.** Inconsistency between components (symptom class 5). Showing all rows
may be deliberate for cleanup workflows, so this is judged medium-confidence
as a defect; the concrete harm is that users cannot tell which rows are live,
and edits to inactive rows look effective but are not.

## Recommended fix

Either pass the active summarization model (plus the legacy sentinel) to the
list call, or surface `summary.model` in the view and badge rows whose model
is inactive; compute the footer's next-target from the same filtered subset
assembly uses.

## Test gap

A test seeding summaries under two models and asserting the modal marks (or
excludes) inactive-model rows and that the footer target matches assembly's
filtered view.
