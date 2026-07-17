# Character editor dirty fences clear on unrelated resource applies

## Summary

The character editor treats any completed server-resource apply as possible acknowledgement of its optimistic draft. If the editor draft equals the live character projection, it clears the field's dirty fence. That equality is not authoritative: the editor itself copied the draft into the live projection before sending the command.

Consequently, an older character acknowledgement or even an unrelated settings/collection acknowledgement can mark a newer character edit clean. A later authoritative character-row refresh can then replace the edit with the server's older value. The profile fields and the character script/trigger editors implement this same unsafe rule independently.

## Location

- `src/lib/SideBars/CharConfig.svelte:148-199,247-353,1185-2315`
- `src/ts/server/characterBridge.svelte.ts:59-166,191-200,246-368`
- `src/ts/server/scriptDefinitionBridge.svelte.ts:201-263,365-426,561-615,733-835`
- `src/ts/server/resourceWriteGuard.svelte.ts:33-45`
- `src/ts/bootstrap.ts:799-807,1406-1426`
- `src/ts/server/resourceState.svelte.ts:2232-2274`
- `src/ts/server/commands.ts:8036-8051,4347-4422`
- `server/fastify/src/routes/commands.ts:4912-4964,7934-8005,8098-8172`

## Trigger

The scalar profile path can be reproduced with the character name:

1. Open Character Settings with name **A**.
2. Change the name to **B** and let its 300 ms debounce dispatch, but delay the response.
3. Change the name again to **C** before the response for **B** arrives. The draft and optimistic live character now both contain **C**, and the newer durable intent is staged.
4. Let the response for **B** arrive. Alternatively, let any already-in-flight settings or collection command finish at this point.
5. Before **C** is acknowledged, force a resource reconciliation that rereads the character row while SQLite still contains **B**, for example after an SSE replay gap or reconnect. That newer authoritative projection replaces the now-clean field even though the staged **C** intent has not settled.

The equivalent sequence applies while editing a field inside a character regex script or trigger: dispatch **B**, edit to **C**, settle **B** or an unrelated resource command, then apply a row projection that still contains **B**.

## Expected behavior

The **C** field must remain dirty until an acknowledgement or authoritative revision is tied to the command that attempted **C**. An older or unrelated acknowledgement must not weaken that fence. A row refresh may merge clean sibling fields, but it must preserve **C** while the corresponding durable mutation is staged or in flight.

## Actual behavior

The acknowledgement does not immediately write **B** over **C**, but it clears **C**'s dirty state indirectly. The next character-row refresh is therefore treated as clean authoritative state and replaces the editor value with **B**.

The command for **C** can still persist successfully afterward. A scalar character-patch local effect only advances the row revision and deliberately does not reapply command fields, so the profile editor can continue to show **B** even when SQLite now contains **C**. Definition acknowledgements also carry no replacement array; after an intervening row projection changes their fence, they require a later reconciliation read. A later refresh may therefore make **C** reappear. If the user continues editing the reverted projection first, a subsequent full profile or definition replacement can instead make the stale value authoritative.

## Underlying cause

`createServerBackedCharacterDraft` records top-level dirty fields and optimistically `Object.assign`s the sanitized draft into the live character. On every change to the process-wide `serverResourceApplyEpoch`, it calls `clearDirtyFieldsMatchingProjection`. That helper deletes a dirty field whenever the draft value equals the current live projection.

The current projection is not a server snapshot. In the normal edit path it equals **C** precisely because the draft just wrote **C** locally. `withServerResourceApply` increments the same global epoch for every successfully applied local effect or resource read, without identifying the resource, character, field, attempt, or value that caused it. Thus equality plus the epoch cannot prove that Fastify accepted **C**.

The script/trigger draft in `CharConfig` repeats the same heuristic. It tracks dirty fields per stable definition-row ID, but on any global resource epoch it calls `clearDirtyScriptDefinitionFieldsMatchingProjection` against `character.customscript` and `character.triggerscript`. Those arrays already contain the editor's optimistic value because `applyCharacterScriptDefinitionDraft` copied it there, so an unrelated apply can clear every changed field.

This conflicts with the acknowledgement design elsewhere in the same flow. `applyCharacterPatchLocalEffect` and `applyCharacterRowMutationLocalEffect` intentionally fence only the accepted revision and leave the live row untouched because it may already contain a newer edit. Wrapping those fence-only effects in `withServerResourceApply` still advances the global epoch, and the draft layers misinterpret that broad signal as value-specific settlement.

## Affected data flow

1. **UI interaction:** Character inputs bind to `characterDraft.value`; character regex and trigger controls bind to `characterScriptsDraft` and `characterTriggersDraft` in `CharConfig`.
2. **Client projection:** The profile draft copies the complete sanitized draft into the selected live character. The definition path copies the edited arrays into `customscript`/`triggerscript`. Both record dirty fields locally.
3. **Queue and request:** The profile watcher stages and debounces `PATCH /characters/:characterId`. Definition edits stage either sparse `PATCH` or absolute `PUT` requests under `/characters/:characterId/scripts` and `/triggers`.
4. **Server persistence:** Fastify validates the payload, patches or replaces the relevant character fields, writes the single character row to SQLite, emits a character-row event, and returns its revision and target ID.
5. **Older/unrelated response:** The client local effect correctly preserves the newer optimistic **C** projection while advancing the acknowledged row/resource revision. `withServerResourceApply` then advances the process-wide epoch.
6. **Incorrect settlement:** The character editor compares its draft with that same optimistic live projection and removes the dirty field because both contain **C**, even though the response acknowledged **B** or another resource entirely.
7. **Authoritative refresh:** A later character-row read applies persisted **B** plus any clean sibling changes. With no dirty fence left, both the live projection and bound editor draft adopt **B**.
8. **Later acknowledgement/display:** A successful scalar **C** response only fences the revision; it does not restore **C** into a projection that was replaced in step 7. A definition response whose projection fence changed falls back to reconciliation rather than carrying the array itself. Different components or a later refresh can therefore show different versions during this interval.

## Severity and user impact

**High.** The race affects nearly every scalar and structured character field exposed by `CharConfig`, plus individual fields inside character regex scripts and triggers. Users can see recent edits revert, cannot tell whether the reverted or edited value is persisted, and can accidentally persist the stale projection by continuing to edit. For scripts and triggers, that can overwrite substantial authored content.

## Recommended fix

Do not use process-wide resource-epoch changes plus projection equality to acknowledge character-editor dirty state.

Give each character owner and dirty field a monotonically increasing attempt token and retain the exact attempted value. Clear a field only when:

- a local effect identifies the same character, attempt, field, and accepted/canonical value; or
- an authoritative character-row projection is known to be at or beyond the revision of that exact attempt and contains its value.

Apply the same contract to definition-row fields. A settings or collection apply must never settle a character draft. While a character patch or definition replacement is staged/in flight, authoritative row merges should reassert those exact pending fields, as the chat metadata bridge already does for pending chat patches. If the server response remains acknowledgement-only, expose attempt settlement to the draft bridge explicitly rather than inferring it from the database-shaped compatibility projection.

## Test coverage gap

The existing character-draft tests cover a directly stale projection and a genuinely matching projection, but they do not distinguish a server-confirmed matching value from the editor's own optimistic value. The script-definition helper tests make the same assumption.

Add integration-style races for both paths:

1. **A -> dispatch B -> edit C -> acknowledge B -> apply authoritative B/D** and assert that **C** remains visible and dirty;
2. edit **C**, settle an unrelated settings command, then apply an older character projection and assert that **C** is preserved; and
3. persist **C** after an intervening row refresh and assert that the bound editor and live projection both finish on **C**, without requiring another read.
