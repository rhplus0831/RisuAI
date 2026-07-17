# Fullscreen setting diverges from the browser's fullscreen state

## Summary

`fullScreen` is modeled as a durable, server-global display setting, but browser fullscreen is a transient state local to one document and controlled by the Fullscreen API. Only a direct checkbox edit calls the browser API. Escape, browser-driven exits, API rejection, reload, and authoritative settings projections do not reconcile the other side.

The checkbox can therefore be checked while the document is not fullscreen, or unchecked while it remains fullscreen. Fastify still persists and acknowledges the boolean, so other clients also display a value that does not describe their own window.

## Location

- Fullscreen setting definition: `src/ts/setting/displaySettingsData.svelte.ts:272-280`
- Checkbox projection and writeback: `src/lib/Setting/Wrappers/SettingCheck.svelte:15-30`
- Optimistic setting write and runtime callback: `src/ts/setting/utils.ts:158-189,262-268`
- Browser side effect: `src/ts/globalApi.svelte.ts:1585-1603`
- Settings group mapping and client command: `src/ts/server/settingsGroups.ts:132`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify validation, storage, and response: `server/fastify/src/routes/commands.ts:1844-1907`
- Resource projection and runtime-effect dispatch: `src/ts/server/resourceState.svelte.ts:685-826`
- Runtime projection hook, which omits fullscreen: `src/ts/bootstrap.ts:132-150`
- Pre-Fastify desktop reconciliation for comparison: `/home/codex/Risuai/src/ts/util.ts:221-230`; `/home/codex/Risuai/src/ts/setting/displaySettingsData.svelte.ts:250-257`

## Trigger

Several independent paths expose the divergence:

1. Check **Fullscreen**, successfully enter browser fullscreen, and press Escape. The document exits but the checkbox and persisted setting remain `true`.
2. Reload or open another client after `fullScreen = true` has been saved. The settings projection and checkbox are `true`, but that document is not fullscreen.
3. While one client is fullscreen, change the setting to `false` in another client. The first client receives and displays `false` but does not call `document.exitFullscreen()`.
4. Check the option where `requestFullscreen()` is rejected, such as a denied/unsupported context or a call without usable transient activation. The optimistic write and server command still succeed, leaving `true` displayed and persisted even though fullscreen was never entered.

## Expected behavior

The displayed control should describe the actual state of the current window/document. A failed fullscreen transition should not be presented as successful, and browser-initiated exit should immediately update the control. If a durable desktop preference is still required, it should be distinct from per-document Web fullscreen state and applied only in an environment that can honor it.

## Actual behavior

The resource boolean and browser state change independently after the initial click:

- `fullscreenchange` is never observed, so Escape and other browser exits do not clear the control or persisted value.
- the promise returned by `requestFullscreen()` or `exitFullscreen()` is neither awaited nor handled by the setting callback, so rejection does not roll back the optimistic setting;
- a settings acknowledgement or authoritative display-group projection updates `fullScreen` and the checkbox but never invokes `toggleFullscreen`; and
- startup hydration does not attempt or validate the stored state.

Because browser fullscreen generally requires transient user activation, simply adding it to the resource projection hook would still make remote and startup `true` projections fail in normal browsers.

## Underlying cause

The migration retained the old server/database ownership of `fullScreen` while changing its implementation from desktop window reconciliation to the browser Fullscreen API.

The data-driven control calls `toggleFullscreen(Boolean(enabled))` only through `item.onChange`, which runs when `setSettingValue` handles a local control write. Server resource application invokes `applySettingsRuntimeProjectionEffects`, but the hook in `bootstrap.ts` handles colors, text theme, GUI size, motion, height, and notifications only. It has no fullscreen effect.

In the opposite direction, `toggleFullscreen` performs a one-shot request/exit based on `document.fullscreenElement`; no listener writes actual browser state back to the local control or server setting. The asynchronous promise is returned to a synchronous `onChange` callback and discarded. Persistence is dispatched independently and can succeed even when the browser operation fails.

More fundamentally, a single SQLite-backed boolean cannot represent multiple clients' per-document fullscreen states. A remote change that is meaningful for one document is not authoritative for another, and a browser cannot honor an unsolicited request to enter fullscreen during hydration.

## Affected data flow

1. **UI interaction:** `SettingCheck` notices a local boolean change and calls `setSettingValue`.
2. **Client projection and side effect:** `setSettingValue` optimistically writes `database.fullScreen`; `item.onChange` calls `toggleFullscreen(enabled)` without observing its result. The checkbox immediately reads the optimistic resource value.
3. **Request:** the deferred setting lane immediately sends `PATCH /api/v1/commands/settings/display` with `patch.fullScreen`.
4. **Server persistence:** Fastify validates the boolean, replaces the setting, writes it to SQLite, emits `settings.updated`, and returns `acknowledgedKeys`.
5. **Acknowledgement:** `applySettingsPatchLocalEffect` confirms/canonicalizes the setting and advances the display-group revision. No fullscreen-specific runtime effect runs.
6. **Browser-driven change:** Escape or another browser action changes `document.fullscreenElement` and fires `fullscreenchange`, but the application has no listener, command, or local projection update for it.
7. **Foreign/startup projection:** later full or display-group resources update the checkbox in every client. The bootstrap runtime hook ignores `fullScreen`, leaving each document's actual state unchanged.

## Severity and user impact

**Medium.** This does not corrupt chat content, but the setting routinely reports a state that is false for the current client. Users must toggle off and on again after Escape or reload, rejected transitions look successful, and different clients can show the same persisted value while their windows are in opposite states. The mismatch is persistent because normal successful acknowledgement reinforces the incorrect checkbox value.

## Recommended fix

For the Fastify web client, make fullscreen a browser-session UI state rather than a server-backed database setting:

- derive it from `document.fullscreenElement`;
- update it from `fullscreenchange` and `fullscreenerror`;
- await the requested transition and show/restore actual state on success or rejection; and
- do not synchronize one document's state to other clients.

If desktop packaging still needs a persistent desired-window preference, split it from Web fullscreen. Keep a desktop-only preference that the desktop window API can reconcile at startup, while the browser control remains session-local and gesture-driven. Migration can ignore or clear the legacy `fullScreen` value for Web sessions so a stored `true` is not displayed as current state.

Add mounted tests for successful entry followed by `fullscreenchange` exit, rejected entry, reload with a legacy stored `true`, and a foreign display-group projection. The existing display-settings test verifies only that the direct callback passes `true` and `false` to the helper; it does not assert persistence/runtime convergence or promise failure handling.
