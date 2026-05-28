# Architecture And Structure

Date: 2026-05-28

## Complexity Snapshot

Measured from the current tree with `wc -l`. Treat these as routing data, not
design targets.

| File                                           | Lines | Current risk                                                                                                 |
| ---------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------ |
| `server/fastify/src/routes/commands.ts`        |  4284 | Large command surface; many resource families share route-level validation and error handling.               |
| `src/ts/storage/database.svelte.ts`            |  2726 | Central browser database normalization and projection application; historical local paths still live nearby. |
| `util/client-thinning-audit.ts`                |  2650 | Monolithic invariant audit; needs fixture/test reproducibility.                                              |
| `src/ts/server/commands.ts`                    |  2256 | Browser command transport and wrappers; command fan-out and revision caching risks live here and in callers. |
| `server/fastify/src/prompt/assemble.ts`        |  1143 | Server prompt assembly facade; relevant to sendChat thinning.                                                |
| `server/fastify/src/prompt/chatDispatch.ts`    |  1045 | Server provider dispatch resolver for chat route; provider widening must stay explicit.                      |
| `server/fastify/src/repository.ts`             |   477 | Durable data directory ownership, assets, backups, and persisted JSON helpers.                               |
| `server/fastify/src/routes/generationChat.ts`  |   426 | Chat prompt SSE route and optional provider dispatch.                                                        |
| `src/ts/server/projectionWriteGuard.svelte.ts` |   108 | Projection write guard primitive; small but central.                                                         |

## Ownership Boundaries

- `server/fastify/src/app.ts`: route registration, app composition, static SPA
  serving, and Fastify marker injection.
- `server/fastify/src/routes/bootstrap.ts`: authenticated bootstrap projection,
  provider secret masking, active-writer registration.
- `server/fastify/src/activeWriter.ts`: active-writer state and mutating route
  classification.
- `server/fastify/src/routes/commands.ts`: public command route surface.
- `server/fastify/src/commands/*.ts`: resource-specific validation, id rules,
  patch/reorder/replace semantics, and command helpers.
- `server/fastify/src/commands/mutations.ts`: revision check, persisted JSON
  mutation, revision bump, event emission, and rollback.
- `server/fastify/src/repository.ts`: persisted JSON, asset metadata/bytes,
  backup/restore inventory, and data directory helpers.
- `server/fastify/src/routes/events.ts`: command/memory SSE.
- `src/ts/server/*.ts`: browser adapters for bootstrap, commands, events,
  assets, backups, and projection guard behavior.
- `src/ts/storage/database.svelte.ts`: database normalization, projection
  application, and legacy/local compatibility surface.
- `src/ts/process/request/serverCompletion.ts`: Fastify provider route
  selection and unsupported-provider failures.
- `src/ts/process/request/serverChat.ts`: browser adapter for server prompt
  assembly and server-backed generation stream.
- `server/fastify/src/routes/generationChat.ts`: server prompt assembly route.
- `util/client-thinning-audit.ts`: executable structural invariants.

## Test Layout

Server route and repository coverage:

- `server/fastify/__tests__/commands.test.ts`
- `server/fastify/__tests__/activeWriter.test.ts`
- `server/fastify/__tests__/bootstrap.test.ts`
- `server/fastify/__tests__/events.test.ts`
- `server/fastify/__tests__/assets.test.ts`
- `server/fastify/__tests__/backups.test.ts`
- `server/fastify/__tests__/risuSave*.test.ts`

Browser adapter coverage:

- `src/ts/server/commands.test.ts`
- `src/ts/server/bootstrap.test.ts`
- `src/ts/server/events.test.ts`
- `src/ts/server/assets.test.ts`
- `src/ts/server/backups.test.ts`
- `src/ts/bootstrap.test.ts`
- `src/ts/storage/risuSave.test.ts`

Projection guard coverage:

- `src/ts/process/__tests__/command.projectionGuard.test.ts`
- `src/ts/process/__tests__/lorebook.projectionGuard.test.ts`
- `src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `src/ts/hotkey.projectionGuard.test.ts`

Generation and prompt thinning leads:

- `src/ts/process/request/tests/serverCompletion.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `server/fastify/__tests__/generation.chat.test.ts`
- Provider-specific tests under `server/fastify/__tests__/`

## Recommended Near-Term Structure

- Keep root docs as routers and behavior shards as the canonical detail.
- Keep audit work in a dedicated phase until fixture/test reproducibility is
  complete.
- Do not add broad new server subsystems for client thinning. Prefer tightening
  existing route/helper contracts with tests.
- If `util/client-thinning-audit.ts` is split, split by invariant family and
  preserve one `pnpm client-thinning:audit` entry point.
- Keep `routes/commands.ts` route-level until a resource split has a clear
  test-backed ownership benefit. Validation helpers already live in
  `server/fastify/src/commands/`.
