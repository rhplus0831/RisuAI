# Runtime Stages

Date: 2026-05-28

## Stage A: Fastify Shell And Bootstrap

Current owner: server plus browser bootstrap adapter.

Responsibilities:

- Serve the built SPA when `RISU_API_STATIC_ROOT` is enabled.
- Inject the Fastify marker.
- Authenticate `/api/v1/bootstrap`.
- Register active-writer ownership only for writer-intent bootstrap.
- Return revision, schema version, masked database projection, and asset base
  URL.
- Cache command revision in the browser.

Migration target:

- Keep passive refresh read-only. Any new refresh path must use the read-only
  helper unless it is explicitly a page-load or user-intent writer registration.

## Stage B: Browser Projection And Guard

Current owner: browser projection adapter.

Responsibilities:

- Apply server projections through trusted write scopes.
- Prevent ordinary code from mutating `DBState.db` in Fastify mode.
- Keep local UI state and transient interaction state outside durable server
  state.

Migration target:

- When a projection guard catches a write, add or use a command-backed path
  unless the state is truly browser-local.

## Stage C: Command Mutation Boundary

Current owner: Fastify command routes and browser command helpers.

Responsibilities:

- Validate `baseRevision`.
- Reject stale revisions with 409.
- Reject stale active-writer sessions with 423.
- Validate stable ids and resource ownership.
- Apply one persisted mutation, bump revision once, emit one event, and roll
  back on failure.

Migration target:

- New durable writes should be command-backed or explicitly documented as
  import/asset/generation/memory route mutations.
- Composite browser command fan-out must serialize revisions or become one
  server command.

## Stage D: Event Projection Refresh

Current owner: Fastify event route and browser event adapter.

Responsibilities:

- Stream command and memory events.
- Schedule projection refresh after command events.
- Apply memory progress side effects where the current UI expects them.

Migration target:

- Keep events as invalidation, not surgical patch contracts, until a separate
  event-patching plan exists.

## Stage E: Generation, Prompt, And Memory

Current owner: mixed, with server-owned provider dispatch and memory.

Responsibilities:

- Fastify provider dispatch owns supported provider requests in Fastify mode.
- `/api/v1/generate/chat` owns server prompt assembly when enabled.
- Browser `sendChat` still owns local prompt fallback and mixed
  post-generation orchestration.
- Hypa V3 memory persistence and jobs are server-side.

Migration target:

- Treat prompt assembly defaulting and post-generation thinning as separate
  client-thinning sub-families. Each batch needs a source branch, server
  contract, and proof.

## Stage F: Audit And Closeout

Current owner: audit script, fixture tests, and docs.

Responsibilities:

- Assert projection invariants structurally.
- Keep new findings from becoming one-off fixes.
- Record verification and update status/coverage shards after runtime changes.

Migration target:

- Finish audit fixture reproducibility before claiming closeout. Every audit
  rule needs a pre-fix fixture and failing proof.
