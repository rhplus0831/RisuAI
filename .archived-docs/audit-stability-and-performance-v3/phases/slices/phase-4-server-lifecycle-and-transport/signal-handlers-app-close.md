# Slice: Signal Handlers App Close

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Finding: M9.
Runtime lifecycle change.

## Scope

Make the existing Fastify `onClose` teardown reachable during normal process
shutdown. SIGTERM and SIGINT should close the live app, allowing in-flight
durable generation runners to settle and cancelled partials to persist before
SQLite closes.

This slice owns the API entrypoint lifecycle only. It does not change the
`onClose` hook's teardown order, database durability settings, dev-runner flag
restart behavior, Docker config, or generation cancellation semantics.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M9.
- `server/fastify/src/index.ts`: `main()`, `buildApp()`, `app.listen()`, and
  process exit paths.
- `server/fastify/src/app.ts`: existing `app.addHook('onClose')` teardown,
  `generationJobRegistry.settleRunners()`, and `db.close()`.
- `util/api-flag-dev.ts`: current dev-runner SIGTERM handling and SIGKILL
  backstop timing to stay under.
- New or existing focused lifecycle test under `server/fastify/__tests__/`.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for M9 proof registration.

## Target Shape

- Install `process.once('SIGTERM', ...)` and `process.once('SIGINT', ...)`
  after `buildApp()` succeeds and before/around `app.listen()`.
- Route both signals through one shutdown helper that is idempotent. A second
  signal during shutdown should not start a second `app.close()` call.
- The shutdown helper should:
  - log the signal,
  - arm an unref'd force-exit timeout backstop shorter than the dev runner's
    SIGKILL backstop,
  - call `await app.close()`,
  - clear the backstop on success,
  - exit with signal-style status when running as the entrypoint.
- If `app.listen()` fails before handlers are useful, keep the existing logged
  error and non-zero exit behavior.
- Prefer extracting a small testable function from `index.ts` over spawning the
  whole process for every lifecycle assertion.
- Add a harness or documented manual proof showing SIGTERM/SIGINT reaches
  `onClose`. The proof must observe close ordering, not just process exit.
- Register M9 as `DONE` in the v3 gate and flip only the M9 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- `app.close()` is called at most once per process lifetime.
- The backstop timer does not keep the process alive.
- The backstop is long enough for normal close work to finish but shorter than
  the flag dev runner's forced kill window.
- Closing the app still runs the existing teardown in `app.ts`: stop memory
  worker, clear timers, delete stream jobs, delete generation jobs, settle
  runners, close SQLite.
- Tests and normal imports of `index.ts` must not unexpectedly call
  `process.exit()`.

## Done Criteria

- SIGTERM runs the Fastify `onClose` hook and closes the database handle.
- SIGINT follows the same path.
- Repeated signals while shutdown is in progress do not double-close the app.
- A hung close path exits through the force backstop.
- M9 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/index.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
