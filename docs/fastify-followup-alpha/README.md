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
2. [`status/next-steps.md`](status/next-steps.md) - active pickup
   runbook and verification commands.
3. [`phases/`](phases/) - open or remaining alpha scope only.
4. [`phases-completed/`](phases-completed/) - completed alpha slice
   notes.

## Current State

Phase 3, 6, and 8 alpha findings are closed. Phase 9A is closed, but the
latest completion re-audit reopened Phase 9 for projection-write tails
in
[`phases/phase-9-projection-write-tails-alpha.md`](phases/phase-9-projection-write-tails-alpha.md).
The remaining active work is Phase 9 projection-write tails in
[`phases/phase-9-projection-write-tails-alpha.md`](phases/phase-9-projection-write-tails-alpha.md),
Phase 5 sendChat boundary cleanup in
[`phases/phase-5-sendchat-boundary-alpha.md`](phases/phase-5-sendchat-boundary-alpha.md)
and broad closeout typecheck cleanup in
[`phases/broad-closeout-typecheck-alpha.md`](phases/broad-closeout-typecheck-alpha.md).
