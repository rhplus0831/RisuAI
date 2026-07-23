# Fix plan: translation (greeting translation storage)

## Decisions required (user input)

Do not start implementation until these two product decisions are confirmed. The rest of this plan is executable with the recommended defaults and calls out the AUTO-only delta separately.

1. **Storage owner.** Choose one of the three options below. **Recommended: Option A, a normalized character-scoped `greeting_translations` table.** It keeps derived translations out of editable character/chat JSON, shares work across chats, and gives the server a direct lookup for `historytrans`.
2. **AUTO behavior.** Decide whether a greeting is translated only when its Translate button is pressed or whether an eligible greeting is ensured automatically when a character/chat is opened or its `fmIndex` changes. **Recommended for the first slice: manual-only.** AUTO can incur an extra provider call on open (and a second call before the first generated-message translation), needs an open/selection ensure protocol, and needs deduplication with the generated-message done-frame hold.

The recommended implementation below assumes **Option A + manual-only**. If AUTO is selected, implement every item marked **AUTO delta** in the same change; do not approximate it with `ChatBody`/`translateHTML` or another browser executor.

## Storage design options & evaluation

### Option A — normalized server-side store keyed by character, greeting index, and settings hash (recommended)

**Durable shape**

- Add a schema migration (the current schema is v26, so this should be the next contiguous version) and a small store module under `server/fastify/src/translation/`:

  ```sql
  CREATE TABLE greeting_translations (
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    greeting_index INTEGER NOT NULL CHECK (greeting_index >= -1),
    settings_hash TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    translation_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (character_id, greeting_index, settings_hash)
  );
  ```

- `greeting_index = -1` means `character.firstMessage`; `0..n-1` means `character.alternateGreetings[index]`. `translation_json` is a validated `MessageTranslation`/`RawMessageTranslation` and must agree with the row's `source_hash`, `settings_hash`, and `updated_at`.
- A source edit overwrites or deletes the row for that settings hash rather than adding `source_hash` to the primary key. This matches the existing message behavior: the source hash is a freshness fence, not a reason to retain old-source translations forever.
- The character foreign key gives character deletion a cheap cascade. Register the table in fresh-database DDL, the migration runner, protocol table-write instrumentation, and `SQLITE_BACKUP_TABLES` after `characters`/`chats`. Older backups that lack the table should restore it as empty, following the existing optional-table restore behavior.

**Routes and commands**

- Add authenticated `GET /api/v1/characters/:characterId/greeting-translations`. It loads the character plus translator settings/presets, computes the current server `settingsHash`, and returns only source-valid rows for that hash:

  ```ts
  {
    revision,
    characterId,
    settingsHash: string | null,
    translations: Array<{ greetingIndex: number; translation: MessageTranslation }>
  }
  ```

  Disabled or incomplete translation settings return `settingsHash: null` and an empty array rather than making character rendering fail. Add the route to `routeManifest.ts` as an authenticated read and cover route-protection/manifest tests.
- Add `POST /api/v1/commands/characters/:characterId/greetings/:greetingIndex/translate` with `{ baseRevision, jobId }`. Validate `greetingIndex` against the live character; obtain the source on the server, not from the request. Return `{ revision, event, jobId, characterId, greetingIndex, settingsHash, translation }`.
- Implement the command like `runServerMessageTranslation`: detach provider work from request disconnect, register a latest-job token, load settings with translator presets, translate through `translateRawMessageData`, then synchronously rebase on the current revision. Commit only if the character/index still exists, the source text and previous row for the same `(character, index, settingsHash)` still match, and the job token is current. Emit a targeted `character.greetingTranslation.updated` event/resource so another tab refreshes just this character's greeting-translation projection.
- Do not route greeting translation through the durable browser outbox/global mutation queue. Like raw message translation, the provider request can be long-running and its source/prior-row fences are the relevant concurrency contract. It still requires auth, active-writer ownership, a revisioned commit, and immediate response reconciliation.
- For this scope, keep the translation-text pencil editor message-only. Split the current broad UI predicate into “can translate this raw target” and “can edit this persisted translation” so relaxing greeting support does not expose a message-only save path for `idx === -1`. A future greeting editor would need its own source/settings-hash-fenced PATCH command.

**Cache identity and invalidation**

- Extract a pure server helper from `rawMessageTranslation.ts` that resolves translator type, languages, and `settingsHash` without invoking a provider. Both translation creation, the GET route, and `historytrans` lookup must use it; no route/store should invent a second hash.
- The stored key must use the same `translatorSettingsHash` whose pipeline portion comes from `translatorPipelineSignature(resolveTranslatorPipeline(settings))`.
- Preserve the four-site rule: every new translation-affecting pipeline field must be added once to `translatorPipelineSignature`, which must continue to feed (1) the client translator-settings signature, (2) the `translateHTML` memo key, (3) the LLM translation cache key, and (4) the server `translatorSettingsHash`. Add a regression that changes each step field (`prompt`, `maxResponse`, model/profile id, `outputKey`, `enabled`) and observes all four identities change. Source text remains separately fenced by `sourceHash`.
- The browser greeting-projection cache must be keyed/invalidated with the existing client translator-settings signature, not a fifth hand-maintained list. On a signature change, clear the visible greeting translation before fetching the current server projection.

**Generated-message AUTO translation and the done frame**

- With the recommended manual-only choice, generated-message auto-translation remains exactly where it is: the server starts it after generation persistence and holds `done.postGeneration` until the message translation settles or the defer cap wins. While building history, it uses a matching persisted greeting row if one exists; otherwise the greeting is genuinely untranslated. No browser raw-translation fallback is permitted.
- **AUTO delta:** add an idempotent “ensure selected greeting” command invoked on character/chat open and `fmIndex` change. The browser reports the opened `chatId`; the server alone checks `chat.autoTranslate`, treats the greeting as a char-role row (`autoTranslateBotOnly` therefore does not exclude it), honors translator availability and cached-only LLM policy, resolves the selected index, and decides whether provider work is needed.
- **AUTO delta:** deduplicate ensure jobs by `(characterId, greetingIndex, settingsHash, sourceHash)`. If generated-message auto-translation begins while the same ensure is running, make `runServerMessageTranslation` await that shared promise before resolving history. That wait stays inside the existing message-translation promise, so the existing done-frame defer cap covers the combined prerequisite + message translation. If the cap wins, both continue detached and the frame remains the existing message `running` frame; do not add a second terminal `done` frame or a client executor.

**Swipe/edit lifecycle**

- A normal `fmIndex` swipe only changes the chat row and chooses another table key. Cached translations for other greetings remain available and the UI must never apply the old index's late result to the newly displayed index.
- Extend the dedicated alternate-greeting delete/swap transaction in `commands.ts` to remap table rows atomically with the existing all-chat `fmIndex` remap. For a swap, use a safe temporary index or delete/reinsert so composite primary keys cannot collide. For a delete, remove that index and decrement higher alternate indices; never move the `-1` first-message rows.
- For ordinary character PATCHes, compare the live and patched `firstMessage`/`alternateGreetings`: delete first-message rows if `firstMessage` changed, and delete rows for alternate indices whose source changed or disappeared. Preserve equal same-index sources. The special swap/delete route is the only path that preserves translations across positional remaps.
- A provider result that loses a race with a source edit or positional mutation fails its commit but may remain useful only if a later explicit request targets the new key; never silently move an in-flight job.

**`.risu` and backup behavior**

- A separate SQLite table is not included by `loadPersistedWithMessages`, so explicitly make it portable. Materialize source-valid rows into each character block as a namespaced portable array such as:

  ```ts
  greetingTranslations: Array<{
    greetingIndex: number
    settingsHash: string
    translation: MessageTranslation
  }>
  ```

  Do this before all three database payload encoders: ordinary `.risu`, bundle `database.risu`, and local-backup `database.risudat`. Both block and legacy envelopes then carry the same data in `CHARACTER_WITH_CHAT`/character JSON.
- During `.risu`/bundle/local-backup import, reject malformed array entries or nested/row hash disagreement, drop otherwise well-formed entries whose `sourceHash` does not match the imported greeting source, strip the portable field before writing `characters.data_json`, and replace `greeting_translations` in the same `applyImport` transaction. Older saves simply import no greeting rows.
- Add the table to the server-backup restore allowlist. Do not add this user-specific derived cache to PNG/CharX/Realm character-card exchange unless a separate product decision asks for it; the requirement here is whole-database `.risu` portability.

**Architecture fit**

- Best separation of authoritative authored content (`characters`/`chats`) from derived provider output; direct and cheap server lookup for `historytrans`; one translation can serve every chat selecting the same greeting.
- Costs: one migration, explicit resource projection/event wiring, explicit save materialization/import extraction, and positional-index remapping.

### Option B — server-owned translations map inside the character row

**Shape and command**

- Add a canonical character field such as `greetingTranslations: Record<string, Record<string, MessageTranslation>>`, where the first key is `-1`/alternate index and the second is `settingsHash`. Use the same character/index translate command as Option A; the existing character detail read supplies the map, and the command rewrites only the targeted character row after source/prior-value/job fences.
- This needs no SQLite schema migration. `runServerMessageTranslation` reads the selected entry directly from the hydrated character. Source edit and alternate delete/swap logic must invalidate/remap the map in the same character command transactions.

**Whole-object patch risk (audit pattern #5)**

- The map is not rendered in character configuration forms. If it is treated as an ordinary character field, a stale whole-object/draft patch can erase translations written while the form was open.
- Mitigation is mandatory: make the map server-owned and add it to both client and server character patch exclusion/sanitization sets (`CHARACTER_PATCH_EXCLUDED_KEYS` and `EXCLUDED_CHARACTER_PATCH_KEYS`), ensure compatibility diff/snapshot code never sends it, and test that a delayed character-field patch preserves a concurrently written translation. This reduces but does not eliminate the conceptual risk of storing derived cache data in authored JSON.
- Each translation rewrites `characters.data_json`, and the map can grow with greeting count × settings hashes. Apply an explicit bound/GC policy if this option is chosen.

**Cache, AUTO, swipe, and saves**

- Use the exact same shared settings-hash/four-site rule as Option A. A map entry is valid only when both its settings and source hashes match.
- Character scope deduplicates AUTO cost across chats. The same ensure/done-frame behavior described for Option A is required if AUTO is chosen.
- Swipe is a map lookup; the existing alternate-greeting command must remap/delete nested index keys atomically. An ordinary text edit removes affected entries.
- Whole-database `.risu`, bundle, and local-backup exports carry the field automatically in the character block, and import needs validation but no extraction table. Server backups already include it through `characters`. Character-card export should still omit it unless deliberately added to the card extension contract.

**Architecture fit**

- Lowest read/UI complexity and mirrors the fact that greetings are character fields.
- Weaker boundary: provider-derived, settings-specific state becomes part of an editable character object, precisely where unrendered whole-object patches have caused data loss. It also makes every provider result a full character-JSON rewrite. This is why it is not recommended.

### Option C — server-owned translations map inside each chat row

**Shape and command**

- Add a server-owned `Chat.greetingTranslations` map with the same index → settings hash → `MessageTranslation` structure. Use `POST /api/v1/commands/chats/:chatId/greetings/:greetingIndex/translate`; the server resolves the parent character/source and writes only `chats.data_json`. Do not allow generic chat PATCH payloads to write the map; add a dedicated command path and preserve it when merging ordinary chat metadata patches.
- `runServerMessageTranslation` reads from the target chat's map. This aligns ownership with `fmIndex`, which is already per-chat, and the selected chat row is already loaded when the greeting renders.

**Cache, AUTO, swipe, and saves**

- Use the same settings/source hash and four-site rule. AUTO eligibility is naturally chat-scoped, but identical greetings are translated and stored repeatedly for different chats. Fork policy must be explicit: copying the source chat's valid map is safe because translation does not depend on transcript history; a new unrelated chat starts empty.
- Swipe within one chat selects another map key and retains prior indices. Alternate deletion/swap must rewrite every child chat's map alongside every `fmIndex`. A character greeting text edit either rewrites all affected chat rows to prune data or relies on `sourceHash` to ignore stale entries; the former is expensive and the latter leaves dead data.
- The generated-message done-frame integration is per chat. If AUTO is chosen, a message translation should await that chat's matching greeting ensure inside the existing cap, as in Option A.
- `.risu`, bundle, local backup, and server backup carry the map automatically because chat metadata is already embedded under each character during export/import.

**Architecture fit**

- Strong fit with per-chat selection and easy `.risu` behavior, but poor reuse, duplicated provider cost/storage, and expensive character-level source/remap cascades. Translation output depends on the character greeting and translator settings, not on the chat, so chat scope is narrower than the actual identity. Not recommended.

## Recommended design

Choose **Option A** and initially keep greetings **manual-translate-only**.

The translation is derived from `(character greeting source, character translator note, translator pipeline/settings)` and is reusable across every chat that selects that greeting. A normalized character-scoped table represents that identity directly, gives `rawMessageTranslation.ts` a server-local lookup, and avoids putting an unrendered provider cache into character/chat editing pipelines. Its explicit `.risu` adapter is more work than Options B/C, but that work is bounded and testable; it also prevents accidental persistence gaps because export/import/backup support must be named explicitly.

Use one row per settings hash so changing language, translator type, preset steps, or model-profile selection cannot make `historytrans` consume a translation produced by a different pipeline. Use `sourceHash` as the source-edit fence. Keep positional greeting indices for compatibility with current `firstMessage`/`alternateGreetings` and `fmIndex`; do not broaden this fix into a character schema migration to stable greeting objects.

Manual-only is the safer product default: it fixes persistence, bilingual display, reload, swipe reuse, and `historytrans` once the user has translated the greeting, without silently spending provider quota on navigation. AUTO remains a coherent follow-up only if it includes the ensure/dedup/done-frame behavior above.

## Wiring plan (files, functions, routes)

### 1. Shared identity and persistence

- Add `server/fastify/src/translation/greetingTranslationStore.ts` with table creation plus validated get/list/upsert/delete/remap/replace-for-import helpers. Centralize `selectedGreeting(character, chat/index)` so UI routes and message history agree that `-1` is the primary greeting.
- In `server/fastify/src/translation/rawMessageTranslation.ts`, export a no-provider identity helper used by both `translateRawMessageData` and greeting lookups. Keep `translatorPipelineSignature` as the pipeline portion of the hash; do not duplicate its fields.
- In `src/ts/translator/translator.ts`, expose the existing client translator-settings signature (or a serialized accessor for it) so the greeting projection can invalidate from that canonical identity rather than maintaining another field list.
- In `server/fastify/src/db.ts`, add the next migration and fresh-open table creation. In `server/fastify/src/repository.ts`, add the backup allowlist entry and import replacement hook. Record writes for protocol metrics.
- Preserve translator-runtime invariants while touching shared code:
  - keep `src/ts/translator/presets.ts` imports relative and its environment-sensitive imports dynamic, because Fastify imports this browser-shared module;
  - keep per-step model selection on `profileIdOverride`/the existing explicit profile resolver path, never `fallbackProfileId`;
  - do not reintroduce a client raw-translation executor.

### 2. Server command, job lifecycle, and projection read

- Add `server/fastify/src/translation/serverGreetingTranslation.ts`, paralleling `serverMessageTranslation.ts` but targeting a `(characterId, greetingIndex, settingsHash)` row and translating the greeting with no prior history.
- Add a greeting job registry or generalize the current registry with a discriminated target without changing message job semantics. The target must include `characterId` and `greetingIndex`; same-target latest job wins, different indices/settings may run independently. Expose running/recent terminal greeting jobs in bootstrap so reload preserves the spinner/recovery path.
- Register the POST command in `server/fastify/src/routes/commands.ts`. Validate the command envelope but use source/prior-row/job checks rather than holding the initial global revision across provider I/O.
- Register the authenticated GET projection in `server/fastify/src/routes/resourceReads.ts`, its manifest entry in `routeManifest.ts`, and a targeted event in `server/fastify/src/commands/events.ts`. Extend `src/ts/server/resourceInvalidation.ts` to refresh only that character's greeting projection on a foreign event.
- Add browser adapters in `src/ts/server/commands.ts` and a focused `src/ts/server/greetingTranslations.svelte.ts` projection/job module. Keep the translate command outside the serialized durable-mutation lane, matching `translateMessageCommand`; reconcile its returned revision/event immediately.

### 3. Greeting UI and manual Translate path (`idx === -1`)

- In `DefaultChatScreen.svelte`, derive a single captured greeting target from the fully hydrated character and selected chat: `{ characterId, chatId, greetingIndex: chat.fmIndex ?? -1, source }`. Load the character's greeting projection after shell hydration, on character change, and when the existing translator-settings signature changes. Clear stale projection data before a settings-keyed refetch. Pass the matching `MessageTranslation` into the synthetic `Chat idx={-1}` row.
- In `Chat.svelte`, replace message-only `TranslationMessageTarget` assumptions with a discriminated raw target:

  ```ts
  type RawTranslationTarget =
    | { kind: 'message'; chatId: string; messageId: string }
    | { kind: 'greeting'; chatId: string; characterId: string; greetingIndex: number; source: string }
  ```

- Relax `supportsServerRawTranslation()` from `idx >= 0` to “a valid message or greeting target exists” while retaining the configured translator-type checks. This makes the greeting take the `ChatBody allowClientTranslation={false}` branch and permanently removes its legacy client `translateHTML` path.
- Split request/apply/current-target helpers by target kind. For a greeting click, call the new character greeting command, update the greeting projection with the response, and set `translated = true` only if the component still renders the captured character/chat/index/source. A swipe, character switch, source edit, or settings-signature change while the request runs must not decorate the replacement greeting; the valid result may still persist for its captured key.
- Resolve `serverTranslationJob`, `translationInProgress`, terminal recovery, and retry/retranslate controls against the greeting job target when `idx === -1`. Keep translation editing controls gated to message targets.

### 4. Persisted display and bilingual rendering

- Make `activeRawTranslation()` return the source-valid greeting projection for a greeting target and the existing message translation for a message target. The existing `displayMessage` branch then handles both translated-only and bilingual display.
- Reuse `bilingualInterleave(message, translation.text, { emphasize, sentenceBreaks })`; do not create a greeting-specific renderer. Verify `bilingualDisplay`, both `bilingualEmphasis` values, paragraph sentence breaks, raw/media-only blocks, and the source-only fallback.
- Match existing message-display semantics on open/remount: if chat auto-display is eligible and a persisted projection exists, show it immediately; otherwise keep showing source until Translate is clicked, and let that click reveal the cached row without another provider call. On `fmIndex` change, reset local translated/edit/job state before resolving the new key. A missing/currently invalid row displays the source and offers Translate.

### 5. `historytrans` resolution

- Replace `RawMessageTranslationHistoryContext.greeting: string` with a structured greeting entry carrying source plus an optional persisted translation (or equivalent separate fields). In `runServerMessageTranslation`, resolve the chat-selected greeting index, compute the same current settings hash, and fetch the source-valid table row before calling `translateRawMessageData`.
- In `createTranslatorHistoryResolver`, add the greeting with both `source` and stored `translated` text. Remove/rename the test and code path that intentionally constructs the greeting as source-only. Keep source and translated blocks aligned and include both in the shared token budget.
- Preserve existing boundaries: disabled/comment filtering is unchanged; `disabled === 'allBefore'` must still prevent greeting restoration; a genuinely missing/stale greeting translation may still yield the aligned empty translated block in manual-only mode. The fixed case is that a persisted matching greeting must never be rendered through `entry.translated ?? ''` as empty.

### 6. Source/index lifecycle and portable saves

- Hook first-message/alternate-greeting invalidation and dedicated swap/delete remapping into the same command transactions that change those sources. Add table helpers rather than open-coded SQL in routes.
- Extend `exportSnapshot.ts` and all callers in `routes/save.ts` so ordinary `.risu`, bundle, and local-backup database payloads receive the same source-valid portable arrays. Extend `importSnapshot.ts`/`repository.applyImport` to validate, extract, strip, and atomically restore them.
- Keep portable rows out of editable character `data_json` and browser character PATCHes. This is both the Option A boundary and the mitigation for audit pattern #5.

### 7. AUTO delta only if decision 2 selects AUTO

- Add the idempotent open/selection ensure command and call it after character row + chat metadata hydration, not from `ChatBody` parsing. Trigger on character/chat open and `fmIndex` change; use target-capture/supersession guards.
- Server eligibility must mirror generated-message rules, including translator enabled/type, empty source, cached-only LLM behavior, and active-writer handling. A current store hit is display-only and costs nothing.
- Deduplicate with manual jobs and make generated-message translation await a matching in-flight ensure inside its existing held promise/defer cap. Keep the server the sole eligibility decider and executor.

## Test plan

### Server unit/integration

- New store tests: fresh DDL and migration, CRUD by composite key, source/settings mismatch rejection, FK delete cascade, same-target latest-job wins, different-index independence, and safe swap/delete remapping without primary-key collision.
- Extend `rawMessageTranslation.test.ts`: primary and alternate persisted greeting text appears in `historytrans`; source/settings mismatch stays empty; `allBefore` still hides greeting; comments/disabled rows and shared token trimming remain aligned.
- Extend `serverMessageTranslation.test.ts`: lookup uses the chat's current `fmIndex`; a greeting stored for a different settings hash is not used; a concurrent greeting/source edit rejects a stale commit.
- Add command-route coverage for auth/active writer, invalid indices, disabled/misconfigured translators, all supported translators, disconnect survival, revision/event shape, duplicate/stale jobs, source edits during provider delay, and no unrelated character/chat/message rewrites.
- Extend route manifest/protection and resource-read tests for the new GET. Extend bootstrap/job tests for running/succeeded/failed greeting recovery and bounded terminal retention.
- If AUTO is chosen, extend `generationChatCompletionTranslation.test.ts`: cached greeting adds no call; missing greeting performs ensure then message translation; the done frame waits for both; cap returns the existing running message frame while work continues; failure is sanitized; no second done frame/client fallback appears.

### Client/unit DOM

- Extend `src/ts/server/commands.test.ts` for the exact GET/POST shapes, immediate unqueued reconciliation, target event, conflict/error handling, and no durable-outbox staging.
- Add projection tests for settings-signature invalidation, source-hash filtering, foreign-event targeted refresh, stale response rejection, and bootstrap job reattachment.
- Extend `Chat.customHtml.test.ts` or add a focused greeting translation DOM test: `idx === -1` calls the server command and never `translateHTML`; success renders persisted text; remount/reload restores it; failure restores source; spinner disables conflicting actions; retranslate targets the captured greeting; a mid-flight swipe/character switch does not update the replacement row.
- Cover primary → alternate → primary swipe reuse, source edit invalidation, translator settings change, bilingual original/translation emphasis, paragraph pairing, and the bootstrap shell (no greeting request/render before `firstMessage`/`alternateGreetings` hydrate).
- Keep the pencil/edit-translation action absent for greeting rows unless a dedicated greeting edit command is added.

### Cache and save regression

- Extend `pipeline.test.ts`, `translator.cache.test.ts`, and server raw-translation tests so each translation-affecting step field changes the shared pipeline signature and all four cache identities. Assert preset names/step ids that do not affect execution do not invalidate.
- `.risu` block and legacy round trips preserve current primary/alternate rows and all settings-hash variants; malformed/hash-inconsistent entries are rejected, stale-source entries are dropped, and legacy files without the field import cleanly.
- Bundle and local-backup embedded database payloads match ordinary `.risu`. Server backup restore includes the table, and restoring an older backup without it yields an empty store rather than a failure.

### Verification commands and live check

- Run focused frontend/server Vitest files first, then `pnpm check`, `pnpm check:server`, and the relevant browser smoke. Finish with `pnpm test:all`.
- Live-check with the keyless Google translator: translate the primary greeting, reload, enable bilingual display, swipe to an untranslated alternate, translate it, swipe back, and reload again. Then use an as-is LLM/echo test preset containing `{{slot::historytrans::N}}` in an automated server test to verify the stored greeting body is present; do not rely on visual output alone for prompt contents.

## Risks

- **Positional identity:** alternate greetings have no stable ids. Every delete/swap/source-edit path must update the table atomically, and late jobs must be source/index fenced. Broadening this fix to stable greeting objects would be a separate migration.
- **Signature drift:** a duplicated settings list can silently reuse the wrong translation. The no-provider server identity helper and `translatorPipelineSignature` must be the only sources; keep all four existing cache sites covered.
- **Derived-field data loss:** portable/wire translation data must never become an ordinary character patch field. Otherwise an old character form can reproduce audit pattern #5 and erase a concurrent translation.
- **Incomplete portability:** the normalized table will be lost unless ordinary `.risu`, bundle, local backup, server backup restore, destructive import, and old-save compatibility are all tested. Character-card portability is intentionally out of scope.
- **AUTO cost/races:** translating on open can spend quota without an explicit click and can overlap the first generated-message translation. Do not ship AUTO without server eligibility, keyed deduplication, cached-only behavior, and done-frame-cap tests.
- **Variant growth:** Option A deliberately preserves every translated settings-hash variant in the initial design. The row count can grow as users repeatedly change pipelines; monitor it and add a tested per-greeting retention policy later if needed rather than silently evicting portable translations in this fix.
- **Job identity/UI freshness:** existing message jobs are keyed by message id. Greeting jobs need a distinct discriminated identity so `idx === -1`, a swipe, or another character cannot inherit the wrong spinner/result.
- **Import/runtime coupling:** `src/ts/translator/presets.ts` is imported by Fastify. Preserve dynamic, relative imports and existing per-step profile selection while refactoring shared identity code.
