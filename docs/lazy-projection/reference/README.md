# Lazy Projection Reference

Date: 2026-05-30

Deep, code-grounded design references for the phases in
[`../phases/README.md`](../phases/README.md). For the *why* and the phase order,
read [`../plan.md`](../plan.md) first; come here for the *exact* contracts and
code coordinates. Verify against the source — line numbers drift; symbol names are
the stable handle.

## Reference docs

| Doc | Backs | Covers |
| --- | ----- | ------ |
| [`storage-model.md`](storage-model.md) | Phases 4–6 | SQLite + single `db.json` + in-memory `Database` + projection; the `messages` table shape. |
| [`surgical-sync.md`](surgical-sync.md) | Phase 2 | Echo-skip + revision-gap detection + targeted fetch; why no replay buffer / op-id. |
| [`stub-hydration.md`](stub-hydration.md) | Phases 4–5 | Stub scope, resident-vs-hydrate tiers, the hydration primitive, `lorebookBridge`. |
| [`durable-generation-modes.md`](durable-generation-modes.md) | Phase 6 | The staging primitive; continue extend; regenerate + the chat reroll buffer. |
| [`decisions.md`](decisions.md) | all | The locked decisions (Decision 1–5, Q1–Q5) with rationale. |

## Read order

1. [`decisions.md`](decisions.md) — what was decided and why.
2. [`storage-model.md`](storage-model.md) — where data lives after the workstream.
3. [`surgical-sync.md`](surgical-sync.md) — the sync contract everything else
   depends on.
4. [`stub-hydration.md`](stub-hydration.md) — the lean-projection mechanics.
5. [`durable-generation-modes.md`](durable-generation-modes.md) — the durable-gen
   completion.
