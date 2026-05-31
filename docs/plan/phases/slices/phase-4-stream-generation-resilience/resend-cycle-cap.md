# Resend Cycle Cap

Status: planned.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/request/serverChat.ts`
- `src/ts/process/index.svelte.ts`

## Scope

Prevent repeated server-owned `postGeneration.resendChat` results from creating
an unbounded request cycle.

## Protocol Behavior

- Count consecutive server-requested resends per root user action.
- Surface a clear warning or error when the cap is exceeded.
- Preserve legitimate single resend behavior.

## Done When

- A looped output trigger cannot create unlimited generation requests.
- The cap resets at a clear root action boundary.
- Tests cover allowed resend and capped resend.

## Validation

- Focused generation or client request tests for resend behavior.
- `pnpm test -- src/ts/process`
