# Command Boundaries

Date: 2026-05-29

Status: CLOSED / stable.

The command contract is closed: command bodies carry `baseRevision`; stale
revisions return 409 with the current revision; the active-writer guard rejects
stale mutating sessions with 423; a successful JSON command bumps revision once
and emits one command event; failures roll back without a revision bump. The
major durable resource command families are covered.

Proof:

- `server/fastify/__tests__/commands.test.ts`
- `src/ts/server/commands.test.ts`

Do not reopen unless current source inventory proves drift. See
[`../plan.md`](../plan.md) for the spine.
