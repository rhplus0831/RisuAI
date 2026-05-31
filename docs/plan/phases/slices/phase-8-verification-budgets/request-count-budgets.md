# Request Count Budgets

Status: planned.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `src/ts/bootstrap.ts`
- `server/fastify/__tests__/`

## Scope

Add tests or diagnostics that catch request-count regressions in hot workflows
such as bulk hydration, targeted projection, memory jobs, and asset-heavy views.

## Protocol Behavior

- Start with development diagnostics where stable CI thresholds would be
  brittle.
- Promote stable workflows to tests once expected counts are known.
- Record intentional exceptions in the relevant phase or slice.

## Done When

- At least one hot workflow has a maintained request-count guard.
- The guard distinguishes user-triggered all-history workflows from render-loop
  regressions.

## Validation

- Budget tests introduced by this slice.
- `pnpm test`
