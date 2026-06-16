# Plugin And Custom UI Writes Audit

Date: 2026-06-16

Status: bad

## Scope

Verified plugin V2/V3 database writes, plugin storage, custom GUI editor,
custom sidebar config/rendering, and popup-editor finalization.

## Result

Some recent plugin fixes work, but this component family still has current
update failures and unsafe persisted shapes.

## Findings

- V3 `sendChat(message)` mutates guarded projection directly at
  `src/ts/plugins/apiV3/v3.svelte.ts:1519` with `chat.message.push(...)`,
  outside `withTrustedServerProjectionWrite` and without a server message
  command. Projection guard tests show raw nested/array writes throw after guard
  enablement.
- Unsupported plugin DB writes are normal: `src/ts/plugins/plugins.svelte.ts:582`
  and `:668` block server-owned resource keys, and tests cover this.
- Plugin storage is normal for ordinary JSON-shaped values: unknown keys route to
  plugin storage and server routes use targeted writes.
- Custom GUI persistence is wired when mounted, but reachability is bad:
  `src/ts/setting/displaySettingsData.svelte.ts:28` offers `customHTML`, while
  the Define Custom GUI action at `:34` requires `theme === 'custom'`.
- Custom sidebar persistence is command-backed, but validation only checks
  `customSidebarItems` is an array in
  `server/fastify/src/routes/commands.ts:1237` and `:6243`. Malformed `setting`
  rows can reach `src/lib/SideBars/CustomSidebar.svelte:22`, which can pass
  `undefined` into `SettingRenderer`.
- Popup editor finalization calls `onInput()` but not `onchange()` at
  `src/lib/UI/GUI/TextAreaInput.svelte:371` and `:386`, while normal textarea
  changes call `onchange()` at `:345`.

## Verification

Targeted suites passed:

- `pnpm exec vitest run src/ts/plugins/plugins.test.ts src/ts/server/commands.test.ts src/lib/Setting/Pages/CustomGUISettingMenu.svelte.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`
- `pnpm exec vitest run src/ts/plugins/apiV3/v3.svelte.test.ts`
- `pnpm exec vitest run src/ts/server/projectionWriteGuard.test.ts`
- `pnpm check`

The V3 sendChat path and custom sidebar/popup risks are not covered by the
passing tests.

## Follow-Up

Route V3 `sendChat(message)` through the server-backed chat append/send path,
fix custom GUI theme reachability, validate/sanitize `customSidebarItems`
deeply, and call `onchange()` when popup editor edits are committed.
