# Resend Cycle Cap

Status: implemented.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/request/serverChat.ts`
- `src/ts/process/index.svelte.ts`

## Scope

Prevent repeated server-owned `postGeneration.resendChat` results from creating
an unbounded request cycle.

Implemented by carrying an internal server-resend depth through the recursive
`sendChat` handoff. A root user action may honor one server-requested resend;
a second consecutive server-owned resend surfaces an error and stops before a
third generation request. The resend handoff re-enters as `continue` so a
legitimate single resend can run after the first assistant reply.

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
- Passed: `pnpm test -- src/ts/process/__tests__/sendChat.serverPreview.test.ts`
  (Vitest project selection ran 94 client test files: 921 passed, 4 skipped).
- Passed: `pnpm test -- src/ts/process` (94 client test files: 921 passed, 4
  skipped).
