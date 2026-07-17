# NanoGPT authoritative updates trigger local dependent-setting resets

## Summary

`BotSettings.svelte` implements NanoGPT field dependencies with unguarded reactive effects. Those effects cannot distinguish a user changing a control from the settings bridge applying an authoritative `providers` resource. A receiving client can therefore replace a newly synchronized provider draft with a local reset even though the underlying authoritative provider remains intact.

The ordinary reachable failure is a model-and-provider update from another client. The receiving client applies both authoritative values, but its model-change reset then clears only the bound provider draft. Per-draft resource-apply suppression prevents that clear from reaching the resource database, leaving the picker on **Auto** while the database, server, and request runtime still use the nonempty provider.

A destructive counter-patch variant is also possible when a raw API client, older client, import, or restore changes a dependency without applying Bot Settings' local reset policy. That is a secondary compatibility path, not the normal current-client subscription-toggle flow.

## Location

- `src/lib/Setting/Pages/BotSettings.svelte:203-211,349-356,1529-1547`
- `src/ts/server/settingsBridge.svelte.ts:137-268,451-486`
- `src/ts/server/settingsGroups.ts:208-213`
- `src/ts/server/resourceInvalidation.ts:272-305,420-430,764-779,992-1004`
- `src/ts/server/resourceState.svelte.ts:728-768`
- `server/fastify/src/routes/commands.ts:1844-1905`
- `server/fastify/src/prompt/chatDispatch.ts:717-730,829-836`

## Trigger

A reachable cross-client path is:

1. Client A keeps Bot Settings mounted on the NanoGPT provider panel. It currently has a saved model, model display name, and provider.
2. With the provider choices already cached or otherwise resolving quickly, Client B chooses a different NanoGPT model and then a nonempty provider before the 250 ms settings debounce expires. The settings bridge coalesces the model, display name, and provider into one `providers` patch.
3. Client A receives the resulting `settings.updated` event and refreshes the authoritative `providers` settings group.

The same code path can run after another authoritative full settings apply while Bot Settings remains mounted.

## Expected behavior

Client A should apply the server's complete providers-group projection exactly. Its model grid and provider picker should display Client B's new model and provider, matching the resource database, Fastify state, and generation runtime. A dependent reset should occur only in response to the local user action for which that reset is intended.

## Actual behavior

After the authoritative model-and-provider projection reaches Client A:

- the model grid shows the new authoritative model;
- the provider picker shows Auto because its bound draft has been cleared;
- `getDatabase().nanogptProvider` and Fastify still contain Client B's nonempty provider;
- server prompt assembly continues sending that hidden provider in the `X-Provider` header.

Navigating away and remounting Bot Settings reconstructs the draft from the database and can make the provider reappear. While the component remains mounted, repeated reads carrying the same provider do not necessarily repair the split state. The user therefore cannot trust the highlighted provider choice to describe actual request routing.

## Underlying cause

The component declares three initialization-latched `$effect` blocks:

- a change to `nanogptUseSubscriptionEndpointDraft.value` clears `nanogptRequestModelDraft` and `nanogptRequestModelNameDraft`;
- a change to either model or subscription mode clears `nanogptProviderDraft`;
- clearing the API key clears all of the related fields.

After the first effect run, every later draft change is treated as a user interaction. There is no resource-apply fence, owner check, or explicit UI-event boundary.

All of these values are independent `createServerBackedSettingDraft` instances in the same `providers` group. When the authoritative group changes both model and provider, both bridge instances temporarily suppress draft dispatch while adopting their server values. The model change triggers the component's provider-reset effect during that same reactive reconciliation. The provider bridge absorbs the resulting `''` assignment as though it were part of its authoritative synchronization: it advances its draft snapshot without writing `''` into the resource database or queuing a command.

The bridge's server snapshot is already the new nonempty provider. On the subsequent draft-only rerun, the server snapshot has not changed again, so the bridge does not restore the now-empty provider draft. This creates two live versions of one setting inside the same component tree.

If an authoritative update changes only a dependency while provider/model values remain unchanged, their bridge instances are not under matching-value suppression and the same effects can instead classify the clears as local edits and persist them. The current Bot Settings subscription checkbox performs its own clears before sending, so this destructive variant requires another valid writer such as a raw/older client or import/restore path.

## Affected data flow

1. **Originating UI:** Client B selects a NanoGPT model in `ModelGrid` and then selects a provider in `NanoGPTProviderPicker`. The model reset clears the previous provider first; the later provider click supplies the desired nonempty value.
2. **Client B projection and request:** the independent model/name/provider setting drafts update Client B's resource projection and coalesce into `PATCH /api/v1/commands/settings/providers`.
3. **Server persistence:** Fastify's generic settings route validates and persists the providers-group patch, acknowledges it, and emits a settings event.
4. **Client A authoritative refresh:** `resourceInvalidation.ts` plans a `providers` settings-group read for the event, fetches it, and applies it inside `withServerResourceApply`. `applySettingsGroupResource` writes both new values into the resource database and advances the projection epoch.
5. **Client A draft synchronization:** the model and provider `createServerBackedSettingDraft` instances copy their respective authoritative values and temporarily enable dispatch suppression.
6. **Erroneous derived reset:** `BotSettings.svelte:349-356` observes the model change and assigns `''` to `nanogptProviderDraft.value` even though this change originated from the server.
7. **Suppressed acknowledgement path:** `settingsBridge.svelte.ts:222-265` sees the empty provider draft while suppression is active, records it as the draft's new dispatch snapshot, and sends no command. The authoritative resource value remains nonempty.
8. **Displayed/runtime state:** `NanoGPTProviderPicker` is bound to the empty draft and highlights Auto. Server prompt assembly reads the nonempty database value and sends it as `X-Provider`, so the displayed choice and actual routing disagree.

## Severity and user impact

**Medium.** A normal cross-client model/provider update leaves the settings UI displaying a different provider from the one actually used for generation. The mismatch is silent and persists for the mounted component, although remounting repairs it and the primary path does not corrupt server data. Compatibility writers that update only a dependency can escalate the same defect into a persisted destructive counter-update.

## Recommended fix

Move the dependent resets out of broad reactive effects and into the explicit local interaction handlers that own them:

- the subscription checkbox handler should clear model/name/provider only when the user changes that checkbox;
- the model selection/manual-input handlers should clear provider only for a local model change;
- the API-key input handler should perform its cascade only for a deliberate local clear.

If shared reactive logic is retained, give it an origin-aware transaction guard that ignores server resource applies and applies a providers-group projection atomically before evaluating local invariants. Avoid independent per-draft suppression as the only protection for a multi-field dependency.

Add a synchronization test that mounts Bot Settings, applies one authoritative `providers` group where model, model name, and provider change together, and asserts that both the resource database and bound controls retain those exact values. A secondary test can apply a dependency-only projection and assert that it never manufactures a counter-patch.
