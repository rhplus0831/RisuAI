# Client Thinning Plan

Date: 2026-05-28

## Goal

Finish client thinning as an independent workstream instead of treating it as a
small tail of the Fastify migration. In Fastify-served web mode, the browser is
a projection of server-owned durable state: it renders UI, forwards user intent,
applies server projections/events, and handles browser-only effects. Durable
writes go through server commands, import routes, asset routes, generation
routes, memory routes, or explicitly documented server-owned routes.

This folder defines a new active task family. Archived migration notes seed the
invariants, but work is selected from the current source tree rather than from a
numbered archive milestone.

End state:

- Fastify owns durable data in `data/db.json`, `data/assets/`, `data/risu.db`,
  `data/save/`, backups, and auth files.
- Browser code cannot mutate projected server state outside trusted projection
  writes or command-backed optimistic paths.
- Public mutation routes enforce active-writer ownership, stable ids, revision
  checks, validation, rollback, and events.
- Server provider dispatch is the Fastify generation boundary; unsupported
  providers fail explicitly.
- Prompt assembly and sendChat post-generation thinning are handled as named
  sub-families with proof, not as a catch-all Phase 9 tail.
- `pnpm client-thinning:audit` is reproducible in CI-like form: every invariant
  rule has a fixture/test that demonstrates the rule would catch the regression
  class.

## Boundary Sources

- [`docs/archive/fastify/client-thinning/`](../archive/fastify/client-thinning/README.md)
  is the archived contract seed and rationale.
- [`docs/archive/fastify/phases/phase-9-client-thinning.md`](../archive/fastify/phases/phase-9-client-thinning.md)
  records the original Phase 9 command/projection plan and closeout.
- [`docs/structure/`](../structure/README.md) is the current codebase map.
- [`util/client-thinning-audit.ts`](../../util/client-thinning-audit.ts) is the
  executable invariant audit.
- This folder owns active sequencing, status, and future handoff notes.

## Current Baseline

Implemented:

- Fastify route registration and SPA marker injection live in
  `server/fastify/src/app.ts`.
- Bootstrap projection, active-writer registration, command revision caching,
  projection write guard, command-event SSE, and browser command helpers are in
  place.
- Command resources cover settings, presets, prompt items, personas, translator
  presets, loadouts, characters, chats, messages, lorebooks, scripts/triggers,
  modules, plugins, and plugin storage.
- Server `.risu` import/export/bundle routes, asset validation, backup/restore,
  provider secret masking, and server-side Hypa V3 memory infrastructure exist.
- Fastify generation routes provide `/api/v1/generate/completion`,
  `/api/v1/generate/chat`, and `/api/v1/generate/preview-prompt`.
- The audit script checks structural invariants around writer ownership,
  command conflict replay, command-path id minting, resolver normalization,
  asset parser parity, wildcard secret identity, asset URL gates, composite
  command fan-out, backup inventory, bounded accumulators, and `saveAsset`
  filename classification.

## Boundaries And Gaps

- Audit fixture reproducibility is open. The audit rules need committed pre-fix
  fixtures plus tests that prove non-zero exit for each regression class.
- Prompt assembly still has a client fallback in `sendChat`; the server path is
  gated by `useServerPromptAssembly`, which defaults false.
- Stage 4 and browser post-generation behavior are still mixed. Server-backed
  generation result persistence exists, but local orchestration remains around
  response processing, auto-continue/resend, display, and browser effects.
- Event handling is conservative: command events trigger debounced bootstrap
  refresh rather than surgical local patches.
- Legacy storage route naming is historical but still active. Do not delete it
  because it says "legacy".
- Manual legacy local client verification remains deferred and should be scoped
  separately from Fastify projection hardening.

## Near-Term Order

1. Establish the active docs and record the first active-folder verification.
2. Implement audit fixture reproducibility for `pnpm client-thinning:audit`.
3. Split or shard the audit only when doing so improves fixture coverage or
   maintainability without weakening invariant derivation.
4. Pick one live invariant family when adding runtime work: command identity,
   active writer, projection write guard, event refresh, asset/import/backup
   boundary, provider routing, memory mutation, or sendChat prompt/post-gen
   thinning.
5. For sendChat thinning, first decide whether a batch removes client prompt
   assembly fallback, moves one post-generation branch server-side, or only adds
   proof. Do not mix those classes in one review.
6. Keep archive-derived closed areas closed unless current source inventory
   proves drift.

## Non-Goals

- Do not reintroduce native/mobile wrappers, Tauri, Hono, browser-local durable
  persistence as the primary runtime, Drive sync, Risu Account Sync, service
  worker behavior, peer sync, group chat, Supa/Hanurai/Hypa V2, or removed local
  memory engines.
- Do not add server-side plugin code execution as part of client thinning.
- Do not convert command events into surgical patches until there is a separate
  event-contract plan.
