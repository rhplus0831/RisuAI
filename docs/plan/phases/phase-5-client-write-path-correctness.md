# Phase 5: Client Write-Path Correctness (Themes 4+5)

Status: pending.

Goal: one invariant pass over the optimistic-write state machine — every
bridge flushes on unload, suppresses its own rollbacks, keeps true first
baselines, and has a rollback at all — plus repair of the features the
read-only projection guard silently broke.

Findings: M8, L21, L23, L24, L25, L26, L27, L34, L35, L36, L37.
Riding informational items: I20 (`@@inject` wrap, same pattern as L34-L36),
I21 (rides L37's handler hardening), I11 (`[object Object]` coercion, fixed
inside L34).

## Planned Slices

Author under `slices/phase-5-client-write-path-correctness/` when starting.

- unload-flush (M8) — a `flushAllPendingBridgePatches()` aggregator over all
  six bridges, invoked from one `pagehide`/`visibilitychange(hidden)`
  handler AND from watcher teardown, dispatching via
  `fetch(..., { keepalive: true })`. Must respect the suppression flags so a
  flush never double-dispatches (interplay with L23-L27).
- rollback-suppression (L23, L24, L26) — wire `suppressRollbackDispatch`
  (the `rollbackServerBackedLorebooks` shape) into:
  `applyServerBackedSettingsPatch` (both the optimistic write and the
  rollback), the global-lorebook direct dispatchers' rollbacks, and the
  chat-row metadata rollback (`restoreChatRowMetadata` through a suppressing
  wrapper).
- first-baselines (L25, L27) — keep the FIRST baseline across coalesced
  same-item prompt-template edits (`existing?.previous ?? previous` shape);
  promote the pending lorebook entry snapshot to a collection snapshot when
  a second entry edit lands in the same debounce window.
- preset-rollback (L21) — add a rollback parameter to `runPresetCommand`
  (signature change + all 8 callers); snapshot `botPresets`/`botPresetsId`
  plus, for `setPreset` callers, the affected scalar settings.
- guard-repairs (L34, L35, L36 + riding I20/I11) — wrap each broken direct
  write in `withTrustedServerProjectionWrite` AND persist via a scoped
  command (wrapping alone is session-transient): the IGP append (fixing the
  `[object Object]` coercion in the same change), the `inlayErrorResponse`
  error bubble, `sendPofile`'s transcript turns, and the `@@inject` display
  write (or operate it on a working clone, since display scripts must not
  persist). Add guard-ENABLED tests — the existing tests run with the guard
  off, which is how these regressed unnoticed.
- error-handler-hardening (L37 + riding I21) — null-safe global `error`
  handler (check `event.target`, not `event.error.target`; skip alerting
  when no usable error exists) and `String(msg)` coercion in `alertError`.
- phase-5-verification-refresh — gates, focused proofs, full validation,
  latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M8, L21, L23-L27, L34-L37 (the verifier corrections name the precise
  trigger paths and the existing suppression/baseline precedents).
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

## Planned Shape

- The suppression flag is per-bridge module state reset via
  `queueMicrotask` (the existing shape); every new use mirrors it exactly.
- L26's worst case oscillates baseline<->optimistic under sustained
  conflict; the fix must also reset the watcher's previous-snapshot to the
  rolled-back baseline.
- Guard repairs are two-part by definition: wrap (stops the throw) +
  scoped-command persistence (makes it durable). Tests must run with the
  guard ENABLED.
- M8's flush dispatches the pending merged patch exactly once; suppression
  flags and in-flight dedup must hold under the pagehide path.

## Exit Criteria

- [ ] M8: a type-then-close within the debounce window persists the last
      edit (keepalive verified); unmount flush covered; no double dispatch.
- [ ] L23/L24/L26: theme/color changes dispatch exactly one command; a
      conflicted rollback dispatches nothing; sibling-parity test asserts
      every bridge rollback path sets the suppression flag.
- [ ] L25/L27: coalesced edits roll back to the true pre-edit baseline /
      full collection; mid-typing baselines never restored.
- [ ] L21: a failed preset command restores `botPresets`/`botPresetsId` and
      the `setPreset` scalars.
- [ ] L34/L35/L36 (+I20): each feature works under the enabled guard, its
      write persists across a projection re-stub, and no `TypeError`
      reaches the user; I11's coercion fixed with L34.
- [ ] L37 (+I21): null-error events and undefined rejection reasons neither
      throw inside the handlers nor produce useless alerts.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
