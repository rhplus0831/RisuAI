# Retained translator-preset updates roll back despite queued replay

## Summary

When a translator-preset field PATCH fails with a retryable transport error,
the durable outbox retains the mutation for replay — but the component's
dispatch wrapper force-runs its rollback anyway. The control visibly reverts
with no feedback; after reconnect the retained row replays, the server applies
the "reverted" edit, and the UI flips forward again on the next refresh. The
same path also surfaces no alert for terminal rejections.

## Location

- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:1411-1419` —
  `dispatchAndSettle` runs `rollback()` on any non-ok result, ignoring the
  transport's `failureRollbackDisposition`.
- `src/ts/server/durableMutationDispatch.ts:141-159` — transient failures mark
  the mutation retained for replay (`failureRollbackDisposition: 'retain'`).
- `src/ts/server/settingsBridge.svelte.ts:1102-1127` — the contrast: the
  settings bridge checks `failureRollbackDisposition === 'retain'` and keeps
  the optimistic value with a queued notice.
- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:356-361` —
  `retainPendingTranslatorPresetUpdateForReplay` exists for the retained case
  but the rollback has already reverted the projection.

## Trigger

Edit a translator preset's prompt, name, or `maxResponse` while the server is
unreachable or returning 5xx.

## Expected behavior

Like every other retained settings write: the optimistic value stays visible,
the queued notice appears, and replay applies the edit later; only a final
discard rolls back.

## Actual behavior

The outbox retains the PATCH, but the component rolls the projection back — the
control visibly reverts with no message. On reconnect the retained row replays
and the server applies the edit the UI just reverted, so the visible value
flips forward again on the next refresh. In the stale window, re-edits race the
replay. Terminal rejections also revert with no alert at all — the
translator-preset analogue of the fixed schema-settings silent-revert issue,
still present on this field-update path.

## Underlying cause

The field-update dispatch path ignores the transport's
`failureRollbackDisposition`, unlike the settings bridge and
deferred-setting machinery it sits beside.

## Affected data flow

1. Edit → optimistic projection + staged outbox row + debounce → dispatch.
2. Transport fails transiently → row retained for replay.
3. `dispatchAndSettle` runs `rollback()` → visible revert, no notice.
4. Reconnect → replay PATCH applies → SSE refresh re-applies the value the UI
   reverted → forward flip.

## Severity and likely user impact

**Medium.** Confidence: high (rollback call verified directly; retained
disposition per the shared transport). Update-appears-then-reverts-then-
reappears on flaky connections, with a window where the UI misrepresents what
will be persisted.

## Recommended fix

Capture `transport.failureRollbackDisposition`; on non-ok with `'retain'`,
skip the rollback, keep the dirty overlay, report queued, and register a
settlement listener that rolls back only on a final `discarded`. Add a failure
reporter for terminal rejections on this path.

## Test gap

A component test with a transport stub returning a retained failure: assert the
projection keeps the edited value and a queued state is reported; then settle
as `discarded` and assert rollback plus an error message.
