# Slice: Plugin Lifecycle

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
M7, L43, and L44. Client plugin lifecycle and log-hygiene change.

## Scope

Make V3 plugin hosts remove their window listeners on unload, reset or dedupe
custom provider stores on plugin reload, and remove ungated RPC payload logs.

This slice owns the V3 `SandboxHost` lifecycle, V3 custom-provider store
reload behavior, and V3 plugin RPC console logging. It may mirror existing V2
plugin reset patterns. It does not redesign the plugin API, provider
registration protocol, plugin storage persistence, or MCP plugin tools.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M7, L43, and L44.
- `src/ts/plugins/apiV3/factory.ts`: `SandboxHost`, `run()`, `terminate()`,
  guest-to-host RPC handling, and current console logs.
- `src/ts/plugins/apiV3/v3.svelte.ts`: `executePluginV3`, `unloadV3Plugin`,
  custom provider registration, `customProviderStore`, and
  `customV3ProviderMetaStore`.
- `src/ts/plugins/plugins.svelte.ts`: `loadV2Plugin` reset block and plugin
  reload/toggle flow.
- Existing focused tests near `src/ts/plugins/plugins.test.ts`; add V3
  lifecycle tests near the touched modules if needed.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  M7/L43/L44 proof registration.

## Target Shape

- Store the cleanup closure returned by `SandboxHost.run()` on the
  `SandboxHost` instance, or otherwise keep a stable handle that
  `terminate()` can invoke exactly once.
- Ensure `terminate()` removes the permanent `window.message` listener even
  when plugin execution fails, unload is called repeatedly, or a plugin is
  reloaded after an import/save/toggle cycle.
- Reset or dedupe `customProviderStore` and `customV3ProviderMetaStore` during
  V3 plugin reload. Acceptable shapes include mirroring the existing V2 reset
  block or registering unload callbacks that remove only the providers owned
  by the unloading plugin.
- Preserve provider ordering and metadata for a single successful load.
- Remove the ungated `SandboxHost` RPC console logs, or gate them behind an
  explicit debug flag that defaults off. Never log transferables or full RPC
  payloads by default.
- Add focused probes for repeated plugin toggles: zero net window listeners,
  no duplicate provider entries, and no default RPC payload logs.
- Register M7, L43, and L44 as `DONE` in the v3 gate and flip only those rows
  in [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Loading one valid V3 plugin still starts its sandbox and exposes its
  registered API/provider behavior.
- Unloading remains idempotent.
- Providers from still-loaded plugins must not be removed when another plugin
  unloads.
- Debug logging, if retained, must be opt-in and must avoid transferables and
  multi-MB payloads.
- V2 plugin reset behavior remains unchanged except for shared helper reuse.

## Done Criteria

- Repeated V3 plugin load/unload cycles leave zero net `window.message`
  listeners.
- Repeated plugin reloads do not duplicate custom provider entries or V3
  provider metadata.
- Sandbox RPC request/response payload logs are silent by default, and
  transferables are never logged.
- M7, L43, and L44 are registered as `DONE` in the v3 gate and active-risk
  table, with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/plugins/plugins.test.ts \
  src/ts/plugins/apiV3/factory.test.ts \
  src/ts/plugins/apiV3/v3.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
