# Slice: Plugin Lifecycle

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
M7, L43, and L44. v4 amendment: v4-L37 where it matches the plugin-owned
listener/observer lifecycle invariant. Client plugin lifecycle and
log-hygiene change.

## Scope

Make V3 plugin hosts remove their window listeners on unload, reset or dedupe
custom provider stores on plugin reload, remove plugin-registered DOM
listeners and observers on unload, and remove ungated RPC payload logs.

This slice owns the V3 `SandboxHost` lifecycle, V3 custom-provider store
reload behavior, plugin-owned DOM listener/observer cleanup, and V3 plugin
RPC console logging. It may mirror existing V2 plugin reset patterns. It does
not redesign the plugin API, provider registration protocol, plugin storage
persistence, DPoP/auth storage recovery, or MCP plugin tools.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M7, L43, and L44.
- `src/ts/plugins/apiV3/factory.ts`: `SandboxHost`, `run()`, `terminate()`,
  guest-to-host RPC handling, and current console logs.
- `src/ts/plugins/apiV3/v3.svelte.ts`: `executePluginV3`, `unloadV3Plugin`,
  custom provider registration, `customProviderStore`, and
  `customV3ProviderMetaStore`; v4-L37 `SafeElement.addEventListener`,
  document listeners, and `SafeMutationObserver`.
- `src/ts/plugins/plugins.svelte.ts`: `loadV2Plugin` reset block and plugin
  reload/toggle flow.
- [`../../../../audit-stability-and-performance-v4.md`](../../../../audit-stability-and-performance-v4.md):
  v4-L37.
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
- Track plugin-registered document/window/element listeners and
  `SafeMutationObserver` instances under the owning plugin or sandbox host.
  Unload/terminate must remove listeners and disconnect observers exactly
  once, including failed startup, repeated unload, and reload paths. If a
  `SafeMutationObserver` API shape changes, keep the guest-facing behavior
  compatible while adding host-side cleanup ownership.
- Inventory every plugin cache/store entry, listener, observer, timer, and
  debug-log site added to this slice. Each live site must be fixed,
  explicitly no-actioned with reason, or measured/deferred with an owner note
  in the slice proof.
- Add focused probes for repeated plugin toggles: zero net window listeners,
  zero net document listeners and `SafeMutationObserver`s, no duplicate
  provider entries, and no default RPC payload logs.
- Register M7, L43, and L44 as `DONE` in the v3 gate and flip only those rows
  in [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
  Record v4-L37 coverage in proof text without adding unrelated v3 status
  changes.

## Invariants

- Loading one valid V3 plugin still starts its sandbox and exposes its
  registered API/provider behavior.
- Unloading remains idempotent.
- Providers from still-loaded plugins must not be removed when another plugin
  unloads.
- Plugin-owned DOM listeners and observers must be scoped to the plugin that
  registered them and must not survive unload/reload.
- Debug logging, if retained, must be opt-in and must avoid transferables and
  multi-MB payloads.
- V2 plugin reset behavior remains unchanged except for shared helper reuse.

## Done Criteria

- Repeated V3 plugin load/unload cycles leave zero net `window.message`
  listeners.
- Repeated V3 plugin load/unload cycles leave zero net guest-registered
  document listeners and disconnected `SafeMutationObserver`s.
- Repeated plugin reloads do not duplicate custom provider entries or V3
  provider metadata.
- Sandbox RPC request/response payload logs are silent by default, and
  transferables are never logged.
- The slice proof records the plugin cache/listener/observer/timer/debug-log
  inventory, including any explicit no-action or measured-deferred entries.
- M7, L43, and L44 are registered as `DONE` in the v3 gate and active-risk
  table, with no unrelated ID status changes.

## Proof Notes

- Fixed `SandboxHost.run()`/`terminate()` ownership: the run cleanup closure is
  stored on the host, removes the permanent `window.message` listener, drains
  pending debug execution listeners, clears host registries, and is idempotent
  across unload, repeated terminate, callback failure, and startup failure.
- Fixed V3 reload teardown: `loadV3Plugins()` unloads a snapshot of running
  instances so splicing during unload cannot skip sibling plugin hosts.
- Fixed V3 provider stores: provider registrations are tracked by plugin owner
  and provider name, `customProviderStore` is rebuilt from the active provider
  map, `customV3ProviderMetaStore` reflects only active V3 providers, duplicate
  provider names keep one visible entry, and unloading one plugin restores or
  preserves providers from still-loaded owners.
- Fixed plugin-owned DOM lifecycle for v4-L37: `SafeElement` document
  listeners and `SafeMutationObserver`s are registered under the owning V3
  lifecycle and removed/disconnected exactly once on unload. Safe wrappers
  created from document queries, children, parents, clones, and mutation records
  carry the same owner.
- Fixed plugin cache/store cleanup: plugin channel listeners now register an
  unload callback, V2 reload clears stale provider options and custom-provider
  names before reloading, and no timer sites are introduced by this slice.
- Fixed debug-log hygiene: the default SandboxHost RPC request/response payload
  logs were removed; only the existing postMessage failure error log remains.

## Validation

```bash
pnpm exec vitest run \
  src/ts/plugins/plugins.test.ts \
  src/ts/plugins/apiV3/factory.test.ts \
  src/ts/plugins/apiV3/v3.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
