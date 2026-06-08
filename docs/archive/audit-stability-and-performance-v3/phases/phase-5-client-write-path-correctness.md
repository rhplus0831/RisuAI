# Phase 5: Client Write-Path Correctness (Themes 4+5)

Status: complete.

Goal: one invariant pass over the optimistic-write state machine — every
bridge flushes on unload, suppresses its own rollbacks, keeps true first
baselines, and has a rollback at all — plus repair of the features the
read-only projection guard silently broke.

Findings: M8, L21, L23, L24, L25, L26, L27, L34, L35, L36, L37.
v4 amendments: v4-L30 and v4-L33 ride the guard-repair proof matrix; they do
not create new v3 active-risk rows.
Riding informational items: I20 (`@@inject` wrap, same pattern as L34-L36),
I21 (rides L37's handler hardening), I11 (`[object Object]` coercion, fixed
inside L34).

## Completed Slices

Authored under `slices/phase-5-client-write-path-correctness/`.

- [unload-flush](slices/phase-5-client-write-path-correctness/unload-flush.md)
  (M8) — a `flushAllPendingBridgePatches()` aggregator over all six bridges,
  invoked from one `pagehide`/`visibilitychange(hidden)` handler AND from
  watcher teardown, dispatching via `fetch(..., { keepalive: true })`. Must
  respect the suppression flags so a flush never double-dispatches (interplay
  with L23-L27).
- [rollback-suppression](slices/phase-5-client-write-path-correctness/rollback-suppression.md)
  (L23, L24, L26) — wire `suppressRollbackDispatch` (the
  `rollbackServerBackedLorebooks` shape) into:
  `applyServerBackedSettingsPatch` (both the optimistic write and the
  rollback), the global-lorebook direct dispatchers' rollbacks, and the
  chat-row metadata rollback (`restoreChatRowMetadata` through a suppressing
  wrapper).
- [first-baselines](slices/phase-5-client-write-path-correctness/first-baselines.md)
  (L25, L27) — keep the FIRST baseline across coalesced same-item
  prompt-template edits (`existing?.previous ?? previous` shape); promote the
  pending lorebook entry snapshot to a collection snapshot when a second entry
  edit lands in the same debounce window.
- [preset-rollback](slices/phase-5-client-write-path-correctness/preset-rollback.md)
  (L21) — add a rollback parameter to `runPresetCommand` (signature change +
  all 8 callers); snapshot `botPresets`/`botPresetsId` plus, for `setPreset`
  callers, the affected scalar settings.
- [guard-repairs](slices/phase-5-client-write-path-correctness/guard-repairs.md)
  (L34, L35, L36 + riding I20/I11 + v4-L30/v4-L33) — run a bounded
  guarded-write / feature-breakage inventory over `DBState.db`,
  `getDatabase()`, translator preset getters, IGP/inlay/file transcript
  mutation, display/script injection, and MCP bootstrap/handshake. Every live
  site is either fixed, explicitly no-actioned with reason, or deferred with an
  owner. Wrap each broken direct write in `withTrustedServerProjectionWrite`
  AND persist via a scoped command when the state is durable (wrapping alone is
  session-transient). Add guard-ENABLED tests for fixed write sites and focused
  feature-breakage proof for the translator preset getter and partial MCP
  handshake failure.
- [error-handler-hardening](slices/phase-5-client-write-path-correctness/error-handler-hardening.md)
  (L37 + riding I21) — null-safe global `error` handler (check
  `event.target`, not `event.error.target`; skip alerting when no usable error
  exists) and `String(msg)` coercion in `alertError`.
- [phase-5-verification-refresh](slices/phase-5-client-write-path-correctness/phase-5-verification-refresh.md)
  — gates, focused proofs, full validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M8, L21, L23-L27, L34-L37 (the verifier corrections name the precise
  trigger paths and the existing suppression/baseline precedents).
- [`../../../audit-stability-and-performance-v4.md`](../../../audit-stability-and-performance-v4.md) -
  v4-L30, v4-L33, and the Phase 5 routing note that folds translator preset
  and MCP handshake feature breakage into this guard-repair sweep.
- M8: `src/ts/server/settingsBridge.svelte.ts`, `characterBridge.svelte.ts`,
  `chatBridge.svelte.ts`, `lorebookBridge.svelte.ts` (debounce timers);
  `src/ts/server/commands.ts` (dispatch fetch).
- L23: `settingsBridge.svelte.ts` (`applyServerBackedSettingsPatch` vs
  `watchServerBackedSettings`; the draft path's `suppressDraftDispatch`
  precedent); trigger surface `src/ts/gui/colorscheme.ts`,
  `DisplaySettings.svelte`.
- L24: `lorebookBridge.svelte.ts` (`dispatchUpdateGlobalLorebook`,
  `restoreLorebookState`/`restoreScopedLorebookState`; the
  `rollbackServerBackedLorebooks` precedent).
- L25: `src/lib/Setting/Pages/PromptSettings.svelte`
  (`queuePromptItemUpdate`), `src/lib/UI/PromptDataItem.svelte`; precedents
  in `scriptDefinitionBridge.svelte.ts` and `settingsBridge.svelte.ts`.
- L26: `chatBridge.svelte.ts` (unused `rollbackServerBackedChatMetadata`),
  `src/ts/chatCommands.ts` (`restoreChatRowMetadata`,
  `dispatchUpdateChatRow`).
- L27: `lorebookBridge.svelte.ts` (`applyLorebookEntryDraftEdit`,
  `queueReplacement`, `currentLorebookCollectionScopedSnapshot`).
- L21: `src/ts/storage/database.svelte.ts` (`runPresetCommand` + callers).
- L34: `src/ts/process/postGeneration/igp.ts`; caller
  `orchestrateResponse.ts` (outside the server-owned gate).
- L35: `src/ts/process/sendChatErrors.ts` (`reportSendChatError`).
- L36: `src/ts/process/files/multisend.ts` (`sendPofile`);
  `DefaultChatScreen.svelte` picker call site.
- L37/I21: `src/ts/bootstrap.ts` (error/rejection handlers),
  `src/ts/alert.ts` (`alertError`).
- I20: `src/ts/process/scripts.ts` (`@@inject` branch).
- Guard: `src/ts/server/projectionWriteGuard.svelte.ts`; persistence
  pattern `src/ts/process/command.ts` (`mutateCurrentChatMessages`).
- v4-L30: `src/ts/translator/presets.ts`
  (`getCurrentTranslatorPresetFromState`), `src/ts/translator/translator.ts`
  (`getCurrentTranslatorPreset` and `getDatabase()`), and
  focused tests in `src/ts/translator/presets.test.ts` and
  `src/ts/translator/translator.cache.test.ts`.
- v4-L33: `src/ts/process/mcp/mcp.ts` (`initializeMCPs` /
  `checkHandshake`), `src/ts/process/mcp/googlesearchclient.ts`, and focused
  MCP tests in `src/ts/process/mcp/mcp.test.ts` and
  `src/ts/process/mcp/googlesearchclient.test.ts`.

## Planned Shape

- The suppression flag is per-bridge module state reset via
  `queueMicrotask` (the existing shape); every new use mirrors it exactly.
- L26's worst case oscillates baseline<->optimistic under sustained
  conflict; the fix must also reset the watcher's previous-snapshot to the
  rolled-back baseline.
- Guard repairs are two-part by definition: wrap (stops the throw) +
  scoped-command persistence (makes it durable). Tests must run with the
  guard ENABLED.
- Before editing guard repairs, inventory the bounded surfaces named in the
  slice. Each live site must be classified as fixed, no-action with reason, or
  deferred with owner; this prevents an enumerated-site-only repair.
- v4-L30 closes only when the translator preset read path no longer writes
  through the read-only projection. Normalize on a clone, or route a durable
  normalization through a trusted write plus scoped command if persistence is
  required.
- v4-L33 closes only when one internal MCP handshake failure is isolated to
  that client/tool set and does not reject all client-side LLM feature
  initialization.
- M8's flush dispatches the pending merged patch exactly once; suppression
  flags and in-flight dedup must hold under the pagehide path.

## Exit Criteria

- [x] M8: a type-then-close within the debounce window persists the last
      edit (keepalive verified); unmount flush covered; no double dispatch.
- [x] L23/L24/L26: theme/color changes dispatch exactly one command; a
      conflicted rollback dispatches nothing; sibling-parity test asserts
      every bridge rollback path sets the suppression flag.
- [x] L25/L27: coalesced edits roll back to the true pre-edit baseline /
      full collection; mid-typing baselines never restored.
- [x] L21: a failed preset command restores `botPresets`/`botPresetsId` and
      the `setPreset` scalars.
- [x] L34/L35/L36 (+I20): each feature works under the enabled guard, its
      write persists across a projection re-stub, and no `TypeError`
      reaches the user; I11's coercion fixed with L34.
- [x] Guard inventory: `DBState.db`, `getDatabase()`, translator preset
      getters, IGP/inlay/file transcript mutation, display/script injection,
      and MCP bootstrap/handshake have live-site dispositions recorded as
      fixed, no-action with reason, or deferred with owner.
- [x] v4-L30: translator preset lookup used by LLM translate does not write
      through the read-only projection; focused proof covers the preset and
      normalization branches.
- [x] v4-L33: partial internal MCP handshake failure is surfaced as an
      unavailable client/tool set and does not reject all LLM feature
      initialization.
- [x] L37 (+I21): null-error events and undefined rejection reasons neither
      throw inside the handlers nor produce useless alerts.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/server/scriptDefinitionBridge.svelte.test.ts \
  src/ts/storage/database.svelte.test.ts \
  src/ts/storage/database.importPreset.test.ts \
  src/ts/translator/presets.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/process/__tests__/igp.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/mcp/googlesearchclient.test.ts \
  src/ts/bootstrap.test.ts \
  src/ts/alert.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
