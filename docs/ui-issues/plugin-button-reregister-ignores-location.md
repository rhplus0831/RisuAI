# Plugin V3 registerButton re-registration ignores the requested location

## Summary

`registerButton`'s same-id upsert path replaces the existing entry in whatever
store it currently lives in and returns before the `switch (location)` runs. A
plugin that re-registers a button with a changed `location` (e.g. moving its
button from the floating-action area to the chat menu after a settings change)
gets a success response while the button stays on the old surface.

## Location

- `src/ts/plugins/apiV3/v3.svelte.ts:1471-1545` — `registerButton`; the
  replacement scan at `:1504-1514` searches all three stores
  (`additionalFloatingActionButtons`, `additionalHamburgerMenu`,
  `additionalChatMenu`) by id + owner, replaces in place (`:1510`), and
  returns `{ id }` (`:1512`) before the `switch (location)` at `:1516`.

## Trigger

A plugin calls `registerButton({ id: 'x', location: 'action' }, cb)` and later
`registerButton({ id: 'x', location: 'chat' }, cb2)`.

## Expected behavior

The button appears in the newly requested location (or the API rejects the
move explicitly).

## Actual behavior

The second call replaces the entry inside `additionalFloatingActionButtons`
and never consults `location`; the chat-menu button never appears while the
call reports success. Runtime-inserted UI diverges from what the plugin
believes it rendered.

## Underlying cause

The same-id upsert path (added for the id-collision fix) short-circuits before
the location switch.

## Affected data flow

1. Plugin RPC → `registerButton` → same-id found in a different store →
   in-place replace → `{ id }` returned.
2. The wrong surface keeps the button; the requested surface never gets it.

## Severity and likely user impact

**Low.** Affects only plugins that re-register an existing button id with a
changed location; the callback/name/icon updates do apply.

## Recommended fix

When the existing entry's store differs from the requested location's store,
remove it from the old store and push into the requested one (registering the
matching unload callback for the new store).

## Test gap

A unit test re-registering an id with a different `location`, asserting the
entry moved stores.
