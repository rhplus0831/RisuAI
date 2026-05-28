# Open Findings

Date: 2026-05-28

There are currently **no unresolved F-numbered server-projection findings** from
the audited list. EC1 through EC7 are closed with regression coverage; see
[`history.md`](./history.md).

The repeatable invariant audit is now `pnpm client-thinning:audit`. The next
agent should run it with the verification ladder from
[`README.md`](./README.md#verification-ladder) before claiming any future
client-thinning closeout, and should extend it when a new invariant class is
found.

Resolved findings remain documented in [`history.md`](./history.md) so future
audits can compare new failures against prior decisions instead of re-deriving
the contract.

## Audit notes and exclusions

- Runtime-local caches (MCP display cache, translation/model caches, embedding
  caches, inlay assets, plugin permission prompts) are explicitly allowed by
  [`../phases-completed/phase-9-client-thinning-9-6d.md`](../phases-completed/phase-9-client-thinning-9-6d.md).
  They are not completion failures unless they become authoritative DB state.
- Remaining `bind:chara={DBState.db.characters[...]}` sites were checked; the
  inspected chat/toggle mutations route through command helpers in Fastify mode,
  so those bindings are not blockers.
