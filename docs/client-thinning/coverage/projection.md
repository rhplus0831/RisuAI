# Projection Coverage

Date: 2026-05-28

## Current Proof

Bootstrap and events:

- `server/fastify/__tests__/bootstrap.test.ts`
- `server/fastify/__tests__/events.test.ts`
- `src/ts/server/bootstrap.test.ts`
- `src/ts/server/events.test.ts`
- `src/ts/bootstrap.test.ts`

Projection guard:

- `src/ts/process/__tests__/command.projectionGuard.test.ts`
- `src/ts/process/__tests__/lorebook.projectionGuard.test.ts`
- `src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `src/ts/hotkey.projectionGuard.test.ts`

## Expected Coverage Shape

Projection changes should prove:

- writer bootstrap sends active-writer header
- read-only refresh does not register writer ownership
- projection applies through trusted write scope
- ordinary mutation fails under the guard in Fastify mode
- command events lead to refresh behavior
- memory events preserve current progress behavior

## Known Gaps

- Event refresh is invalidation-based; there is no surgical patch contract.
- Manual browser smoke remains useful for end-to-end projection confidence.
