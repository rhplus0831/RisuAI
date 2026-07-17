# Unprotected workflow dialogs are cancelled by background alerts

## Summary

The shared alert service protects only `ask`, `pluginconfirm`, `input`, and `select` from passive alerts. Several other result-bearing dialogs use the same global store and generic waiter but are omitted from that protected set. A background error, notice, wait, toast, progress update, or cleanup can replace an Add Character, Chat Options, card export, module selection, login, character selection, or Terms of Service dialog. Dismissing or clearing the replacement supplies an empty ownerless result to the hidden caller, silently cancelling its workflow.

## Location

- `src/ts/alert.ts:6-39,71-131,351-440,477-559,561-655`
- `src/lib/Others/AlertComp.svelte:294-325,341-367,490-575,802-1052`
- `src/ts/characters.ts:1362-1408`
- `src/lib/SideBars/SideChatList.svelte:1050-1073,1166-1189`
- `src/ts/process/modules.ts:778-817`
- `src/ts/characterCards.ts:592-620`
- `src/ts/bootstrap.ts:180-217`

## Trigger

A concrete path is:

1. Open the Add Character chooser.
2. Before choosing Realm, import, or create-from-scratch, let any background task call `alertError()`, `alertNormal()`, `alertWait()`, or `alertToast()`.
3. The chooser is replaced by that passive alert.
4. Press OK on the error/notice, or let the toast/operation clear itself.

The same race applies to Chat Options, card export, module selection, and the other omitted result-bearing types. `alertProgress()` and direct progress store writes are even broader because they bypass `setPassiveAlert()` and can replace the four nominally protected dialog types too.

## Expected behavior

Every result-bearing dialog should have an owner and remain active until its own user action settles it. Background status should be deferred, displayed separately, or queued. A passive alert must never manufacture a result for an unrelated workflow.

## Actual behavior

`alertError()` sees `addchar` as an ordinary passive state and immediately replaces it. The error's OK button writes `{ type: "none", msg: "" }`. The `waitAlert()` inside `alertAddCharacter()` accepts that transition without checking dialog type or owner and returns an empty string. `addCharacter()` falls through its default branch, closes the mobile workflow state, and sends no create/import request. The user is never told that the chooser was cancelled.

Chat Options similarly parses the empty message as `NaN` and performs neither fork nor persona binding. Card export converts the malformed result to cancellation. An overwritten TOS prompt resolves false; the bootstrap caller then reloads the page. Other direct dialogs can overwrite one another and share the next ownerless `none` transition.

## Underlying cause

`responseDialogTypes` is used as the sole test for whether `setPassiveAlert()` should defer a background status, but it lists only four of the many APIs that await a user result. The omitted helpers write directly to `alertStoreImported` and then call generic `waitAlert()`.

`waitAlert()` resolves on the next `type === "none"` value, regardless of which dialog produced it. The omitted dialogs have no `dialogOwner`, queue, typed cancellation, or owner-aware resolver. `AlertComp` likewise publishes ownerless results for their buttons. Finally, `alertProgress()`, `alertClear()`, `alertMd()`, and several direct `alertStore.set()` call sites do not consistently pass through the passive-alert guard at all.

This is distinct from `concurrent-input-dialogs-share-one-result.md`: that issue covers multiple `alertInput()` callers sharing one result, whereas this issue is the missing ownership/protection for the other workflow dialog types and their replacement by non-response state.

## Affected data flow

1. **UI interaction:** `addCharacter()` calls `alertAddCharacter()`, which writes `{ type: "addchar" }` and awaits the global store (`characters.ts:1362-1377`; `alert.ts:426-432`).
2. **Competing async state:** A failed request or background task calls a passive alert helper. Since `addchar` is absent from `responseDialogTypes`, `setPassiveAlert()` replaces the shared state instead of deferring it (`alert.ts:81-131,351-489`).
3. **Displayed UI:** `AlertComp` unmounts the chooser and renders the error/notice/progress branch from the new store value (`AlertComp.svelte:341-575,802-870`).
4. **False acknowledgement:** Closing the replacement writes an ownerless `none` value. The chooser's generic waiter consumes the empty message even though no chooser button was pressed (`alert.ts:392-408`).
5. **Client action:** `addCharacter()` treats the empty value as its default/cancel path. Chat Options, module apply, and card export have analogous early-return paths.
6. **Server persistence:** The intended `POST /api/v1/commands/characters`/import, chat fork or persona-binding command, module apply batch, or export never begins. The break occurs before Fastify can validate or acknowledge the user's intended action.
7. **UI reconciliation:** The modal simply disappears. There is no owner record that could restore it after the passive status closes and no failure state associated with the initiating action.

## Severity and user impact

**High for startup/TOS and medium for ordinary workflows.** Background failures can silently cancel common create, fork, bind, apply, and export actions. During Terms of Service handling, the same empty result can force a page reload. Because the replacement alert appears legitimate, users cannot tell that another pending workflow consumed its dismissal.

## Recommended fix

- Put every result-bearing alert type behind one FIFO scheduler with a unique `dialogOwner` and typed resolver.
- Expand ownership beyond a type allowlist; passive alerts should defer whenever any active request owner exists.
- Give Add Character, Chat Options, TOS, card export, module selection, login, and character selection explicit result/cancellation types rather than generic `waitAlert()` strings.
- Route progress, Markdown, direct store writes, and cleanup through an owner-aware presentation API. Background progress can use a separate status channel if it must remain visible.
- Make `AlertComp` capture and return the rendered owner for every result button so stale callbacks cannot settle a later dialog.

## Test coverage gap

`src/ts/alert.test.ts` verifies passive-alert deferral for input/select and queue ownership for confirmation/select, but does not exercise any omitted result-bearing type. Add parameterized tests that open each workflow dialog, inject error/wait/toast/progress, and verify the original dialog remains and its promise is still pending. Add a mounted `AlertComp` integration test for Add Character plus a background error, and a TOS test proving an unrelated alert cannot resolve the acceptance promise.
