# Plugin theme APIs resolve before Fastify persistence settles

## Summary

The Plugin V3 theme mutation APIs are declared as asynchronous, but their host implementations discard the durable settings promise. A plugin's `await` therefore completes after the optimistic UI write is queued, not after Fastify accepts, rejects, or retains it.

## Location

- `src/ts/plugins/apiV3/risuai.d.ts:1410-1441`
- `src/ts/plugins/apiV3/factory.ts:645-667`
- `src/ts/plugins/apiV3/v3.svelte.ts:77-101,1051-1101,1112-1161`
- `src/ts/server/settingsBridge.svelte.ts:330-344`
- `src/ts/server/commands.ts:2112-2184`
- `server/fastify/src/routes/commands.ts:1844-1907`

Reference inventory: plugin-defined UI, Fastify resource lifecycle, and `SET-04`.

## Trigger

A plugin awaits any persistent theme mutator:

- `risuai.changeColorScheme()`
- `risuai.setColorScheme()`
- `risuai.changeTextTheme()`
- `risuai.setCustomTextTheme()`

This is easiest to observe when the corresponding settings command is delayed or terminally rejected.

## Expected behavior

Because the public API returns `Promise<void>` and the host RPC awaits the host function, the promise should not resolve until the durable operation has reached a defined outcome. A terminal server rejection should reject the plugin call, or the API should return an explicit accepted/queued/failed result.

## Actual behavior

The theme changes immediately in the UI and the plugin promise resolves immediately afterward. Fastify may still reject the settings patch later. The rollback can then restore the old theme after plugin code has already proceeded on the assumption that its awaited change succeeded.

The plugin receives neither the command status nor the later failure. In the retryable case, it also cannot distinguish a server-accepted write from an outbox entry that is merely queued for replay.

## Underlying cause

The iframe RPC implementation correctly executes `result = await fn(...args)`. The problem is that the theme host functions return `void`.

`dispatchPluginApiSettingsPatch()` explicitly uses `void dispatchDurableServerBackedSettingsPatch(...)`, discarding the promise returned by the durable settings bridge. Each theme mutator calls this helper and then returns. `changeColorScheme()` additionally calls another helper that dispatches its own write, but neither durable result is returned to the RPC layer.

## Affected data flow

1. **Plugin/UI interaction:** a plugin invokes a theme mutator and awaits the RPC response.
2. **Client projection:** the host changes `colorScheme`, `colorSchemeName`, `textTheme`, or `customTextTheme` and immediately updates CSS.
3. **Request:** the host stages a durable settings intent and sends `PATCH /api/v1/commands/settings/display` when the command queue reaches it.
4. **Premature acknowledgement:** because the host function returns `undefined`, `factory.ts` sends a successful RPC response before the network request settles.
5. **Server persistence:** Fastify validates and writes the settings patch or returns an error.
6. **Displayed state:** success leaves the optimistic CSS in place; terminal failure later executes a field-scoped rollback and refreshes the CSS, with no error delivered to the already-resolved plugin call.

## Severity and user impact

**Medium-high.** Plugin-authored settings UI can report success and continue dependent work even though persistence later fails. Users can see a theme apply and then revert, while the plugin has no supported way to explain or recover from the failure.

## Recommended fix

- Return the durable promise from the host implementation and await it before replying over RPC.
- Define the API result precisely. A structured `{ status: "accepted" | "queued" | "failed", error? }` result is safer than `Promise<void>` because the durable outbox deliberately treats retryable failure as queued rather than terminal.
- Reject the RPC promise on terminal validation/persistence failure, and retain the existing field-scoped rollback for the visible projection.
- For `changeColorScheme()`, first remove the duplicate dispatch documented in `plugin-color-scheme-change-dispatches-twice.md`, then await the single owner.
- Add delayed-success, terminal-failure, and queued-replay tests through the real iframe RPC bridge.

## Test coverage gap

The current Plugin V3 tests call host API methods synchronously and assert optimistic state/rollback helpers. They do not assert when the iframe-visible promise settles relative to the Fastify command, so a fire-and-forget host implementation satisfies the tests despite violating the observable async contract.
