# MCP module enable command is always rejected

## Summary

The module list renders the global-enable control for stored MCP modules, but the Fastify enable command deliberately excludes MCP records from its module lookup. The client first shows the optimistic enabled state, then rolls it back after the server returns `404`, without showing the failure to the user.

## Location

- `src/lib/Setting/Pages/Module/ModuleSettings.svelte:185-205`
- `src/ts/moduleCommands.ts:663-700,921-931`
- `src/ts/server/commands.ts:4614-4630,5000-5041,5371-5376`
- `server/fastify/src/routes/commands.ts:7245-7274`
- `server/fastify/src/commands/modules.ts:132-137`
- `src/ts/process/modules.ts:648-677,757-760`

## Trigger

Import an MCP server as a module, then click its globe/global-enable button in Module Settings.

## Expected behavior

The MCP module should become globally enabled, remain enabled after reconciliation or reload, and contribute its MCP URL to the active runtime module set.

## Actual behavior

The globe becomes active optimistically, but the server rejects the command as “Module not found.” The optimistic state is rolled back, usually appearing as a brief enable-then-revert. The click handler does not await the result or display the error.

## Underlying cause

`ModuleSettings.svelte` distinguishes MCP rows only for edit/export controls and still renders the generic enable action. The server route calls `requireModuleIndex`, whose predicate is `module.id === moduleId && !module.mcp`; therefore a stored MCP record can never pass the enable command's existence check.

## Affected data flow

1. **UI:** `ModuleSettings.svelte:190-204` calls `setGlobalModuleEnabled` for the MCP row.
2. **Client state:** `moduleCommands.ts:695-700,921-931` immediately adds the ID to `enabledModules` and reloads runtime projections.
3. **Client request:** `moduleCommands.ts:663-692` and `server/commands.ts:4614-4630` send `POST /api/v1/commands/modules/enable`.
4. **Server mutation:** `routes/commands.ts:7259-7271` calls the MCP-excluding lookup in `commands/modules.ts:132-137`; no setting is persisted.
5. **Response:** the route returns `404`; `server/commands.ts:5371-5376,5000-5041` classifies the terminal rejection and runs the rollback.
6. **Display/runtime:** the enabled projection reverts. Since `getModuleMcps` reads only active modules (`process/modules.ts:648-677,757-760`), the imported MCP server is not activated.

## Severity and user impact

**High.** The primary activation control for an imported MCP module cannot succeed. Users see unexplained reversion and cannot reliably use the imported MCP server through this workflow.

## Recommended fix

Use an existence lookup that includes MCP records for enable/disable commands while retaining MCP restrictions only for unsupported edit operations. If MCP records are intentionally not enableable, hide or disable the control and provide the supported activation mechanism. Await the command outcome and display a localized error on rejection.

## Test coverage gap

Add an integration test that imports an MCP record, enables it from the module workflow, verifies `enabledModules` on the server and client after reconciliation, reloads, and confirms `getModuleMcps()` contains its URL. A rejection-path UI test should also assert that an error is shown instead of a silent flicker.
