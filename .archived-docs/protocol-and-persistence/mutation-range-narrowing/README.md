# Command Mutation-Range Narrowing Plan (ARCHIVED 2026-06-03)

Date: 2026-06-03

> **ARCHIVED — workstream complete.** Moved from `docs/plan/` to
> `.archived-docs/protocol-and-persistence/mutation-range-narrowing/` on 2026-06-03 after Phases 0–8 landed.
> Every over-broad command write was narrowed to its target range, or held at a
> documented safe floor: the Tier 1–4 settings/plugin-storage/single-row/collection
> paths, the projection-range splits (Phase 5), the gate-complete verification
> budgets (Phase 7), and the character-scoped Tier-5 routes — the script/trigger
> PUTs, `DELETE chats/:id`, and `DELETE characters/:id` — narrowed onto
> `targeted-character-row` (Phase 8). The only routes left at their broad
> `message-free` floor by choice are the rare creates (`POST characters`,
> `create-and-select`, `POST modules`) and `DELETE modules/:id` (separate
> cross-table blocker), tracked in [`../leftover.md`](../../deferred-work/leftover.md). These docs
> are kept as the historical plan, verification record, and phase/slice detail;
> prefer [`../../STRUCTURE.md`](../../../STRUCTURE.md) and the code for current
> state.

This directory tracks the command mutation-range narrowing work. A
mutation-range mismatch is a command that changes a small slice of state but
uses a broad helper that rewrites much more, or emits a broad projection
resource that refreshes whole arrays.

Use `status.md` for the current state. Use
[`mutation-range-mismatch.md`](mutation-range-mismatch.md) as the seed
inventory. The code remains the source of truth.

## Read Order

1. [`status.md`](status.md) - current snapshot and navigation router.
2. [`next-steps.md`](next-steps.md) - tactical entry point for selecting the
   next coherent task batch.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-tier analysis of
   the over-broad write and projection ranges and their target ranges.
4. [`plan.md`](plan.md) - goal, sources, invariants, prerequisites, and phase
   order.
5. [`phases/README.md`](phases/README.md) - phase index.
6. [`phases/slices/`](phases/slices/) - concrete task slices under each phase.

## Canonical Detail

- Current status and phase routing live in [`status.md`](status.md).
- The per-tier risk analysis (actual vs desired write range) lives in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- The latest maintained verification result lives in
  [`latest-verification.md`](latest-verification.md).
- Next task selection, non-goals, and proof commands live in
  [`next-steps.md`](next-steps.md).
- Phase-level scope and exit criteria live in [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- The seed audit is [`mutation-range-mismatch.md`](mutation-range-mismatch.md);
  it has the route table, per-route findings, and verifier notes this plan was
  split from.

## Source Anchors

- [`mutation-range-mismatch.md`](mutation-range-mismatch.md) - the audit
  that seeded this plan (79 routes, 71 over-broad, classifier + adversarial
  verifier).
- `server/fastify/src/routes/commands.ts` - the 79 command routes.
- `server/fastify/src/commands/mutations.ts` - the four mutation helpers.
- `server/fastify/src/repository.ts` - SQLite table writers and the reference
  fix `writeCharacterSelectionRows`.
- `server/fastify/src/routes/projection.ts` - `RESOURCE_PROJECTION_FIELDS` and
  the narrow `characterSelection` projection.
- [`../../structure/server-resources-and-bridges.md`](../../../docs/structure/server-resources-and-bridges.md)
  and [`../../structure/data-and-events.md`](../../../docs/structure/data-and-events.md) -
  projection, hydration, revision, event, and active-writer references.
- [`../../STRUCTURE.md`](../../../STRUCTURE.md) - present-tense code navigation.

## Reference Fix

`b57df5cd` ("fix: speed up character selection command") is the template:

- The old path rewrote every character row, all nine collection tables, and
  settings for one pointer change.
- The new path writes one character row plus settings through
  `applyCharacterSelectionCommandMutation` / `writeCharacterSelectionRows`.
- The review gate checks `mutationPath: 'targeted-character-selection'` and
  `dbJsonWriteMs: 0`.
- The projection uses the narrow `characterSelection` resource.
- The regression test uses `tableRowidsById` to prove unrelated rows stay put.
