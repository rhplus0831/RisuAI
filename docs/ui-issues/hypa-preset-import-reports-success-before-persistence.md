# Hypa preset import reports success before persistence

## Summary

The Hypa V3 preset importer shows the generic **Import succeeded** alert immediately after assigning two optimistic setting drafts. At that point its 250 ms settings debounce has not settled and Fastify has not validated, written, or acknowledged either the appended preset collection or its selected index.

If the memory-settings command later fails terminally, the settings bridge correctly removes the failed appended row and restores the selection, but the user has already received a success message. A retry-retained failure can leave the preset visible and reported as imported for an unbounded period before it is actually durable.

There is also an unmount variant with no request at all: the awaited file picker has no component-lifecycle guard. If Media/Memory Settings unmounts before selection resolves, the continuation mutates its detached drafts after their reactive dispatch effects have been destroyed and still announces success.

## Location

- Hypa preset drafts: `src/lib/Setting/Pages/OtherBotSettings.svelte:89-99`
- Import workflow: `src/lib/Setting/Pages/OtherBotSettings.svelte:1442-1473`
- Whole-setting draft debounce: `src/ts/server/settingsBridge.svelte.ts:137-268,451-568`
- Failure reporting and Hypa-specific rollback: `src/ts/server/settingsBridge.svelte.ts:108-116,570-609,1058-1217`
- Client settings command: `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify memory-settings persistence and response: `server/fastify/src/routes/commands.ts:1844-1907`
- Existing rollback coverage: `src/ts/server/settingsBridge.svelte.test.ts:698-857`

## Trigger

1. Open Media/Memory Settings with Hypa V3 enabled.
2. Import a valid Risu Hypa preset JSON file.
3. Delay or terminally reject `PATCH /api/v1/commands/settings/memory` after the row appears, for example through a server/storage failure.

The UI immediately selects the imported row and displays `successImport`. After the debounce/request fails, the bridge displays `settingsSaveFailed` and can remove that row/reselect the prior preset. With a retry-retained failure, the success message is shown while SQLite still lacks the row.

An independent trigger is to open the file picker, close/unmount Settings before choosing the file, and then complete selection. The detached event continuation still shows `successImport`, but no mounted draft effect remains to project or persist the appended row; reopening settings shows that nothing was imported.

## Expected behavior

The importer should distinguish parsing/local staging from durable import. It should show success only after Fastify accepts both the new preset and selected ID, or explicitly show a pending-save state until that happens. A terminal rejection should show only failure and leave/restore a clearly authoritative selection.

## Actual behavior

`alertNormal(language.successImport)` runs in the file handler immediately after assigning `hypaV3PresetsDraft.value` and `hypaV3PresetIdDraft.value`. Those assignments are optimistic. Their reactive dispatch effects and shared 250 ms timer are asynchronous, and the draft API exposes no promise for this caller to await.

The later bridge behavior is internally consistent but contradicts the alert: terminal failure invokes the specialized append rollback, removes the matching imported row while preserving unrelated changes, restores a still-matching selection, and reports a settings-save error. The UI can thus say “success,” then say “save failed,” then make the supposedly imported preset disappear.

If the component unmounted during file selection, the assignments target the old component's draft objects. Svelte has already disposed the `$effect`s inside `createServerBackedSettingDraft`, so those assignments schedule no settings patch. The global alert still reports success even though neither the live settings UI nor Fastify ever sees the import.

## Underlying cause

The workflow was written for frontend-owned synchronous-looking database mutation, where appending to `Database` was treated as completing the import. After persistence moved behind debounced Fastify settings commands, `createServerBackedSettingDraft` retained assignment-style ergonomics but not a per-operation completion result.

The importer interprets an optimistic projection write as durable success. It neither flushes the settings owner nor observes the resulting `ServerCommandResult`. Because collection and selection are separate drafts, it also has no explicit transaction/operation identity tying their acknowledgement to this import.

The async handler also captures component-owned draft objects across `selectSingleFile` without a mounted token or current-owner check. Unlike rename/delete actions in the same component, file import does not verify that its original settings owner still exists before applying the continuation.

## Affected data flow

1. **UI/file interaction:** the import button reads and parses JSON, normalizes it with `createHypaV3Preset`, and appends it to a cloned local array.
2. **Client projection:** it assigns the complete array and the new index to two server-backed drafts. The selected imported preset renders immediately.
3. **Premature display acknowledgement:** the handler calls `alertNormal(successImport)` before either draft's reactive dispatch has completed.
4. **Request:** the settings bridge coalesces the memory-owner values and sends `PATCH /api/v1/commands/settings/memory` with `hypaV3Presets` and `hypaV3PresetId` after the debounce.
5. **Server persistence:** on success Fastify writes settings and also co-writes the `hypaV3Presets` collection table, then returns `acknowledgedKeys`. On rejection it returns an error without that mutation.
6. **Client response:** success settles the drafts through the local effect/resource revision. Terminal failure runs the Hypa append/selection rollback and the bridge's `settingsSaveFailed` reporter; retained failures leave the durable outbox pending.
7. **Displayed state:** the preset may disappear after a prior success alert, or remain visible as “imported” while only an unacknowledged retry intent exists.

In the unmount branch, the normal flow ends after step 3: disposed draft effects cannot enqueue step 4, so steps 4-7 never occur and there is no request, persistence, acknowledgement, or live display update at all.

## Severity and user impact

**Medium-high.** The user receives an explicit false success for imported configuration. They may delete the source file or begin relying on/editing the preset, only to have it disappear after a delayed failure or reload. The later generic save-error message does not identify which earlier import failed.

## Recommended fix

Give Hypa preset import an explicit owner-scoped command that atomically appends a normalized preset and selects its stable ID/index, returning the canonical row and selection. Stage the optimistic projection if desired, but await that command before showing `successImport`; on retained transport failure show a pending-sync state rather than success. After every awaited picker/read, verify a lifecycle/owner token before touching component state or showing an alert. Alternatively, hand the parsed import to a non-component command service whose persistence can intentionally continue after navigation, while suppressing stale-view feedback.

As an incremental fix, extend the settings draft/queue with an operation handle that can flush and await acknowledgement for the exact attempted memory patch. The handle must not resolve from another setting's resource apply or an older receipt. Disable or owner-guard repeated imports while the operation is unresolved, and ensure a later edit to the imported row is rebased rather than incorrectly treated as proof that the original append persisted.

Add a mounted import test with a deferred command: assert no success alert before acknowledgement, then cover accepted, terminal rollback, retained retry, and a second import/edit while the first is pending. Add a deferred file-picker test that unmounts before resolution and asserts no draft mutation, command, or success alert. Existing tests cover cancelled file selection and low-level Hypa rollback, but not the import's success timing or lifecycle ownership.
