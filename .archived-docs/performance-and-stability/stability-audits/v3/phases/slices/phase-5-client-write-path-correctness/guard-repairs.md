# Slice: Guard Repairs

Phase: [5](../../phase-5-client-write-path-correctness.md). Findings: L34,
L35, and L36. Riding informational items: I20 and I11. v4 amendments:
v4-L30 and v4-L33. Client guard and persistence repair.

## Scope

Repair direct writes and guard-adjacent feature breakage that the read-only
server projection guard exposed. Each feature should work while the guard is
enabled, and any real user-visible state change must persist through the
appropriate scoped command instead of being only a trusted in-memory write.

This slice owns the IGP append, send error inlay bubble, `sendPofile`
transcript writes, `@@inject` display write, translator preset read-path
normalization, and partial MCP handshake feature breakage. It does not broaden
the projection guard, disable it for tests, move unrelated send/generation
logic, or schedule the rest of the v4 translator/MCP hygiene batch.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L34, L35, L36, I20, and I11.
- [`../../../../v4/audit-stability-and-performance-v4.md`](../../../../v4/audit-stability-and-performance-v4.md)
  v4-L30, v4-L33, and the routing note that folds them into the Phase 5
  projection-guard repair batch.
- `src/ts/server/projectionWriteGuard.svelte.ts`: guard enablement and
  `withTrustedServerProjectionWrite`.
- Guard/write inventory surfaces: `DBState.db`, `getDatabase()`, translator
  preset getters, IGP/inlay/file transcript mutation, display/script
  injection, and MCP bootstrap/handshake.
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
- `src/ts/translator/presets.ts`:
  `getCurrentTranslatorPresetFromState`, `normalizeTranslatorPresetState`,
  and `syncCurrentTranslatorPresetToLegacyFields`.
- `src/ts/translator/translator.ts`: `getCurrentTranslatorPreset` and
  `getDatabase()`.
- `src/ts/process/mcp/mcp.ts`: `initializeMCPs` and unguarded
  `checkHandshake` calls.
- `src/ts/process/mcp/googlesearchclient.ts`: internal Google Search
  handshake failure.
- Focused tests:
  `src/ts/process/__tests__/igp.test.ts`,
  `src/ts/process/__tests__/sendChatErrors.test.ts`,
  `src/ts/process/files/multisend.test.ts`,
  `src/ts/process/scripts.editdisplay.test.ts`, and
  `src/ts/process/__tests__/command.projectionGuard.test.ts`,
  `src/ts/translator/presets.test.ts`,
  `src/ts/translator/translator.cache.test.ts`,
  `src/ts/process/mcp/mcp.test.ts`, and
  `src/ts/process/mcp/googlesearchclient.test.ts`.

## Target Shape

- Run the new regression tests with
  `setServerProjectionWriteGuardEnabled(true)`. The existing guard-disabled
  tests are insufficient for this slice.
- Before changing runtime code, run a bounded inventory over `DBState.db`,
  `getDatabase()`, translator preset getters, IGP/inlay/file transcript
  mutation, display/script injection, and MCP bootstrap/handshake. For every
  live site, record one disposition in the implementation proof: fixed,
  no-action with reason, or deferred with owner.
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
- For v4-L30:
  make `getCurrentTranslatorPreset()` safe when it receives the read-only
  projection from `getDatabase()`. `getCurrentTranslatorPresetFromState` may
  keep its mutating state-normalizer contract for trusted mutable state, but
  the read path used by LLM translate must pass a clone or route any intended
  durable normalization through a trusted projection write plus scoped command.
- For v4-L33:
  isolate internal MCP handshake failures per MCP client. A failing
  `checkHandshake()` should make that client/tool set unavailable and visible
  to diagnostics, but it must not reject the whole `initializeMCPs` /
  `getTools()` path for translator, emotion, Iris, or Lua `LLM()` features.
- Prove each repaired path survives a projection re-stub or reload of the
  relevant projection state when persistence is expected.
- Prove the translator preset getter does not write through the read-only
  projection in both the current-preset sync branch and the normalize branch.
- Prove partial MCP handshake failure does not reject all LLM feature
  initialization when at least one other client can initialize.
- Register L34, L35, and L36 as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts`. Note I20 and I11 in the
  proof text, and flip only the L34-L36 rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) unless
  the table has explicit informational rows for I20/I11.
  Record v4-L30 and v4-L33 proof text without adding or flipping v3
  active-risk rows for them.

## Invariants

- `withTrustedServerProjectionWrite` stops guard throws, but persistence comes
  from scoped commands.
- Persisted repairs must not overwrite sibling chat rows, unrelated character
  fields, or full database state.
- `@@inject` display-only behavior must not become durable unless the feature
  already promises durable writes.
- Read-path getters may not normalize by writing into `DBState.db` or a
  `getDatabase()` projection unless they first clone or enter a trusted
  durable write path.
- MCP bootstrap must degrade by client/tool set; one internal handshake failure
  cannot break every client-side LLM feature that asks for tools.
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
- The bounded inventory records dispositions for `DBState.db`, `getDatabase()`,
  translator preset getters, IGP/inlay/file transcript mutation,
  display/script injection, and MCP bootstrap/handshake.
- `getCurrentTranslatorPreset()` used by LLM translate does not write through
  the read-only projection; tests cover both the preset-sync path and the
  missing/invalid-preset normalization path.
- A failing internal MCP handshake is isolated to that client/tool set; the
  first `getTools()` for client-side LLM features does not reject all feature
  initialization while another MCP client remains usable.
- L34, L35, and L36 are registered as `DONE` in the v3 gate and active-risk
  table, with I20/I11 covered by the same proof text and no unrelated ID
  status changes. v4-L30 and v4-L33 proof is recorded as Phase 5 amendment
  proof, not as v3 status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/__tests__/igp.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/ts/translator/presets.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/mcp/googlesearchclient.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
