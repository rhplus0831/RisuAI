# Architecture And Structure

Date: 2026-05-30

## Complexity Snapshot

Approximate `wc -l` from the tree. Routing data, not design targets.

| File                                           | Lines | Relevance                                                                  |
| ---------------------------------------------- | ----: | -------------------------------------------------------------------------- |
| `server/fastify/src/routes/commands.ts`        | ~4284 | Command route surface; closed/stable.                                      |
| `src/ts/storage/database.svelte.ts`            | ~2738 | Browser normalization + projection application; `useServerPromptAssembly` default + JSDoc live here. |
| `util/client-thinning-audit.ts`                | ~3642 | Invariant audit (23 checks); reproducible, four defeated rules hardened; some shallow rules remain. |
| `src/ts/server/commands.ts`                    | ~2256 | Browser command transport; `canUseServerCommands()` = `isFastifyServer`.   |
| `server/fastify/src/prompt/assemble.ts`        | ~1638 | Server prompt assembly facade plus A2 post-generation pass.                |
| `server/fastify/src/prompt/luaRuntime.ts`      | ~1086 | Server Lua VM runtime used by the ported Lua edit/input hooks.             |
| `server/fastify/src/prompt/chatDispatch.ts`    | ~1045 | Server provider dispatch for the chat route.                               |
| `server/fastify/src/repository.ts`             |  ~477 | Durable data dir ownership; closed/stable.                                 |
| `server/fastify/src/routes/generationChat.ts`  | ~1292 | `/generate/chat`; provider stream, assembly/post-gen scriptstate mutations, submit transcript persistence when hooks change it, plus the durable-generation runner + reattach/cancel routes. |
| `src/ts/process/index.svelte.ts`               |  ~416 | `sendChat`: the three boundaries + post-generation orchestration + durable-generation gate. |
| `src/ts/process/request/serverPromptAssembly.ts` | ~266 | Prompt-assembly classifier.                                                |
| `src/ts/process/request/serverCompletion.ts`   |  ~943 | `resolveServerCompletionRoute` (the classifier precedent for A1).          |
| `src/ts/server/projectionWriteGuard.svelte.ts` |  ~108 | Projection write guard primitive.                                          |

## Ownership Boundaries

- `server/fastify/src/app.ts`: route registration, SPA serving, Fastify marker.
- `server/fastify/src/routes/bootstrap.ts`: bootstrap projection, secret masking,
  active-writer registration.
- `server/fastify/src/routes/commands.ts` + `commands/*.ts`: command surface and
  resource validation; `commands/mutations.ts`: revision check, mutation, bump,
  one event, rollback.
- `server/fastify/src/repository.ts`: persisted JSON, assets, backup/restore.
- `server/fastify/src/routes/events.ts`: command/memory SSE (invalidation).
- `server/fastify/src/routes/generationChat.ts` + `prompt/`: server prompt
  assembly, chat dispatch, asset lookup, assembly-time scriptstate persistence,
  and the server-owned post-generation derivation on the server-dispatch path.
- `src/ts/process/index.svelte.ts`: `sendChat` — prompt-assembly gate, dispatch
  handoff, post-generation orchestration.
- `src/ts/process/request/serverCompletion.ts`: provider route selection;
  unsupported shapes fail explicitly.
- `src/ts/process/request/serverPromptAssembly.ts`: prompt-assembly route
  selection; unsupported content hard-fails instead of falling through to local.
- `src/ts/storage/database.svelte.ts`: normalization, projection application,
  legacy compatibility surface.
- `util/client-thinning-audit.ts`: executable invariants.

**Legacy:** group chat is filtered from loaded data and request dispatch hardcodes
`isGroupChat: false`; remaining UI/type compatibility surface is slated for
client removal — see [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

## Test Layout

- Server: `server/fastify/__tests__/{commands,activeWriter,bootstrap,events,assets,backups,risuSave*,generation.chat}.test.ts`
- Browser adapters: `src/ts/server/*.test.ts`, `src/ts/bootstrap.test.ts`
- Projection guard: `src/ts/**/*.projectionGuard.test.ts`
- Chat process / generation: `src/ts/process/__tests__/sendChat.*`,
  `src/ts/process/request/tests/server{Completion,Chat}.test.ts`
- Audit: `util/client-thinning-audit.test.ts`

## Guidance

- Keep root docs as routers; behavior shards as canonical detail.
- Do not add broad new server subsystems for client thinning; tighten existing
  route/helper contracts with tests.
- If the audit is split, split by invariant family and keep one
  `pnpm client-thinning:audit` entry point.
