# Fastify Migration Roadmap

Date: 2026-05-23

This directory is the working roadmap for moving Risuai from a thick
browser app to a Fastify backend with a display-only client. The
codebase is the source of truth; these docs describe the intended
direction, current status, and the boundary decisions task agents need
before widening behavior.

Each doc is short on purpose so an LLM agent can load only the shards
it needs.

## Scope

Current status: Phases 0-6 are closed and Phase 7 is in progress.
Fastify owns bootstrap, JSON import, content-addressed assets,
backups, static SPA serving, provider proxy fetch, stream-job
WebSocket transport, Risu hub passthrough, the legacy NodeStorage
key-value surface, and the closed `/api/v1/generate/completion`
provider matrix. Phase 7 has landed the `/api/v1/generate/chat`
scaffold plus server-side variable expansion, static prompt
sections, plain prompt sections, history shaping through multimodal
inlays, regex scripts, active-module helpers, and lorebook
activation through depth-prompt helpers; the root assembler,
template, token, and trigger modules are still stubs.
Express has been deleted. The Dockerfile and compose file target
Fastify on port 6002 with `/app/data` persisted; `tsx` and
`@fastify/websocket` are runtime dependencies after `1eddbfba`.

Phase 5 closed on 2026-05-22: commits `3c5a92b2` through
`a7e2831d` reduced `src/ts/process/index.svelte.ts` from 1625 to
445 lines and extracted prompt assembly, request budgeting,
provider dispatch, response orchestration, Stage 4 closeout, and
entry-context setup into focused browser-side modules. The local
fixture harness now has 38 snapshots: 17 Phase 4 fixtures, 9 Phase
5 gates, and 12 Phase 6 provider parity fixtures (`echo-basic`,
`openai-basic`, `anthropic-basic`, `mistral-basic`,
`cohere-basic`, `deepseek-basic`, `gemini-basic`,
`gemini-vertex-basic`, `bedrock-basic`, `horde-basic`,
`mistral-reverse-proxy-basic`, `anthropic-reverse-proxy-basic`).
A separate server-backed sweep checks those 12 fixtures through
`/api/v1/generate/completion`.

In scope:

- A new Fastify + TypeScript server that owns persistence, generation,
  and outbound provider calls.
- The Phase 0 removal set: Group chat, peer-to-peer multi-user chat,
  Risu Account Sync, Google Drive sync, and the Supa / Hypa V2 /
  Hanurai memory engines have been removed from the client surface.
- Moving the extracted generation seams server-side. Phase 6 closed
  the completion route in Phase 6-28 (`398a3ae6`, hash backfilled by
  `a8cb123b`). Phase 7 slices through 7-7e are now landed, with
  7-7d parked until the 7-8a server tokenizer exists; the current
  provider matrix lives in
  [`coverage/providers.md`](coverage/providers.md), and the active
  slice history lives in [`status/next-steps.md`](status/next-steps.md).
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
- **Sequence.** Remove first, then port. Phase 0 strips the deprecated
  features so the surface that gets ported is smaller.
- **sendChat.** Tests first, extraction second. Phase 5 shrank
  `src/ts/process/index.svelte.ts` into focused browser modules;
  later server phases keep the fixture-pinned behavior intact.
- **Client modes.** Server-backed web only. Tauri stays as-is.
- **Hub.** Fastify proxies hub traffic through `/api/v1/hub/*`.
  The route is intentionally still auth-gated; session-cookie or
  public element-load support is tracked as a follow-up.
- **Memory.** Only Hypa V3 survives. Supa, Hypa V2, Hanurai are
  removed in Phase 0.
- **Drive.** Google Drive sync is removed in Phase 0 with the rest of
  the client-owned cloud storage.

## Read order

1. [`plan.md`](plan.md) - goal, baseline, sequence, non-goals.
2. [`status.md`](status.md) - current progress and next work; routes into
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
