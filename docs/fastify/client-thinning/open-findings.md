# Open Findings

Date: 2026-05-28

There are currently **no unresolved F-numbered server-projection findings** from
the audited list. EC1 through EC6 are closed with regression coverage; see
[`history.md`](./history.md).

Client thinning is still **not complete**: EC7 remains open. The next agent
should implement the repeatable invariant audit described in
[`closeout-buckets.md`](./closeout-buckets.md#ec7-audit-script-specification),
then run the verification ladder from [`README.md`](./README.md#verification-ladder).

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
