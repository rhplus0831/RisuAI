# Fix plan: ui-state-feedback

This plan covers only the remaining E-7/E-8 onboarding race and the E-5 product decision about reload-durable drafts. The implementation must preserve these audit invariants throughout:

- An in-flight or durably queued write uses the shared saving icon; do not add per-control `Saving`/`Queued` rows. A failure is persistent inline content with `role="alert"` and also reaches `alertError`.
- Text inputs remain editable while background persistence is pending. A discrete submit/choice button may be locked against duplicate activation. The existing ModuleSettings fieldset lock during an explicit Save is intentional.
- A `contenteditable` descendant must receive its own disabled/read-only handling because `fieldset[disabled]` does not affect it.
- Capture the interaction owner, value, and freshness token synchronously, before a confirm, hydration, IndexedDB operation, or other `await`.
- Lorebook entry drafts are already durable through `applyLorebookEntryDraftEdit`; do not replace or duplicate that path.

## Decisions required (user input)

The user must decide the following before E-5 is implemented. A “no” decision should be recorded as an intentional product boundary and protected with a test where useful; it should not be worked around by silently autosaving authoritative data.

1. **Should chat composer drafts survive reload? Recommended: yes, for the current tab/writer only.** This includes `messageInput`, `messageInputTranslate`, selected asset ids in `fileInput`, `draftText`, and `btwText`. The recommended implementation is bounded browser draft storage, retaining the existing 50-chat LRU behavior. Use `sessionStorage` for reload-only recovery; use `localStorage` only if recovery after closing/reopening the tab is also desired.
2. **Should inline message-edit drafts survive reload? Recommended: no.** Entering Edit currently behaves like a short, cancellable transaction, and a reload reasonably means cancel. If the answer is yes, decide whether both source-message edits and raw-translation edits survive; the implementation below assumes both so the two editor branches do not have surprising differences.
3. **Should ModuleSettings create/edit drafts survive reload? Recommended: yes.** A module draft can contain costly nested lorebook, regex, trigger, code, and asset-reference edits. Because it can be much larger than a composer draft, use a separate encrypted IndexedDB draft store rather than synchronous Web Storage.
4. **Recovery horizon:** unless explicitly changed, make recovery same-database and same-writer-session only. Do not promise cross-device recovery or merge drafts from competing tabs. If cross-device recovery is required, select the server-side draft designs below and accept the schema/API/synchronization work.

Do not implement persistence for an undecided surface. In particular, do not treat “durable outbox” as a harmless default: the existing mutation outbox means “eventually commit this command,” which is not the meaning of an unsaved draft.

## Item E-7/E-8 (onboarding advancement)

### Current behavior and target contract

`src/lib/Others/WelcomeRisu.svelte` already has two useful outcome-aware patterns:

- `persistOnboardingUsername` awaits `updateSelectedPersonaFieldWithOutcome`, stays on step 1 for `failed`, and advances for `accepted` or locally durable `queued`.
- `completeOnboardingSetup` captures the provider/chat choices and a run id, moves to a pending step, awaits the final command, checks freshness after the await, and restores the choice step on failure.

The remaining holes are `selectLanguage`, which calls void `applyServerBackedSetting('language', lang)` and immediately enters step 1, and `send()` case 4, which does the same for the selected provider key and immediately enters step 5.

Use the existing `persistServerBackedSettingsPatchWithSettlement` contract from `src/ts/server/settingsBridge.svelte.ts`, not the void wrapper. It already applies the optimistic setting, stages an encrypted intent before dispatch, returns `accepted | queued | failed`, keeps the global persistence activity active, rolls back a terminal failure, and centrally reports a save failure. Prefer a one-field patch (`{ language: lang }` or the captured provider-key field) over adding another outcome-blind convenience API.

Outcome handling is:

| Outcome | Onboarding action | Feedback |
| --- | --- | --- |
| `accepted` | Advance if the captured attempt is still current. | Shared saving icon only while work is active. |
| `queued` | Advance if current; retain/observe the receipt's final settlement. | Shared saving icon only; no queued toast or status row. |
| `failed` | Stay on the originating step, preserve the user's current input, and enable retry. | Persistent inline `role="alert"`; use the bridge's one-shot `alertError` rather than producing a duplicate alert. |

**Decision for this item:** `queued` advances. It is returned only after local intent is durably staged, so the data-loss race is closed even though the server has not accepted the value. Blocking a first-run wizard on `queued` would strand a legitimate setup when the server is temporarily unreachable. This is a narrow onboarding exception to the usual “do not close an editor on queued” rule: no editor is being committed or discarded, and later setup can continue from the locally recoverable intent. A later terminal replay failure must still be loud.

### Implementation steps

1. In `WelcomeRisu.svelte`, replace the `applyServerBackedSetting` import with `persistServerBackedSettingsPatchWithSettlement` and its receipt/outcome type as needed. Do not alter the final onboarding command or persona helper.
2. Add separate language and API-key pending flags plus monotonically increasing attempt ids. Keep a shared localized onboarding persistence error for a failure row. Clear that error only when a retry begins or the relevant attempt succeeds; do not clear it merely because a reconcile/refresh ran.
3. Convert language selection to an async workflow:
   - Before the first `await`, capture the chosen language, current step, and attempt id; mark the attempt pending. Call `changeLanguage` immediately so the selection remains responsive.
   - Disable/ignore duplicate discrete language choices while that attempt is pending. The browser-language auto-selection must call the same workflow with `void`; an unsupported browser locale still leaves step 0 available.
   - Await the persistence receipt. Apply the result only if the component is mounted and the attempt id, step, and chosen language still match.
   - On `accepted` or `queued`, enter step 1. On immediate `failed`, remain at step 0 and call `changeLanguage(getDatabase().language)` so the rendered language agrees with the bridge's rolled-back settings projection.
4. Convert API-key submission to an async workflow:
   - Validate first, then synchronously capture `provider`, the exact key text, the derived settings field (`openAIKey`, `openrouterKey`, or `claudeAPIKey`), step 4, and an attempt id before awaiting persistence. Never derive the target field from live `provider` after the await.
   - Keep the password input editable, but disable/ignore the Send action while this exact submission is pending and expose `aria-busy`. If the user edits the text while waiting, do not erase it or advance when the older attempt settles; leave step 4 ready to submit the newer text. If it is unchanged, `accepted` or `queued` advances to step 5 and clears it.
   - On `failed`, remain at step 4 and preserve whichever text is currently in the input. Do not render the secret in an error, log, storage key, or test failure.
5. For a `queued` receipt, subscribe to or retain its `settlement` while the component remains mounted. A later `accepted` settlement only clears matching error/retry state. A later `failed` settlement must populate the same persistent inline failure surface if the attempt is still relevant; the bridge supplies the global `alertError`. Do not asynchronously rewind a user who has already moved through later choices. If retry UI is added, keep the failed field/value only in component memory, label the action through `src/lang`, and rerun the same captured one-field workflow. Once onboarding has unmounted, the bridge's central failure alert is the remaining feedback channel.
6. In `onDestroy`, invalidate all attempt ids and unsubscribe queued-settlement listeners. A late result may finish its durable work but must not advance or rewrite an unmounted onboarding UI.
7. Render one failure block near the active onboarding controls with `role="alert"`. Reuse `language.errors.settingsSaveFailed` unless recovery needs a more specific localized string. Do not add `Saving`, `Saved`, or `Queued` text. Do not add an `alertNormal` call for queued language/API settings.

### Tests and acceptance criteria

Extend `src/lib/Others/WelcomeRisu.svelte.test.ts` and adjust its settings-bridge mock to return persistence receipts. Cover all of the following:

- Browser-language auto-selection and a clicked language do not advance before the promise settles; `accepted` and `queued` advance, while `failed` leaves a retryable step 0 and a `role="alert"`.
- A queued language/API attempt produces no queued row/toast. Its later terminal failure sets the mounted failure alert; an accepted final settlement does not.
- API submission captures the provider field and key before the await, ignores duplicate submit, leaves the password input editable, and does not expose its value in feedback.
- Immediate API failure preserves the input and step 4. Success advances only if the input still equals the captured submission; a newer edit is retained on step 4.
- Unmount and stale-attempt tests prove late receipts cannot change steps or errors.
- Existing username and final-setup tests continue to pass unchanged in behavior.

The settings bridge already owns staging, rollback, global saving activity, and central failure alerts; only add bridge tests if implementation changes that public receipt contract. Otherwise focused verification is:

```sh
pnpm test:frontend -- src/lib/Others/WelcomeRisu.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/server/settingsBridge.durable.test.ts
```

## Item E-5 (draft durability, per surface)

### Shared rules for any selected durable surface

A recovery draft is non-authoritative data. It must never be inserted into `pendingMutationOutbox.ts`, counted as an unreplayed mutation, replayed before resource hydration, or allowed to update SQLite without an explicit Save/Send action.

For local recovery, introduce a small versioned draft record containing the database lineage, active writer session id, surface kind, stable owner ids, baseline (or baseline digest plus required merge data), draft payload, per-record sequence, and `updatedAt`. Expose the current draft scope through a read-only runtime initialized from bootstrap metadata; do not reach into the outbox's private `pendingMutationScope`. Reject malformed, wrong-version, wrong-lineage, and wrong-writer records. Put limits on record count and serialized bytes, and provide deterministic cleanup for expired/orphaned records.

Writer and multi-tab rules:

- Capture owner ids, writer scope, payload snapshot, and sequence synchronously at the input/edit event before an async IndexedDB write.
- Writer loss freezes new edits through the existing global latch. Let a local write that was already captured finish so the losing tab can recover its text after refresh; never turn it into a server mutation. Do not clear a local draft merely because this tab lost writer ownership.
- Namespace records by database lineage and writer session so the winning tab does not silently import a losing tab's unsaved work. For a storage implementation shared by contexts, serialize updates with Web Locks where available and keep a same-process fallback; a duplicated same-session tab resolves by record sequence/`updatedAt`, not by overwriting a newer record with an older async completion.
- Local autosave must not disable text fields. Successful local writes are silent. If local recovery storage fails or reaches quota, show one persistent surface-level `role="alert"` and call `alertError`; do not mount per-field saving/queued rows. If async draft activity is connected to save feedback, use only the shared saving icon and avoid making it flicker on every keystroke.
- Clear a recovery record only for an explicit discard, an accepted authoritative save/send that consumes that exact draft generation, or a proven already-applied canonical value. A queued server mutation is not acceptance; retain the recovery record until its final settlement or a later authoritative match. A failed save keeps both the visible and recovery drafts.

If encrypted local storage is chosen, create a separate draft database/store. Low-level encryption/key-envelope and locking code may be extracted and shared with the outbox, but draft rows must not share mutation stores or replay/count APIs.

### Surface 1: DefaultChatScreen composer

Current ownership is `src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts`: a cloned, 50-entry in-memory LRU keyed by `buildTranscriptWindowIdentity`. `DefaultChatScreen.svelte` writes it through `markComposerDraftChanged`/`storeComposerDraft`, restores it on chat identity changes, and deletes it when all five fields are empty or a current send consumes them.

| Design | Reload behavior and cost | Writer/multi-tab behavior | Product trade-off |
| --- | --- | --- | --- |
| Browser storage (`sessionStorage`, or `localStorage` for a longer horizon) | Back the existing map with versioned, per-transcript JSON records. Store text plus asset ids, never asset bytes. Preserve the 50-entry LRU and add byte/age caps. This is the smallest change, but Web Storage is synchronous, quota-limited, and plaintext; per-entry writes must be latency-tested. | `sessionStorage` naturally isolates tabs; either store still needs lineage/writer metadata to survive database replacement safely. A same-writer duplicate uses sequence timestamps and storage events/locks rather than whole-cache last-write-wins. | Best match for reload-only recovery and current semantics. It does not sync across devices. |
| Separate outbox-style encrypted IndexedDB draft store | Persist the same records with AES-GCM and a coalescing write queue. Better quota/privacy and reusable for module drafts, but requires schema/versioning, async ordering, lock, corruption, lifecycle, and test infrastructure. | Scope rows to lineage/writer and complete only synchronously captured writes. Separate Web Locks prevent two contexts from reversing write order. | Safer for sensitive/large drafts but materially more implementation for a small bounded composer payload. |
| Server-side composer draft resource/field | Add a dedicated chat-draft table/resource and revisioned commands; restore after chat hydration and delete atomically when Send accepts. Do not add draft fields to broad chat/message patches. | Active-writer commands and SSE/resource reconciliation define a single remote winner; cross-device conflict/expiry policy is required. | Gives cross-device recovery, but creates per-keystroke traffic/outbox churn, SQLite growth, migrations, cleanup, backup/export decisions, and conflict UI. Not justified for reload-only scope. |

**Recommendation:** if approved, use reload-scoped browser storage first. Keep the current module API (`read/write/delete/clearDefaultChatComposerDraft`) as the only caller boundary, hydrate its map for the current lineage/writer before restoring a transcript, and write/delete through that boundary. Use per-transcript records so one chat edit does not stringify all 50 drafts. Preserve LRU recency across reload, reject corrupt/oversized payloads safely, and keep the plaintext privacy limitation explicit. If plaintext is unacceptable, use the separate encrypted draft store rather than the command outbox.

Composer verification should extend `DefaultChatScreen.composerDrafts.test.ts` and `DefaultChatScreen.loadPages.test.ts`: simulate a new module/runtime (not merely component remount), restore all five fields after reload, preserve chat isolation and LRU eviction, clear only the exact consumed draft, retain a newer draft across an older send result, ignore another lineage/writer, and handle corrupt/quota-failing storage loudly without breaking typing. Include a typing-latency assertion or the existing audit latency probe if synchronous storage is used.

### Surface 2: inline message and translation edit

Current source edits in `src/lib/ChatScreens/Chat.svelte` capture a `MessageEditorTarget` before entering `editMode`, bind the editor to the transient `message` value, and persist only from `saveMessageEdit`. Raw-translation edit text is similarly held in `editTranslationText` until `saveTranslationEdit`. The stable id tuple is character/chat/message plus field kind; array index alone is not a durable identity.

| Design | Reload behavior and cost | Writer/multi-tab behavior | Product trade-off |
| --- | --- | --- | --- |
| Browser storage | Store `{target ids, field kind, baseline text, draft text, updatedAt}`. On restore, enter edit mode only when the same message still exists and its authoritative field equals the baseline; otherwise present a persistent recovered-conflict alert with Copy/Discard rather than overwriting new server text. Payload is small and Web Storage is simple/plaintext. | Scope to lineage/writer. A losing tab retains its own recovery copy but cannot save until it retakes writer ownership. Never merge two message drafts solely by array index. | Makes reload cease to mean cancel and requires explicit recovered/discard UX. |
| Separate outbox-style encrypted IndexedDB draft store | Same record and baseline check, with encrypted async staging. This shares infrastructure if module durability is selected but is otherwise disproportionate for one short text field. | Capture `MessageEditorTarget`, field kind, baseline, and writer scope before the storage await; fence late writes by generation. | Better privacy, more lifecycle and conflict complexity. Still must not auto-commit. |
| Server-side message-edit draft resource/field | Store an uncommitted draft separate from canonical message/translation rows, keyed by stable message id and base revision; explicit Save promotes it. | Supports cross-device editing but needs active-writer conflicts, events, expiry, delete-on-save, and behavior when the message is edited/deleted elsewhere. | Highest cost and risks confusing canonical transcript reads/backups. Avoid adding draft keys to whole-message patches. |

**Recommendation:** deliberately keep this surface transient. Reload-as-cancel is a defensible edit-mode contract, the authoritative message remains recoverable, and persistence introduces conflict/recovery UI out of proportion to the common edit. If durability is approved, use the browser-storage design and first refactor the editor to a dedicated draft variable rather than letting unsaved text masquerade as the canonical bound message. Treat source and translation drafts consistently, reuse `captureMessageEditorTarget`, and clear only after accepted Save or explicit Discard—not on `queued` or `failed`.

If approved, add Chat component tests for source and translation reload restore, stable-id targeting after reorder, baseline mismatch/deletion conflict, explicit discard, accepted/queued/failed save cleanup, popup-editor synchronization, unmount, and writer loss. If rejected, add a focused test that reload/remount discards edit mode and renders the authoritative message, documenting the intentional product boundary.

### Surface 3: ModuleSettings create/edit drafts

`src/lib/Setting/Pages/Module/ModuleSettings.svelte` creates a client id and holds a new module in `tempModule`, or clones both `editBaseline` and `tempModule` for an existing module. `ModuleMenu` receives `draftOnly`, so nested lorebook/regex/trigger edits intentionally remain in that aggregate until explicit Save. `rebaseModuleEditorDraftOntoLatest` already preserves untouched remote fields and carries intentionally changed split collections into Save.

| Design | Reload behavior and cost | Writer/multi-tab behavior | Product trade-off |
| --- | --- | --- | --- |
| Browser Web Storage | Persist editor mode, `tempModule`, `editBaseline`, and timestamp. It is easy to bootstrap, but a module may contain large code, lorebook, regex, trigger, and asset lists; synchronous serialization and typical Web Storage quotas can block typing or fail. Content is plaintext. | Scope to lineage/writer and rebase an edit record onto the latest module after resources load. Whole-record last-write-wins is unsafe across same-session contexts. | Acceptable only with a strict small size cap, which would make durability unreliable exactly for costly drafts. Not recommended. |
| Separate outbox-style encrypted IndexedDB draft store | Persist one or more versioned create/edit records immediately from synchronously captured snapshots. After resource hydration, reopen the latest draft; for edit use `rebaseModuleEditorDraftOntoLatest(storedBaseline, storedDraft, latest)`. Keep explicit Save as the only command. This has moderate/high storage, encryption, ordering, corruption, expiry, and recovery-UI complexity but handles large payloads. | Scope and lock by lineage/writer/module id. Losing-writer rows remain dormant. A missing/deleted target opens recovery Copy/Export/Discard UI instead of creating or overwriting a module implicitly. | Best reload durability without changing explicit-Save semantics or requiring server schema. |
| Server-side module draft table/resource | Store draft and baseline separately from canonical `modules`; explicit Save promotes/rebases and deletes it. This needs SQLite migration/repository/routes/commands/events, size limits, cleanup, backup/export policy, and split-owner conflict rules. | Active-writer enforcement prevents losing-tab writes; cross-device restore is possible but needs ownership/takeover and simultaneous-draft policy. | Appropriate only if cross-device/shared draft recovery is a product requirement. A draft field on the canonical module row is not acceptable because reads and whole-object patches could expose or destroy uncommitted content. |

**Recommendation:** if approved, implement the separate encrypted IndexedDB draft store. Persist `{mode, moduleId/clientId, editBaseline, tempModule, schemaVersion, scope, sequence, updatedAt}`. Restore only after module resources are ready. For edits, rebase onto the current module using the existing editor-specific helper; if the target disappeared, keep the payload recoverable and show a persistent failure/recovery alert rather than silently converting it to Create. For creates, keep the original generated id so repeated reloads do not fork copies.

The recovery record must follow authoritative Save outcomes. The current `createGlobalModule`/`saveGlobalModuleDraft` return `ServerCommandResult | null`, and some durable retained failures can look merely `unavailable`; that is not enough to know when a local recovery record may be deleted. Add outcome-aware variants (or extend the existing APIs) that expose `accepted`, `queued` with final settlement, and `failed`, using the existing durable module dispatch rather than staging a second command. ModuleSettings then:

- closes and deletes the matching recovery generation only on `accepted`;
- stays open, keeps the record, and uses only the shared saving icon on `queued`; it may close later only if final acceptance still matches the captured draft/target;
- stays open on `failed`, retains the user's latest draft, renders the existing inline `role="alert"`, and calls `alertError` once;
- retains the existing explicit-Save fieldset lock, including explicit handling for any `contenteditable` descendants, but never locks fields for background local draft writes.

Extend `ModuleSettings.svelte.test.ts` plus unit tests for the new draft store/outcome helper. Cover create and edit reload, nested collection/code/asset-reference payloads, latest-server rebase, deleted target recovery, stable create id, corrupt/oversized/quota cases, wrong lineage/writer isolation, out-of-order async writes, explicit discard, and accepted/queued/final-failed cleanup. Confirm lorebook's existing durable entry-edit path is untouched outside `draftOnly` mode.

### E-5 acceptance boundary

After the user decisions are applied, every selected surface must survive a real page reload without becoming authoritative before its existing explicit action. Every rejected surface must have its transience documented/tested. No local draft may block bootstrap hydration as if it were an unreplayed command, cross database lineages, leak an API key, or cause a losing writer to overwrite the active writer's projection.

Run focused tests for selected surfaces, then:

```sh
pnpm format:check
pnpm check
pnpm check:server
pnpm test:frontend
```

Add a Fastify browser-smoke reload case only if a selected design depends on true browser storage/bootstrap timing that Vitest cannot faithfully exercise; server tests and migrations are required only if the user selects a server-side draft design.

## Suggested execution order

1. Obtain and record the four E-5 decisions above; do not let draft-storage implementation implicitly make those product choices.
2. Fix and test E-7/E-8 independently in `WelcomeRisu.svelte`, because it can use the existing durable settings receipt and does not depend on draft storage.
3. If any local E-5 durability is approved, define the common scope/record/limits/failure contract first. If module durability is approved, build the separate encrypted IndexedDB store before wiring a surface; otherwise keep the composer implementation to bounded reload-scoped Web Storage.
4. Implement composer recovery next: its existing read/write/delete boundary and tests make it the smallest end-to-end validation of scoping and cleanup.
5. Implement message-edit recovery only if explicitly approved; otherwise land only the intentional-transience regression test/documentation.
6. Implement ModuleSettings recovery last, including outcome-aware module Save cleanup and latest-server rebase. Exercise nested draft-only collections and target deletion before considering it complete.
7. Run focused tests after each item, then the project checks above. Re-audit the final UI against saving-icon-only pending feedback, persistent loud failures, editable text, explicit `contenteditable` locks, and synchronous target capture.
