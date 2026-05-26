# Fastify Follow-Up Alpha Handoff

Date: 2026-05-27

This directory is the current live handoff for the second audit pass
over Fastify Phases 0-9. The first follow-up pass is archived in
[`../fastify-followup/`](../fastify-followup/), and the original
migration scope remains in [`../fastify/`](../fastify/).

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths directly.

## Read Order

1. [`status.md`](status.md) - current alpha snapshot and commit anchors.
2. [`status/next-steps.md`](status/next-steps.md) - closed alpha runbook
   and verification commands.
3. [`phases/`](phases/) - open or remaining alpha scope only.
4. [`phases-completed/`](phases-completed/) - completed alpha slice
   notes.

## Current State

The earlier alpha findings (Phase 3, 5, 6, 8, 9) plus the broad typecheck
closeout are archived under [`phases-completed/`](phases-completed/). The
2026-05-27 Phases 0-9 audit landed a scalar trigger/scripting/UI
projection-write fix and left one open finding: trigger collection/chat
projection writes, tracked in
[`phases/phase-9-trigger-projection-writes.md`](phases/phase-9-trigger-projection-writes.md).
