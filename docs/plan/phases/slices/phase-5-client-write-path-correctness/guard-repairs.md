# Slice: Guard Repairs

Phase: [5](../../phase-5-client-write-path-correctness.md). Findings: L34,
L35, and L36. Riding informational items: I20 and I11. Client guard and
persistence repair.

## Scope

Repair direct writes that the read-only server projection guard exposed. Each
feature should work while the guard is enabled, and any real user-visible state
change must persist through the appropriate scoped command instead of being
only a trusted in-memory write.

This slice owns the IGP append, send error inlay bubble, `sendPofile`
transcript writes, and the `@@inject` display write. It does not broaden the
projection guard, disable it for tests, or move unrelated send/generation
logic.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L34, L35, L36, I20, and I11.
- `src/ts/server/projectionWriteGuard.svelte.ts`: guard enablement and
  `withTrustedServerProjectionWrite`.
- `src/ts/process/command.ts`: `mutateCurrentChatMessages` persistence
  pattern.
- `src/ts/process/postGeneration/igp.ts`: IGP append and I11
  `[object Object]` coercion fix.
- `src/ts/process/postGeneration/orchestrateResponse.ts`: IGP caller outside
  the server-owned gate.
- `src/ts/process/sendChatErrors.ts`: `reportSendChatError` and
  `inlayErrorResponse` error bubble.
- `src/ts/process/files/multisend.ts`: `sendPofile` transcript turn writes.
- `src/lib/ChatScreens/DefaultChatScreen.svelte`: picker call site for
  `sendPofile`.
- `src/ts/process/scripts.ts`: `@@inject` branch and display mutation.
- Focused tests:
  `src/ts/process/__tests__/igp.test.ts`,
  `src/ts/process/__tests__/sendChatErrors.test.ts`,
  `src/ts/process/files/multisend.test.ts`,
  `src/ts/process/scripts.editdisplay.test.ts`, and
  `src/ts/process/__tests__/command.projectionGuard.test.ts`.

## Target Shape

- Run the new regression tests with
  `setServerProjectionWriteGuardEnabled(true)`. The existing guard-disabled
  tests are insufficient for this slice.
- For IGP append:
  wrap the local write in `withTrustedServerProjectionWrite`,
  persist via the narrow current-chat command pattern,
  and coerce appended non-string payloads with `String(value)` or an explicit
  domain formatter so `[object Object]` does not leak unintentionally.
- For `inlayErrorResponse`:
  write the error bubble under a trusted projection write,
  persist it through a scoped current-chat command,
  and keep the alert fallback for cases where the current character/chat slot
  is invalid.
- For `sendPofile`:
  wrap transcript turn writes in trusted projection writes,
  persist them through scoped chat commands,
  and keep the picker/cancel/error behavior unchanged.
- For `@@inject`:
  either operate on a working clone because display scripts should not persist,
  or wrap only the transient display write in a trusted projection write and
  explicitly avoid persistence if the current semantics are display-only.
- Prove each repaired path survives a projection re-stub or reload of the
  relevant projection state when persistence is expected.
- Register L34, L35, and L36 as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts`. Note I20 and I11 in the
  proof text, and flip only the L34-L36 rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) unless
  the table has explicit informational rows for I20/I11.

## Invariants

- `withTrustedServerProjectionWrite` stops guard throws, but persistence comes
  from scoped commands.
- Persisted repairs must not overwrite sibling chat rows, unrelated character
  fields, or full database state.
- `@@inject` display-only behavior must not become durable unless the feature
  already promises durable writes.
- Guard-enabled tests must fail before the repair and pass after it.
- User-facing error fallback behavior remains intact when the target chat
  cannot be updated.

## Done Criteria

- IGP append works with the guard enabled, persists through projection
  re-stub, and no longer appends unintended `[object Object]` text.
- `inlayErrorResponse` inserts and persists the error bubble with the guard
  enabled.
- `sendPofile` transcript turns insert and persist with the guard enabled.
- `@@inject` no longer throws under the guard and preserves display-only versus
  durable semantics intentionally.
- L34, L35, and L36 are registered as `DONE` in the v3 gate and active-risk
  table, with I20/I11 covered by the same proof text and no unrelated ID
  status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/__tests__/igp.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
