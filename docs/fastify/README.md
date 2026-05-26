# Fastify Migration Roadmap

Date: 2026-05-27

This directory is the working roadmap for moving Risuai from a thick
browser app to a Fastify backend with a display-only client. The
codebase is the source of truth; these docs describe the intended
direction, current status, and the boundary decisions task agents need
before widening behavior.

The docs are sharded so an agent can load only the slice it needs.

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Scope

Current status for the original migration closeout lives in
[`status.md`](status.md). Phases 0-9 were closed for the
Fastify-served web migration scope in `edbc2d07`. The first audit
follow-up is archived in [`../fastify-followup/`](../fastify-followup/);
the closed second-pass record lives in
[`../fastify-followup-alpha/`](../fastify-followup-alpha/), where the
alpha broad closeout is closed by `50d55b97`. Fastify is the live server
path, Express has been deleted, and the Dockerfile / compose file target
port 6002 with `/app/data` persisted.

Historical phase logs live in [`phases-completed/`](phases-completed/).
Route and test inventories live under [`coverage/`](coverage/).

In scope:

- A new Fastify + TypeScript server that owns persistence, generation,
  and outbound provider calls.
- The Phase 0 removal set: Group chat, peer-to-peer multi-user chat,
  Risu Account Sync, Google Drive sync, and the Supa / Hypa V2 /
  Hanurai memory engines have been removed from the client surface.
- Moving the extracted generation seams server-side. Phase 6 closed
  the completion route and Phase 7 closed server-side prompt assembly,
  including `/chat` dispatch and preview-prompt paths. The provider
  matrix lives in [`coverage/providers.md`](coverage/providers.md).
- A display-only browser client in server-backed mode.

Out of scope (see [`removed-and-out-of-scope.md`](removed-and-out-of-scope.md)):

- Tauri / desktop builds. They keep their current local-browser
  storage behavior and are not actively migrated.
- Standalone local-browser web mode. After the migration the web
  client only runs against the Fastify server.

## Locked decisions

These are the high-level decisions that shape every phase. They are
restated where they are load-bearing; treat this list as the canonical
short form.

- **Stack.** Fastify + TypeScript. Greenfield API surface, not a copy
  of the `move-to-fastify` branch.
- **Storage.** SQLite via `node:sqlite` (Node 24+) for server schema
  metadata and revision. Fastify auth files live beside it under
  the data dir. Domain state lives in a single `data/db.json` blob
  during the migration window; per-resource SQL tables land in later
  server phases as APIs need durable shapes. Content-addressed assets
  live on disk under `data/assets/`.
- **No compatibility migrations.** No actual users run the Fastify
  server yet, so phases should edit the current schema and import paths
  directly instead of preserving old intermediate Fastify shapes.
- **Sequence.** Remove first, then port. Phase 0 strips the deprecated
  features so the surface that gets ported is smaller.
- **sendChat.** Tests first, extraction second. Phase 5 shrank
  `src/ts/process/index.svelte.ts` into focused browser modules;
  later server phases keep the fixture-pinned behavior intact.
- **Client modes.** Server-backed web only. Tauri stays as-is.
- **Hub.** Fastify proxies hub traffic through `/api/v1/hub/*`.
  The route is intentionally still auth-gated; session-cookie or
  public element-load support is tracked as a follow-up.
- **Memory.** Only Hypa V3 survives as a live engine. Supa, Hypa V2,
  and Hanurai entry points are removed; legacy field/helper names may
  remain where Hypa V3 still consumes them.
- **Drive.** Google Drive sync is removed in Phase 0 with the rest of
  the client-owned cloud storage.

## Read order

1. [`plan.md`](plan.md) - goal, baseline, sequence, non-goals.
2. [`status.md`](status.md) - current progress and pickup state; routes into
   `status/` shards.
3. [`runtime-stages.md`](runtime-stages.md) - client vs server
   responsibility per generation stage.
4. [`architecture.md`](architecture.md) - server module shape, API
   surface, boundary rules.
5. [`phases/`](phases/) - per-phase scope, exit criteria, and
   inline boundary rules.
6. [`phases-completed/`](phases-completed/) - archived landed details
   and old status logs.
7. [`coverage.md`](coverage.md) - test inventory router.
8. [`removed-and-out-of-scope.md`](removed-and-out-of-scope.md) -
   what is being deleted and what is intentionally left alone.

## Reference material

These are _reference only_. They are not the plan.

- The `move-to-fastify` branch. An agent-driven attempt that
  implements Phases 1-6 end-to-end. Useful for concrete decisions
  (e.g. what an SSE event payload should contain, which migrations
  the SQLite schema needed) but its specific API shapes are not
  binding on this roadmap. When citing it, link to a commit, not the
  branch tip.
- `/home/codex/risuai-metatron`. A Python/FastAPI fork that
  decomposed `sendChat` step by step. Its `docs/send-chat-migration/`
  layout is the template for this directory; its server modules show
  one way to slice the generation pipeline.

## Conventions

- Status shards under `status/` are written in the present tense and
  must be updated when a slice lands. Phase docs under `phases/` are
  the long-lived plan and only change when scope changes.
- Boundary rules live inline in the relevant phase doc. There is no
  separate `contract.md`; if a behavior is unclear, add the rule to
  the phase that owns the behavior and link back to it from the
  status shard.
- Dates are absolute (`2026-05-20`), never relative.
- Cite source files as `path:line` so they are clickable from terminal
  editors.
