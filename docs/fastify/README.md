# Fastify Migration Roadmap

Date: 2026-05-20

This directory is the working roadmap for moving Risuai from a thick
browser app to a Fastify backend with a display-only client. The
codebase is the source of truth; these docs describe the intended
direction, current status, and the boundary decisions task agents need
before widening behavior.

Each doc is short on purpose so an LLM agent can load only the shards
it needs.

## Scope

Current status: Phase 0 removals, Phase 1 Fastify foundation, and
the Phase 2 server storage slice closed on 2026-05-20. Fastify now
owns bootstrap, JSON import, content-addressed assets, backups,
static SPA serving, and the Docker runtime. Phase 3 proxy migration
is the next server slice; Phase 4 `sendChat` characterization tests
can start in parallel.

In scope:

- A new Fastify + TypeScript server that owns persistence, generation,
  and outbound provider calls.
- The Phase 0 removal set: Group chat, peer-to-peer multi-user chat,
  Risu Account Sync, Google Drive sync, and the Supa / Hypa V2 /
  Hanurai memory engines have been removed from the client surface.
- Stabilizing `src/ts/process/index.svelte.ts::sendChat` with tests
  before carving it into smaller modules.
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
- **Storage.** SQLite via `node:sqlite` (Node 24+) for system state
  (schema version, revision, auth). Domain state lives in a single
  `data/db.json` blob during the migration window; per-resource SQL
  tables land in Phases 5-9 as APIs are carved out. Content-addressed
  assets on disk under `data/`.
- **Sequence.** Remove first, then port. Phase 0 strips the deprecated
  features so the surface that gets ported is smaller.
- **sendChat.** Tests first, extraction second. Pin observable
  behavior before touching the current 2090-line function.
- **Client modes.** Server-backed web only. Tauri stays as-is.
- **Hub.** Fastify keeps proxying `sv.risuai.xyz` traffic.
- **Memory.** Only Hypa V3 survives. Supa, Hypa V2, Hanurai are
  removed in Phase 0.
- **Drive.** Google Drive sync is removed in Phase 0 with the rest of
  the client-owned cloud storage.

## Read order

1. [`plan.md`](plan.md) - goal, baseline, sequence, non-goals.
2. [`status.md`](status.md) - what is in progress; routes into
   `status/` shards.
3. [`runtime-stages.md`](runtime-stages.md) - client vs server
   responsibility per generation stage.
4. [`architecture.md`](architecture.md) - server module shape, API
   surface, boundary rules.
5. [`phases/`](phases/) - per-phase scope, exit criteria, and
   inline boundary rules.
6. [`coverage.md`](coverage.md) - test inventory router.
7. [`removed-and-out-of-scope.md`](removed-and-out-of-scope.md) -
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
