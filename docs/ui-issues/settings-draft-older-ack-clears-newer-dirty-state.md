# Older settings acknowledgement marks a newer draft clean

## Summary

Both shared settings-input draft implementations can mistake a newer optimistic value for an authoritative server projection. When an older settings command is acknowledged after the user has edited the same control again, the acknowledgement correctly avoids writing its older value over the live projection. It still increments a process-wide resource-apply epoch, however, and each draft helper treats “epoch changed and projection equals draft” as confirmation of the newer edit.

The newer edit is therefore marked clean before its own command is acknowledged. If an authoritative settings read is applied before that command settles, the control adopts the server's older value and visibly reverts. The newer durable command may subsequently succeed and make the value return again, producing the delayed revert/reappear pattern described in the audit brief.

## Location

- `src/ts/server/settingsBridge.svelte.ts:137-268`
- `src/ts/setting/inputDraft.svelte.ts:30-138`
- `src/ts/server/settingsDraftAcknowledgement.ts:28-88`
- `src/ts/server/resourceState.svelte.ts:771-826`
- `src/ts/server/resourceWriteGuard.svelte.ts:33-45`
- `src/ts/bootstrap.ts:475-500,965-990`
- `src/ts/server/commands.ts:2043-2061,2112-2184,5623-5670`
- `server/fastify/src/routes/commands.ts:1844-1907`

Representative consumers include `src/lib/Setting/Pages/OtherBotSettings.svelte:55-99,640-671,1282-1297` and the `SettingRenderer` text, textarea, number, and slider wrappers through `src/ts/setting/inputDraft.svelte.ts`.

## Trigger

Using the WebUI URL field as a concrete example:

1. Open Media Settings, select Stable Diffusion WebUI, and change the URL from value **A** to **B**.
2. Let the 250 ms draft debounce dispatch **B**, but delay its response.
3. Before that response arrives, edit the URL again to **C**. The input and settings resource projection now both show **C**, and a second durable intent is staged.
4. Allow the server response for **B** to arrive.
5. Before **C** is acknowledged, cause an authoritative read of the `media` settings group, for example through another-tab activity or command reconciliation that cannot apply a contiguous local effect.

The same sequence applies to direct `createServerBackedSettingDraft` consumers and continuous schema-driven controls backed by `createSettingInputDraft`.

## Expected behavior

The draft must remain dirty until an acknowledgement identifies the same owner and the same attempted value, or until an authoritative projection can be tied to that exact edit. An older command acknowledgement must not weaken the fence around a newer local edit. An intervening group refresh should either preserve **C** or rebase the pending intent without replacing the input.

## Actual behavior

The **B** response does not immediately replace **C**, but it marks the **C** draft clean indirectly. The next authoritative group projection replaces the input with **B** or another server value. If the command for **C** later succeeds, reconciliation/refetch can make **C** appear again; until then, the displayed value disagrees with the user's latest edit and potentially with the staged durable intent.

This race can affect multiple simultaneously mounted views of the same setting differently: a draft control may temporarily show the refreshed value while another projection or runtime consumer still observes the optimistic or eventually persisted value.

## Underlying cause

The owner-aware acknowledgement path is sound but is bypassed by a broader heuristic:

- `appliedLocalEffectAcknowledgesSettingDraft` requires the local effect's owner and attempted value to match the current dirty draft. It correctly rejects the **B** receipt once the draft contains **C**.
- `applySettingsPatchLocalEffect` canonicalizes a field only if its live value still equals that command's attempted value. Since the live value is **C**, the **B** response correctly skips writing **B**.
- The local effect is wrapped in `withServerResourceApply`, which increments one global `serverResourceApplyEpoch` after every successful resource apply, even when this particular setting field was deliberately skipped.
- `createServerBackedSettingDraft` clears `dirty` at lines 177-180 whenever that global epoch changed and the current resource value equals the draft.
- `createSettingInputDraft` has the same rule at lines 64-68.

At that point the current resource value equals **C** only because the draft wrote **C** optimistically. The equality does not prove that the server acknowledged **C**. The broad epoch also does not identify the resource, setting group, owner, command, or attempted value that caused it.

Once `dirty` is cleared, the next differing server projection takes the normal clean-control branch and replaces the draft. If that projection advanced the settings-group epoch, the eventual **C** receipt can no longer use its captured optimistic epoch and must fall back to authoritative invalidation/reconciliation, extending the visible reversion.

## Affected data flow

1. **UI interaction:** `OtherBotSettings.svelte:666` binds the WebUI URL input to `webUiUrlDraft.value`. Schema-driven continuous inputs bind through `createSettingInputDraft` in the renderer wrappers.
2. **Client projection:** the draft effect writes the new value into the settings resource facade under a trusted write and records a dirty owner. **C** replaces **B** locally without waiting for the server.
3. **Queue and request:** `queueSettingsPatch` stages the encrypted durable intent and, after the debounce, `patchServerBackedSettings` sends `PATCH /api/v1/commands/settings/media` with `patch.webUiUrl`. Commands for **B** and **C** are serialized, but **C** can be visible while **B** is still in flight.
4. **Server persistence:** `routes/commands.ts:1844-1907` validates the `media` patch, applies it to the database, writes the settings row, emits `settings.updated`, and returns `acknowledgedKeys` plus only canonical overrides.
5. **Older response:** `readSettingsPatchLocalEffect` reconstructs **B** as the canonical patch. `applySettingsPatchLocalEffect` sees live **C** rather than attempted **B**, so it leaves the field untouched while advancing the acknowledged revision.
6. **Incorrect draft settlement:** `withServerResourceApply` increments the global apply epoch. The owner-aware listener refuses to settle **C** from the **B** effect, but the next draft synchronization effect clears `dirty` merely because the optimistic resource value and draft both equal **C**.
7. **Displayed state:** a later authoritative `media` group apply writes the server value into the resource facade. Because the draft is now considered clean, its synchronization effect copies that value into the bound input, causing the visible reversion. Later reconciliation of **C** may change it again.

## Severity and user impact

**High.** The faulty condition is in both shared draft abstractions and therefore affects a wide set of model/provider, media, memory, display, sidebar, and advanced settings. Users who edit a field faster than command round trips can see their latest value revert and later return. During that interval they cannot tell which value is persisted, pending, or actually used by runtime consumers, and another edit made against the reverted display can unintentionally replace the still-pending value.

## Recommended fix

Remove projection equality plus the process-wide apply epoch as an acknowledgement mechanism for dirty drafts. Settle dirty state only from a value-specific receipt or a resource apply carrying enough provenance to prove that it includes the draft's own command.

A practical fix is to give each dirty draft an owner-scoped monotonically increasing attempt token and retain the exact attempted root/path value. Clear it only when:

- `appliedLocalEffectAcknowledgesSettingDraft` matches that owner, attempt, and canonical value; or
- an authoritative settings-group projection is known to be at or beyond the revision of that exact attempt and contains its canonical value.

If generic projection adoption is still needed, use a settings-group/owner revision fence rather than `serverResourceApplyEpoch`, and never infer acknowledgement from a live value that may be the draft's own optimistic write. Apply the same contract to both draft helpers so schema-driven and hand-written settings controls cannot diverge.

Add a regression test for each helper with **A → dispatch B → edit C → acknowledge B → apply authoritative B/D**. Assert that **C** remains visible and dirty until the **C** acknowledgement, then test both verbatim and server-normalized canonical **C** responses. The current older-receipt test covers a differing resource value, but not the ambiguous case where the live resource already equals the newer optimistic draft.
