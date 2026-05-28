# Phase 1: Baseline Contract

Date: 2026-05-29

Status: DONE (update only if source inventory changes the invariant).

The baseline projection contract is established: Fastify owns durable state;
the browser sees a projection and issues revision-checked commands for durable
writes; the active-writer guard protects server-owned mutation routes; the
projection write guard freezes ordinary `DBState.db` mutation in Fastify mode;
and provider dispatch is server-routed for supported shapes.

This baseline is now in the closed/stable set. See
[`../plan.md`](../plan.md) and [`../status/server-projection.md`](../status/server-projection.md).
