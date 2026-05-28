# Client Thinning Docs

Date: 2026-05-28

This directory is the active documentation set for client thinning as its own
major workstream. The goal is to keep Fastify-served web mode as a projection
of server-owned durable state, while separating that work from the broader
sendChat and Fastify migration history.

Treat this folder as the current task definition, not as a continuation of an
archived milestone sequence. Archive material is background and rationale; the
active work here is scoped, selected, and verified from current source.

The codebase is the source of truth. The archived contract seed lives in
[`../archive/fastify/client-thinning/`](../archive/fastify/client-thinning/README.md),
and current code navigation lives in [`../structure/`](../structure/README.md).
These docs are intentionally sharded so task agents can load only the context
they need.

## Read Order

1. [`note.md`](note.md) - short handoff for the next agent.
2. [`status.md`](status.md) - concise status router; open only the relevant
   `status/` shard for detail.
3. [`plan.md`](plan.md) - workstream goal, baseline, gaps, and near-term order.
4. [`implementation-map.md`](implementation-map.md) - code entry points,
   contracts, audit rules, and proof points.
5. [`runtime-stages.md`](runtime-stages.md) - projection-stage responsibility
   boundaries.
6. [`coverage.md`](coverage.md) - coverage router; open only the relevant
   `coverage/` shard.
7. [`architecture.md`](architecture.md) - module ownership and structure
   guidance.
8. [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md) -
   client-owned, no-port, and deferred behavior.
9. [`phases/`](phases/README.md) - phase-by-phase task sequencing.
10. [`prompts/`](prompts/) - reusable prompts for future task agents.

## Canonical Detail

- Current status and active next direction route through [`status.md`](status.md).
- Migration goals and sequencing live in [`plan.md`](plan.md).
- Code entry points, concern ownership, and verification commands live in
  [`implementation-map.md`](implementation-map.md).
- Test and audit inventory routes through [`coverage.md`](coverage.md). Latest
  recorded command/result lives in
  [`coverage/latest-verification.md`](coverage/latest-verification.md).
- Client-owned, unsupported, and no-port behavior lives in
  [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).
- Archived rationale remains useful, but active work should update this folder
  when the workstream direction changes.

## Agent Prompts

- [`prompts/prompt-slice.txt`](prompts/prompt-slice.txt) is for a coding agent
  that advances one coherent client-thinning batch.
- [`prompts/prompt-slice-continue.txt`](prompts/prompt-slice-continue.txt) is
  for continuing the next coherent batch in the same automation session.
- [`prompts/prompt-collect.txt`](prompts/prompt-collect.txt) is for a
  documentation checkpoint agent that reconciles docs with current code.
- [`prompts/prompt-report.txt`](prompts/prompt-report.txt) is for an audit or
  status reporting agent that should not change runtime behavior.
