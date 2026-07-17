# Plugin provider selection can skip persistence after an authoritative update

## Summary

The legacy Bot Settings plugin-provider selector can display a user selection without updating the browser resource projection or Fastify. This occurs when the authoritative provider changes while the page is mounted and the user then selects the provider that was active before that change.

## Location

- Local draft and synchronization effects: `src/lib/Setting/Pages/BotSettings.svelte:243,287-328`
- Provider selector: `src/lib/Setting/Pages/BotSettings.svelte:1619-1626`
- Client mutation wrapper: `src/ts/pluginCommands.ts:563-587`
- Client command and acknowledgement parser: `src/ts/server/commands.ts:4753-4765,6982-6997`
- Server persistence route: `server/fastify/src/routes/commands.ts:7543-7575`
- Client local-effect projection fence: `src/ts/server/resourceState.svelte.ts:884-904`

## Trigger

1. Open legacy Bot Settings while plugin provider `A` is selected.
2. An authoritative resource update, such as an SSE refresh caused by another tab, changes the provider to `B`.
3. The mounted selector updates to `B`.
4. Select `A` again.

## Expected behavior

Selecting `A` should optimistically update the resource projection, dispatch the provider-selection command, persist `A` in SQLite, and reconcile the displayed selector with the acknowledgement.

## Actual behavior

The selector changes to `A`, but no command is dispatched. The browser resource projection and server remain at `B`; a remount or refresh changes the selector back to `B`.

## Underlying cause

The resource-to-draft effect copies an authoritative provider into `currentPluginProviderDraft` under dispatch suppression at `src/lib/Setting/Pages/BotSettings.svelte:291-300`. However, it advances `previousPluginProvider` only during initialization or when `restorePluginState()` changes the separate suppression version at `src/lib/Setting/Pages/BotSettings.svelte:302-306` and `src/ts/pluginCommands.ts:191-202`.

A normal resource projection from `A` to `B` therefore leaves `previousPluginProvider` at `A`. When the user selects `A`, the draft-to-server effect exits at `src/lib/Setting/Pages/BotSettings.svelte:316-317` because the new draft equals that stale baseline.

## Affected data flow

### UI

`SelectInput` is bound to the component-only `currentPluginProviderDraft` at `src/lib/Setting/Pages/BotSettings.svelte:1621-1626`. It can therefore display `A` even when the resource database still contains `B`.

### Client request

The normal path performs a trusted optimistic resource write and calls `dispatchSelectPluginProvider` at `src/lib/Setting/Pages/BotSettings.svelte:318-327`. That wrapper stages a durable `POST /plugins/provider` intent and calls `selectPluginProviderCommand` at `src/ts/pluginCommands.ts:563-587`. In the failing path, the stale-baseline early return skips all of this work.

### Server persistence

When called, `POST /api/v1/commands/plugins/provider` sets `currentPluginProvider`, writes the settings row, and emits `plugin.provider.selected` at `server/fastify/src/routes/commands.ts:7543-7565`. The failing interaction never reaches this route.

### Response

The intended response returns the revision, event, and selected provider at `server/fastify/src/routes/commands.ts:7568-7572`. The client validates that acknowledgement at `src/ts/server/commands.ts:6982-6997` and advances the provider revision fence at `src/ts/server/resourceState.svelte.ts:884-904`. No acknowledgement exists for the skipped interaction.

### Display

Because the selector renders the local draft rather than the authoritative resource value, the failed no-op is not visible until a later resource synchronization or remount restores `B`.

## Severity and user impact

**Medium-high.** The setting controls which plugin-backed model provider is used. The UI can claim that a provider is selected while generation continues to use another provider, and the apparent selection is lost on refresh.

## Recommended fix

Advance the comparison baseline whenever an authoritative provider value is accepted into the local draft, while preserving explicit ownership of in-flight local selections. A stronger fix is to replace the bespoke two-effect mirror with an owner-aware draft abstraction that retains the plugin mutation lane and `dispatchSelectPluginProvider` semantics.

Do not fix this by merely removing the equality guard; that would turn every authoritative resource projection into a redundant mutation.

## Test coverage gap

The server test at `server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts:331-345` proves that the provider route persists the value, but there is no mounted selector synchronization test. `src/lib/Setting/Pages/BotSettings.pendingFlush.svelte.test.ts:180-187` mocks the provider helpers without exercising this interaction.

Add a component test that mounts with `A`, applies an authoritative projection to `B`, selects `A`, and asserts one provider command plus convergence of the selector and resource projection on `A`.
