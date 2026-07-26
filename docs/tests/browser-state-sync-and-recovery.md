# Browser State Sync and Recovery

This area covers browser startup, active-writer ownership, encrypted durable mutation recovery, command
serialization, compact local acknowledgements, authoritative resource reads, hash-cache validation,
event invalidation, complete refresh, and lazy body hydration. Domain-specific optimistic editing is
assessed in [Domain Mutations and Editing Bridges](domain-mutations-and-editing-bridges.md). Provider and
media operations are assessed in [Providers, Models, and Media](providers-models-and-media.md), while
backend revisions/receipts are assessed in
[Persistence, Revisioned Commands, and Events](persistence-commands-and-events.md). Asset, restore, and
destructive import behavior is assessed in
[Assets, Import/Export, and Backups](assets-import-export-and-backups.md); rendered hydration, selection,
and rollback behavior belongs in [App Navigation and Chat](app-navigation-and-chat.md) and
[Shared UI, Feedback, and Accessibility](shared-ui-feedback-and-accessibility.md).

## Assessment

This is one of the suite's strongest and most important areas. Tests repeatedly enforce the core safety
rule: an accepted revision is either acknowledged against the exact, still-current
optimistic projection or reconciled through an authoritative read. They also cover unsent mutations
through persistence, response loss, dependency ordering, writer changes, and terminal rejection.

Assertion quality is high. Most cases verify request headers and bodies, retained IndexedDB rows,
revision cursors, resource values, projection epochs, and whether a fallback read did or did not occur.
The largest limitation is layer realism: most browser tests use happy-dom, mocked fetch and subsystem
seams, fake IndexedDB, and fake timers. They do not prove a complete crash/reload journey across a real
browser, Web Locks, Fastify, SQLite receipts, SSE replay, and rendered state.

## Test groups

| Logical group                                               | Relevant test locations and included cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Behavior and regression importance                                                                                                                                                                | Effectiveness and value                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Writer identity and runtime bootstrap                       | `src/ts/server/activeWriterSession.test.ts`: generated session reuse after reload, invalid stored IDs, unavailable `sessionStorage`, and one-time notification/reload after terminal predecessor rollback loss. `src/ts/server/bootstrap.test.ts`: authenticated writer bootstrap, read-only bootstrap, malformed job filtering, HTTP/network errors, and initialized/non-negative revision validation.                                                                                                                                                                                                                                                                                                                                                                                                | Protects the first ownership and revision decisions made by every tab. Incorrect behavior can orphan local work or let a stale writer mutate state.                                               | **Strong adapter coverage.** Headers, revision caching, validation, and recovery effects are asserted. It does not model two real tabs or durable writer ownership across a server restart.                                                                                                                                                                  |
| Encrypted outbox and durable route policy                   | `src/ts/server/pendingMutationOutbox.test.ts`: non-route cases cover unreadable-row counting, encrypted-at-rest persistence, exact generation replacement, dispatch races, predecessor/dependency closure, receipt-cleanup rows, lineage quarantine/adoption, projection fences/history compaction, old-scope races, no-op deletion, and invalid base/path rejection. Parameterized matrices add 113 accepted command routes and 64 near-miss routes.                                                                                                                                                                                                                                                                                                                                                 | This is the primary browser-side protection against losing unsent edits or replaying them against the wrong owner or database lineage.                                                            | **Critical and broad.** It directly inspects raw IndexedDB records and proves plaintext payloads are absent. Fake IndexedDB/Web Crypto cannot reproduce quota, transaction-abort, key-loss, upgrade interruption, or real multi-tab Web Locks failures. The hand-maintained route matrix is exhaustive but implementation-coupled.                                        |
| Durable dispatch and replay                                 | `durableMutationDispatch.test.ts`: persist-before-send, duplicate same-ID locking, transient retention/terminal discard, shared failures, unavailable-storage fallback, durable receipt ACK cleanup, predecessor replay/deduplication, transitive semantic lanes, prompt owner/row/delete order, terminal-predecessor reload, prepared placeholder replacement, remote-marker races, and retained successor behavior. `durableMutationTerminalRejection.test.ts` covers live 400, retryable-with/without staging, lock rejection, replay 404, and invalid predecessor plus deferred delete. `pendingMutationReplay.test.ts` covers serial replay, ownership discard, same-key blocking, owner repair, retained dependencies, and terminal predecessor release.                                    | Prevents duplicate side effects, overtaken writes, and late requests after reload. Prompt owner/row and delete ordering are especially important data-loss protections.                           | **Exceptionally valuable.** Exact send order, retained rows, projections, and rollback disposition are asserted. Live dispatch, wrapper outcome, and bootstrap replay overlap intentionally at different layers. A real browser kill/reload test is still missing.                                                                                           |
| Command transport, global queue, and local acknowledgements | `src/ts/server/commands.test.ts`: runtime/grouped/sparse settings; malformed 2xx receipts; global revision queue; stable mutation IDs, retries, lineage, and receipt ACK; atomic multi-step sequences; direct translation event scope; every preset/profile/Agent Preset/prompt/persona/translator/loadout/character/chat/message/generation-settings/lorebook/definition/module/plugin/storage adapter; strict compact local-effect validation; destructive-refresh fences; and five command-factory rejection cases.                                                                                                                                                                                                                                                                                   | This is the browser's single mutation transport boundary. Regressions can duplicate a command, use a stale base revision, release events out of order, or incorrectly skip an authoritative read. | **Critical, strongly asserted.** Cases check exact URL/method/body/headers, reconciliation timing, canonical values, rollback, and no-read fast paths. At many lines it repeats substantial setup and is closely coupled to receipt internals. Domain helper tests complement it: this file protects transport/certificates; they protect optimistic state. |
| Browser startup and response/SSE reconciliation             | `src/ts/bootstrap.test.ts`: retry and initialization races; outbox drain gates; plugin/push/display startup hooks; prompt-owner hydration; targeted events and direct-event deduplication; local acknowledgements for settings, plugins, modules, preset families, personas, Agent Presets, translator presets, prompt items, lorebooks, loadouts, definitions, messages, chats, and characters; revision gaps, full refresh, memory events, shutdown, reconnect, and global errors.                                                                                                                                                                                                                                                                                                                     | Protects the end-to-end browser state machine after bootstrap metadata is received. It decides when an optimistic value is trusted and when all or part of state must be reread.                  | **Central and broad.** Assertions cover projection values, cursor advancement, hydration invalidation, and exact fallback calls. Nearly every collaborator is mocked, so a cross-module wiring mismatch can escape even though each local invariant passes.                                                                                                  |
| Authoritative resource owners and invalidation plans        | `resourceState.svelte.test.ts`: resource composition/facade, seeding, per-slice revisions, shell/body preservation, canonical local effects, taint/epoch fences, and every major mutation family. `resourceInvalidation.test.ts`: common-revision reads, minimal settings/collection/character plans, deletion cascades, legacy body convergence, character/chat/lorebook body reads, generation suffixes, plugin/model overlap, prompt owners, split presets/global lorebooks, and full-refresh/error fallback. `resourceReads.test.ts` validates root/targeted wire responses. `storage/database.resourceState.test.ts` covers compatibility accessors and authoritative replacement.                                                                                                     | Prevents stale responses from overwriting newer resident state and prevents broad reads from erasing hydrated bodies. Narrow invalidation also protects communication cost.                       | **Exceptionally strong state coverage.** Successful and failed siblings, read order, revision floors, identity mismatch, and no-overfetch are asserted. Most checks stop at resource state; only a small subset verifies the rendered result.                                                                                                                |
| Authenticated hash cache and hydration reads                | `resourceCache.test.ts`: reordered and duplicate hashes, whole values, clone isolation, missing/corrupt hits, per-manifest inventory cap, and SHA-256 metadata. `hydrationReads.test.ts`: cached/fallback legacy preset, prompt template, lorebook, chat tail/range/generation suffix/bulk, malformed entries, and server/network errors. `characterShellHydration.test.ts`, `chatMessageHydration.test.ts`, `chatMessageHydration.reactivity.svelte.test.ts`, and `promptTemplateHydration.test.ts` cover deduplication, force/reset, partial/full/bulk bodies, status, minimum revisions, stale owner/selection/row fences, default scaffold isolation, and loading reactivity.                                                                                                   | Protects lazy-loading correctness without treating IndexedDB as offline authority. Message and lorebook stale-read cases prevent highly visible data loss.                                        | **Strong protocol and stale-state assertions.** Missing are the documented global manifest/entry/byte pruning limits, quota and upgrade interruption, real browser storage behavior, and more DOM verification after hydration failure or rollback.                                                                                                          |
| Complete refresh, SSE, write guard, and generic guards      | `resourceRefresh.test.ts`: Realm targeted refresh, gaps, cursor/selection preservation, failure, body reset, and coalescing. `events.test.ts`: auth, command/memory frames, malformed command, HTTP/replay failure, clean close, unsubscribe. `resourceWriteGuard.test.ts`: clone-free guarded writes, stable read-only facade, nested scopes, sibling/body preservation, replacement, and immediate visibility. `staleStateGuards.test.ts`: latest-operation tokens, attempted field/keyed-list rollback, dirty merge, and destructive-refresh epochs. `bridgeFlush.test.ts`, `pendingBridgeFlushRegistry.test.ts`, `settingsDraftAcknowledgement.test.ts`, and `settingsGroups.test.ts` cover lifecycle flush, owner registration, receipt settlement, and group ownership. | Supplies the shared safety primitives used by every editing bridge and recovery path. SSE cursor behavior and destructive-refresh fencing prevent silent divergence after failures.               | **High value with some intentional implementation coupling.** Clone counts and epochs catch real O(corpus) and stale-state regressions but require updates during architectural redesign. Event parsing lacks an explicit arbitrary-byte/UTF-8 fragmentation matrix.                                                                                         |
| Retained projections, replacement ownership, and activity  | `chatRetainedProjection.test.ts` reapplies and precisely releases owner-scoped optimistic overlays. `replacementDatabaseOwnership.test.ts` settles local listeners when another tab removed a shared outbox row and holds replacement events until the initiating operation finishes. `persistenceActivity.svelte.test.ts` tracks in-flight mutations and merges successive operations into one linger window. | Prevents restore/import boundaries and delayed settlement from dropping local work or presenting a false idle state. | **High recovery and observability value.** Exact listener/projection ordering is covered; real two-tab replacement and rendered save-indicator behavior remain cross-layer gaps. |

## Expanded parameterized matrices

The following rows are easy to lose when looking only at source-level `it.each` declarations; the counts
above use runtime-expanded cases.

- `commands.test.ts` classifies HTTP **400** (`invalid-request`), **404** (`not-found`), **401**, **403**,
  **429**, and **500** without treating transient failures as terminal. Invalid Agent Preset metadata
  receipts cover non-boolean `enabled`, out-of-range `maxConcurrency`, and non-canonical `name`.
  Invalid step receipts cover non-boolean `enabled`, invalid phase, duplicate dependencies, invalid model
  selection, out-of-range runtime, duplicate input scopes, invalid output format, invalid destination,
  and a non-canonical failure policy.
- `bootstrap.test.ts` expands raw pending-row counts `1`/`null`; prompt acknowledgement event failures
  (wrong type, resource, group, parent); prompt epoch failures (missing, changed, tainted); preset reorder
  failures (collection/settings epoch or taint, selection mismatch, non-canonical pointer, event resource);
  legacy preset epoch/taint; persona patch and structural collection/settings epoch/taint plus event
  identity; persona create/delete/select/reorder successes; Agent Preset epoch/taint/global-taint/unready
  and reorder identity failures; translator collection/language epoch/taint, global taint, selection,
  collection readiness, and language readiness; prompt owner collection/owner epochs, hydration, taint,
  revision, item and owner identity; and missing/negative/fractional module epochs.
- `resourceInvalidation.test.ts` expands seven malformed Agent Preset events; settings group/full orders;
  provider/models event orders; ten split preset events (`modelPreset` and `promptPreset` created,
  updated, selected, imported, reordered); three deletion cascades (persona/model preset/prompt preset);
  six malformed split-preset events; global lorebook created/updated/entries-replaced, deleted/reordered,
  and malformed cases; plus broad fallbacks (revision gap, missing/unknown settings group,
  state, unknown resource, missing required ID, and preset row without ID).
- `resourceState.svelte.test.ts` expands Agent Preset step rejection when the live result has a missing
  dependency, a sibling output-key collision, or a newly introduced dependency cycle.

The outbox's accepted route cases are grouped by behavior below. Each method/path pair is an individual
parameterized case:

- Presets/profiles: model preset create/update/delete/select/reorder; model profile create/update/delete/
  duplicate/legacy conversion; role profile and runtime-default replacement; prompt preset create/update/
  delete/select/reorder; legacy preset create/update/delete/copy/select/reorder/extract; prompt item
  create/delete/reorder/enable.
- Agent/persona/translator: standalone Agent create/update/delete/duplicate/reorder; Agent Preset
  create/update/delete/duplicate/reorder/default and use create/update/delete/duplicate/reorder; persona create/delete/select/reorder; translator preset create/update/
  delete/select.
- Characters/chats/messages: character create/create-and-select/delete/select; chat create/reorder,
  folder create/reorder/delete, character module reorder, chat update/delete/fork/scriptstate, message
  append/update/delete/truncate/tail/full replacement, and chat generation-settings replacement.
- Modules/plugins/loadouts/settings: module create/update/delete/enable/reorder; plugin create/update/delete/
  enable/provider/reorder; plugin-storage put/delete/bulk; loadout create/delete/favorite/touch; global
  scripts settings patch.
- Definitions/lorebooks: character and module script/trigger replace/patch; global lorebook create/update/
  delete/reorder/select and entry replace/update/delete/reorder; character/chat/module scoped lorebook
  replacement and entry update/delete/reorder.

The 55 denied near-miss cases deliberately exercise wrong verbs, singular/plural mistakes, missing IDs,
and extra path segments across those same families, plus non-durable translation and generation-result
routes. Their value is policy hardening; their weakness is that both accepted and denied lists are
manually mirrored rather than generated from a shared command catalog.

## Especially critical tests

- `src/ts/bootstrap.test.ts`, `src/ts/server/commands.test.ts`, and
  `src/ts/server/resourceInvalidation.test.ts` jointly protect the revision-to-projection contract.
- The outbox/dispatch/terminal/replay quartet is the main protection against losing unsent edits or
  duplicating accepted writes after response loss.
- `resourceState.svelte.test.ts`, `chatMessageHydration.test.ts`, and
  `promptTemplateHydration.test.ts` prevent old shells and bodies from erasing hydrated or optimistic
  messages, lorebooks, prompt owners, and character rows.
- The common-revision retry/fail-without-apply cases in `resourceInvalidation.test.ts` prevent mixed-time
  startup projections.
- The destructive-refresh epoch cases ensure an old asynchronous rollback cannot overwrite a restore or
  complete refresh.

## Attention, gaps, and recommendations

1. Add a real-browser crash/reload journey with real IndexedDB and Web Locks: stage an edit, terminate
   between durable write and response, reload/adopt the correct writer, replay exactly once, acknowledge
   the receipt, and verify the rendered value. Add a response-loss and second-tab predecessor variant.
2. Integrate destructive restore/import with retained old-lineage intents and receipt ACKs. Verify no
   cross-lineage replay, correct quarantine/disposal, full refresh, hydration reset, and visible
   selection preservation. Save/restore route details belong in the assets/saves document.
3. Exercise the resource cache's 512-manifest, 32,768-entry, total-byte, and per-value limits, pruning
   order, quota failure, database upgrade interruption, and unreadable rows. Confirm full GET fallback and
   that cached data is never used without authenticated hash confirmation.
4. Parameterize command-event SSE parsing over arbitrary byte chunks, UTF-8 splits, CRLF, comments/
   heartbeats, clean close, and abort during frame delivery.
5. Add rendered optimistic-and-rollback transitions for representative character, message, persona,
   prompt-item, and loadout mutations. The UI documents should own those DOM assertions.
6. Split the large command test by transport, queue/retry, local acknowledgements, and domain adapter
   families. Generate durable route parity from a shared catalog while keeping adversarial near misses.
7. Keep clone-count tests as explicit architectural gates. They protect real large-corpus regressions but
   should not be the only assertion for a user-visible behavior.

## Primary inventory

Every primary file owned by this document is listed exactly once. Cross-cutting domain, provider, asset,
and UI files are discussed in their focused documents.

| Protected area                  | Primary files                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and writer ownership    | `src/ts/bootstrap.test.ts`; `src/ts/server/activeWriterSession.test.ts`; `bootstrap.test.ts`                                                                                                                                                 |
| Durable dispatch and recovery   | `src/ts/server/durableMutationDispatch.test.ts`; `durableMutationTerminalRejection.test.ts`; `pendingMutationOutbox.test.ts`; `pendingMutationReplay.test.ts`                                                                               |
| Command and event transport     | `src/ts/server/commands.test.ts`; `events.test.ts`; `settingsDraftAcknowledgement.test.ts`                                                                                                                                                  |
| Resource state and reads        | `src/ts/server/characterShellHydration.test.ts`; `chatMessageHydration.reactivity.svelte.test.ts`; `chatMessageHydration.test.ts`; `hydrationReads.test.ts`; `promptTemplateHydration.test.ts`; `resourceCache.test.ts`; `resourceReads.test.ts`; `resourceState.svelte.test.ts` |
| Invalidation and refresh        | `src/ts/server/resourceInvalidation.test.ts`; `resourceRefresh.test.ts`; `resourceWriteGuard.test.ts`; `src/ts/storage/database.resourceState.test.ts`                                                                                       |
| Flush and stale-state guards    | `src/ts/server/bridgeFlush.test.ts`; `pendingBridgeFlushRegistry.test.ts`; `settingsGroups.test.ts`; `staleStateGuards.test.ts`                                                                                                             |
| Replacement/retained ownership | `src/ts/server/chatRetainedProjection.test.ts`; `persistenceActivity.svelte.test.ts`; `replacementDatabaseOwnership.test.ts`                                                                                                                |
