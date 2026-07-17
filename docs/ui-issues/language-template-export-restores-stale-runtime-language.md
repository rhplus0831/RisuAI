# Language-template export restores a stale runtime language

## Summary

Exporting an existing translation template temporarily switches the module-level runtime language and restores a language code captured before the export's asynchronous dialogs. If an authoritative language update arrives while the export is open, resource reconciliation correctly applies the newer locale, but the export's `finally` block later restores the captured older locale.

The persisted `language` setting and its selector then show the newer value while labels throughout the mounted application use the older language until another language projection or reload repairs them.

## Location

- Translation-template workflow and language setting: `src/ts/setting/languageSettingsData.svelte.ts:20-44,55-78`
- Runtime locale state: `src/lang/index.ts:10-44`
- Generic setting control/write path: `src/lib/Setting/Wrappers/SettingSelect.svelte`; `src/ts/setting/utils.ts:158-189`
- Settings group mapping and client command: `src/ts/server/settingsGroups.ts:174`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907`
- Authoritative and acknowledged language projection: `src/ts/server/resourceState.svelte.ts:685-725,728-826,2701-2703`

## Trigger

1. Client 1 is using English and opens **Download Translation Template**.
2. Leave either the template-type dialog or, after choosing **Continue Translating Language**, the language-selection dialog open.
3. In client 2, change the UI language to Korean. Let Fastify persist it and let the `language` group update reach client 1.
4. Client 1's settings projection becomes `language = "ko"`, and `applyRuntimeLanguage` changes its mounted labels to Korean.
5. Complete the pending selection and allow the export to finish. Cancelling the second dialog also enters `finally` and exposes the stale restore.

## Expected behavior

The export may temporarily read another locale's dictionary, but completion must not overwrite a language change that happened after the export began. Client 1 should remain in Korean, matching the authoritative setting and selector. Ideally, exporting a dictionary should not mutate the application's runtime locale at all.

## Actual behavior

The export completes and unconditionally calls `changeLanguage(activeLanguage)` with the English value captured at entry. Client 1's resource database and language selector remain Korean, but the module-level `language` object becomes English. Mounted components that read that object render English labels until a later language update, reload, or another explicit selection calls `changeLanguage("ko")` again.

No request or acknowledgement represents this final runtime rollback, so the settings synchronization layer has no event from which to repair it.

## Underlying cause

`downloadLanguageTemplate()` snapshots `getDatabase().language` before awaiting either dialog. For an existing translation it then calls `changeLanguage(selectedLanguage)` solely to serialize the exported `language` object. Its `finally` block always restores the entry snapshot.

That snapshot is not guarded by a resource revision, operation token, or comparison with the current setting. `changeLanguage` updates independent module-level runtime state; it does not change `getDatabase().language` and does not dispatch a setting command. Consequently, a valid authoritative update can advance the settings projection and runtime locale during the await, after which the stale `finally` continuation can mutate only the runtime locale back.

The normal server data flow is otherwise correct. Language patches are stored in the `language` group, and full, group, and local-ack projections explicitly call `applyRuntimeLanguage`. The export runs outside that owner/revision machinery and is therefore free to overwrite its newer runtime side effect.

## Affected data flow

1. **Export UI:** `downloadLanguageTemplate` captures client 1's current persisted language, awaits modal selections, temporarily calls `changeLanguage` for the requested template, and awaits `downloadFile`.
2. **Concurrent settings UI:** client 2's schema-driven language selector optimistically writes `database.language` and queues a language-group setting command.
3. **Request:** the client sends `PATCH /api/v1/commands/settings/language` with `patch.language = "ko"`.
4. **Server persistence:** Fastify validates the group patch, writes the settings row, emits `settings.updated`, and returns `acknowledgedKeys` plus any canonical override.
5. **Authoritative projection:** client 1 applies the language-group resource. `applySettingsGroupResource` stores `"ko"`, calls `applyRuntimeLanguage("ko")`, and the selector and application labels agree.
6. **Stale async completion:** the pending export resumes and `finally` calls `changeLanguage("en")`. This changes only `src/lang`'s module-level dictionary.
7. **Displayed state:** the selector continues to derive `"ko"` from the resource database while labels derive from the now-English `language` export, so different parts of the same UI describe different versions of the locale.

## Severity and user impact

**Medium.** The authoritative data remains correct, but most visible application text can contradict the selected and persisted locale. The race is most likely during a cross-tab change while either selection dialog is open, and it persists until another locale application occurs. It can also make subsequent alerts in the same settings session use a language different from the selected value.

## Recommended fix

Do not mutate global runtime locale state to export a template. Resolve the selected language module directly, merge it with the English base in a local object, and serialize that object. This removes both the synchronization race and the visible temporary locale switch.

If the temporary switch must remain, capture an operation token and restore the current authoritative locale, not the entry snapshot. In `finally`, call `changeLanguage(getDatabase().language)` only if the export still owns the temporary runtime change; otherwise leave the newer projection untouched. Ownership is necessary because two overlapping exports can otherwise restore each other's snapshots.

Extend `languageSettingsData.test.ts` with a deferred `alertSelect`: start an English export, apply a Korean settings resource while either selection is pending, resolve or cancel that dialog, and assert both `getResourceDatabase().language` and the runtime `language` dictionary remain Korean. The existing test verifies only the no-concurrency case in which the entry locale should be restored.
