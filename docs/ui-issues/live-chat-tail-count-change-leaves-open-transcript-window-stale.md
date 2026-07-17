# Live chat tail-count change leaves the open transcript window stale

## Summary

`chatDisplayTailCount` can be edited from the custom sidebar while a chat remains mounted. The setting is optimistically updated, persisted by Fastify, and observed by the chat hydration layer, but `DefaultChatScreen` does not update its mounted `loadPages` render window unless the active chat identity changes.

The result is a split projection: the setting control and hydration logic use the new count while the visible transcript continues to use the old count until the user switches chats or remounts the screen.

## Location

- `src/ts/setting/displaySettingsData.svelte.ts:239-251`
- `src/lib/Setting/Wrappers/SettingNumber.svelte:15-39`
- `src/ts/setting/utils.ts:158-190`
- `src/lib/SideBars/CustomSidebar.svelte:11-42`
- `src/lib/SideBars/Toggles.svelte:269-313`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:173-178,232-245,608-660,629-637,1736-1749`
- `src/lib/ChatScreens/Chats.svelte:35-91`
- `src/ts/server/chatMessageHydration.svelte.ts:481-520,994-1009`
- `src/ts/server/settingsGroups.ts:79`
- `src/ts/server/commands.ts:2043-2061`
- `server/fastify/src/routes/commands.ts:1201-1220,1549-1556,1844-1907`

## Trigger

1. Add `display.chatDisplayTailCount` to the custom sidebar.
2. Open a chat with more messages than the current count, for example 100 messages with the default count of 30.
3. Without leaving the chat, change **Initial Chat Messages to Display** in the sidebar to 10 or 60.
4. Allow the settings command to succeed.

The same stale window can be produced by a cross-tab or plugin-driven settings update while the transcript remains mounted.

## Expected behavior

The visible transcript and its hydration window should use the same tail count. If this setting is intended to apply live, the current chat should safely resize to the new count. If it is deliberately next-open-only, the hydration layer should also retain the old count until the next open and the UI should communicate that deferred behavior. It should not apply the new value to only half of the data flow.

## Actual behavior

The number control and database-shaped settings projection show the new value, and the value is durable. `configuredChatLoadPages` also recomputes. However, the current `loadPages` state remains at the value captured when the chat opened.

Increasing the setting can make the hydration layer request/reside a larger tail that `Chats` still does not render. Decreasing it leaves more message rows mounted than configured, defeating the setting's performance purpose. Switching to another chat or remounting `DefaultChatScreen` copies the new count and makes the transcript suddenly agree.

## Underlying cause

`DefaultChatScreen` initializes `loadPages` from `chatDisplayTailCount` and derives a reactive `configuredChatLoadPages`. Its synchronization effect first compares `activeTranscriptWindowIdentity` with the current character/chat identity and returns immediately when they match. The only normal assignment from `configuredChatLoadPages` is below that return, so a settings-only change cannot update the mounted window.

`Chats` receives the nonreactive-to-configuration `loadPages` state and uses it to calculate `loadStart`/`loadEnd`, so it continues rendering the old number of rows.

Hydration follows a different dependency path. The long-lived hydration effect calls `hydrateActiveChat`, whose synchronous pre-await code reads and normalizes `getDatabase().chatDisplayTailCount`. A setting change therefore retriggers hydration with the new count even though the renderer remains on the old one. This makes the stale UI more than a label/semantics issue: the data-residency and rendered-window consumers actively disagree.

## Affected data flow

1. **UI interaction:** `CustomSidebar` resolves `display.chatDisplayTailCount` through the settings registry and renders `SettingNumber` inside the still-open chat sidebar.
2. **Client state:** `SettingNumber` updates its local value and `setSettingValue` writes the new number optimistically into the settings resource projection.
3. **Client request:** The settings helper resolves the `display` group and sends `PATCH /api/v1/commands/settings/display` with `patch.chatDisplayTailCount`.
4. **Server persistence:** Fastify validates it as an allowed numeric display setting, applies the patch, writes settings to SQLite, emits `settings.updated`, and returns the acknowledged key plus any canonical override.
5. **Acknowledgement/projection:** The setting wrapper continues to show the accepted value and `configuredChatLoadPages` recomputes from the same projection.
6. **Hydration:** `startChatMessageHydration` reacts to the setting read inside `hydrateActiveChat` and ensures the newly configured tail is resident.
7. **Displayed transcript:** The identity-gated effect in `DefaultChatScreen` exits before assigning the recomputed value to `loadPages`; `Chats` therefore calculates its rows from the old count.
8. **Delayed convergence:** A chat identity change invokes the reset path and copies `configuredChatLoadPages`, finally making the display agree with the already-persisted setting.

## Severity and user impact

**Medium.** This does not lose chat data, but it creates a persistent, user-visible disagreement between a successful setting update, hydration/network work, and the mounted transcript. A decreased limit can leave an expensive large DOM mounted; an increased limit can fetch messages that remain hidden. Users may conclude that the setting failed to save until a later chat switch makes it take effect.

## Recommended fix

Track configuration changes separately from transcript identity changes. On an actual `configuredChatLoadPages` change for the current owner:

- for an increase, hydrate the required tail and then update `loadPages` only if the character/chat identity and configuration token are still current;
- for a decrease, update the render window immediately, or defer it only while a screenshot/jump operation owns the window; and
- do not collapse a manual **Load More** or deep-jump expansion on unrelated reactive reruns. Reset it only when the setting itself changed according to the chosen product policy.

Keep screenshot `Infinity`, folded-message expansion, and async jump ownership fenced to the current transcript. If the intended contract is strictly next-open-only, instead stop the hydration effect from reacting to the live setting and make the deferred semantics explicit; either solution must keep hydration and rendering on one count.

## Test coverage gap

`src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts:795-808` verifies only that the configured count is used at initial mount. Add a mounted-screen test that changes the settings projection without changing character/chat identity and verifies both increase and decrease behavior, the corresponding hydration call, and protection against stale async completion after a chat switch. Also cover a prior manual **Load More** expansion so an ordinary rerender cannot collapse it accidentally.
