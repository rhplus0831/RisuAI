# Latest Verification Log

Status: implemented.

## Source Anchors

- `.archived-docs/protocol-and-persistence/server-client-protocol/status.md`
- `.archived-docs/protocol-and-persistence/server-client-protocol/next-steps.md`
- `.archived-docs/protocol-and-persistence/server-client-protocol/phases/`

## Scope

Add a single maintained latest-verification record for this workstream if
verification history starts to sprawl across phase docs or task notes.

Implemented scope:

- Added `.archived-docs/protocol-and-persistence/server-client-protocol/latest-verification.md` as the single maintained latest
  verification record.
- Recorded the latest focused Phase 8 verification command set and results.
- Linked the latest verification record from `status.md` and `next-steps.md`.

## Protocol Behavior

- Keep only the latest command/result in the verification record.
- Do not append old runs indefinitely.
- Link the latest verification from `status.md` or `next-steps.md` once the
  file exists.

## Done When

- Agents know where to check the most recent full or focused verification.
- Stale verification text is not duplicated across many phase docs.

Done.

## Validation

- Documentation review.
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm client-thinning:audit`
