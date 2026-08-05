# DL2 Pass 1 report — claude

Scope: charter section "Pass 1 — Round-trip completeness for post-closure
stores", delta `28eb3fb66..e1ac763da`, audited at HEAD (`e1ac763da`).

## Checks

- **`request_history` round-trip (v28, `935e49a24`, `19d16c6f0`)** — SAFE
  (deliberate, documented exclusion) with hygiene residue → FINDING DL2-P1-1.
  The table is absent from `SQLITE_BACKUP_TABLES`
  (`server/fastify/src/repository.ts:2690-2719`) and from every portable
  format (`server/fastify/src/risuSave/exportSnapshot.ts:38-83` exports only
  the persisted database object; request_history is never joined into it),
  but the exclusion is explicitly documented as policy at
  `docs/structure/assets-and-saves.md:317` ("Excluded from portable formats
  … not restore-allowlisted, so restore leaves the target's live history
  untouched"). Restore mechanics confirm it: `restoreSqliteFromBackup`
  swaps only allowlisted tables via ATTACH
  (`repository.ts:3380-3408`), and the legacy-json path deletes only
  allowlisted tables (`repository.ts:3344-3347`), so live history survives
  restore untouched in both paths, exactly as documented. The v28 up-path is
  additive/idempotent (`server/fastify/src/db.ts:281-287`,
  `requestHistory.ts:86-112`), and the boot path re-runs
  `createRequestHistoryTable` (with the `api_metadata_json` ALTER fallback)
  at current version (`db.ts:360`), so DBs created between `935e49a24` and
  `19d16c6f0` gain the column. Residue: the in-code exclusion comment and
  test suite do not record the exclusion — see finding.
- **`greeting_translations` write paths (v27; `repository.ts:509`, `:714`)** —
  SAFE. `replaceAllCharactersInTable` snapshots all rows before the
  chats/characters DELETE (cascade wipes the table via the
  `ON DELETE CASCADE` FK, `translation/greetingTranslationStore.ts:47`),
  re-inserts characters first, then re-inserts rows filtered to surviving
  `characterId`s (`repository.ts:505-548`) — so the client's whole-DB
  write-back (which never carries the table) cannot destroy server-side
  rows. `deleteCharacterRow` relies on the FK cascade and records the write
  (`repository.ts:709-722`). Import replaces the table atomically with
  validated rows (`greetingTranslationStore.ts:324-350`), inserted after
  characters exist (FK-safe). Restore: allowlisted at `repository.ts:2705`;
  a pre-v27 backup restored at HEAD empties the table (DELETE + skip-INSERT
  when the backup lacks the table, `repository.ts:3400-3407`), which is the
  correct semantics for wholesale character replacement. Portable field
  round-trip (`exportSnapshot.ts:68-83` ⇄ `importSnapshot.ts:257-310`)
  validates, dedupes, and drops stale-source rows only.
- **Provider credential store round-trip (`providerCredentials`,
  `c8d39a9c6`)** — SAFE for the store itself; adjacent FINDING DL2-P1-2 on
  the pre-store-backup restore path. Device backup: credentials live in the
  `settings` row (`repository.ts:393-399` stores every non-collection key),
  `settings` is allowlisted (`repository.ts:2718`), restore replaces it →
  credentials round-trip. Portable `.risu`: the export is built server-side
  from raw SQLite with no masking (`exportSnapshot.ts:38-66`; the only
  non-test consumers of the encoder are the server routes,
  `routes/save.ts:270`, `:310` — the masked client DB is never an export
  source), and the documented contract is "Included unmasked in
  whole-database settings; portable save files must be handled as secrets"
  (`docs/structure/assets-and-saves.md:320`). The charter's hypothesis that
  credentials "must never leak into portable exports" is therefore
  REFUTED as a description of the actual contract: the no-secret portable
  contract covers server-operational secrets only (push subscriptions,
  retry-queue payloads, endpoints), and that contract holds
  (`server/fastify/__tests__/risuSaveCodec.test.ts:651-697`). Import keeps
  credentials: `normalizeImportDatabaseShape` never filters unrecognized
  keys (`importSnapshot.ts:359-387`) and `normalizeProviderCredentials`
  preserves every command-validated row
  (`src/ts/model/providerCredentialRecords.ts:24-57`).
- **Reload-durable composer/module draft recovery stores (`2c757ee2b`)** —
  SAFE: backup inclusion is correctly NOT expected. (Note: this commit
  predates the delta base `28eb3fb66`; audited at HEAD per the brief.)
  Composer drafts live in browser `sessionStorage`
  (`src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts:166`, `:258`)
  and module drafts in an encrypted client IndexedDB store
  (`src/ts/server/moduleEditorDraftStore.ts:127`, `:256-273`); both are
  keyed by `(databaseLineage, writerSessionId)`
  (`composerDrafts.ts` scope checks, `moduleEditorDraftStore.ts:104-105`,
  `:143-147`). They never touch the server dataDir, and restore/import
  rotates the database lineage (`repository.ts:3410`), which by design
  makes any pre-restore draft dormant — recovery is same-database,
  same-writer-session only. No durable user data is at stake beyond the
  transient draft itself; exclusion is deliberate and structurally
  enforced.
- **New settings keys across the delta (enumerated from the
  `databaseDefaults.ts` diff)** — SAFE; one hygiene gap → free-hunt
  DL2-P1-F1. Delta keys: `providerCredentials` (:237), `agents`/
  `agentPresets`/`agentPresetDefaultId` (:238-240 via
  `normalizeAgentConfiguration`), `requestHistoryLimit` (:262-263),
  `translatorExcludeThoughts` (:402), `groupOtherBotRole`/`groupTemplate`
  (:416-417), `floatingChatInput` (databaseDefaults diff), and
  `moodLightMembership` (`65884c0ad`). Strip CoT (`28d40ffdc`) and LLM
  Gateway options (`b11cbdfeb`) add no new top-level keys — they live
  inside the pre-registered `modelRuntimeDefaults`/`modelProfiles` keys;
  the prompt-preset archive flag (`ee5382a9a`) lives inside
  `prompt_presets` rows (allowlisted at `repository.ts:2709`; import
  validates it at `server/fastify/src/commands/splitPresets.ts:337-338`
  and preset normalization preserves whole records,
  `commands/presets.ts:161-193`). Backup membership: all keys land in the
  single `settings` row via `extractSettings` (`repository.ts:383-399`) →
  allowlisted wholesale; `.risu` round-trip: the import normalizer keeps
  unrecognized keys (`importSnapshot.ts:359-387`) and all delta keys are
  registered in `SERVER_SETTINGS_GROUP_BY_KEY`/agents-group
  (`src/ts/server/settingsGroups.ts:132`, `:197`, `:201`, `:271`, `:329`,
  `:373`) so `RECOGNIZED_IMPORT_DATABASE_KEYS` recognizes settings-only
  saves (`groupOtherBotRole`/`groupTemplate` are additionally preset-level
  fields, `src/ts/presetSplit.ts:135-136`). Hydration on stale DBs:
  `requestHistoryLimit` is normalized at every consumer
  (`routes/requestHistory.ts:15`, `requestHistory.ts:114-117`);
  `translatorExcludeThoughts` has read-site + `getValue` fallbacks
  (`src/ts/setting/languageSettingsData.svelte.ts:230`);
  `moodLightMembership` normalizes undefined
  (`src/ts/moodLightMembership.ts:63-66`); `agents`/`agentPresets` use
  `?? []` (`server/fastify/src/prompt/effectiveGenerationConfig.ts:93-94`,
  `src/ts/agents.ts:43`); `groupOtherBotRole`/`groupTemplate` coerce
  undefined server-side (`server/fastify/src/prompt/history.ts:414-419`,
  `:464`); `floatingChatInput` has a correct behavior read-site
  (`!== false`, `src/lib/ChatScreens/DefaultChatScreen.svelte:421`) but its
  settings item lacks the `getValue` fallback — see DL2-P1-F1. Booleans are
  registered for the settings PATCH route
  (`routes/commands.ts:1505`, `:1630`, `:1706`, `:1776`).

## Findings

### DL2-P1-1 — `request_history` exclusion documented only in docs; no in-code note or regression pin
- Severity: low / Confidence: certain
- Evidence: `server/fastify/src/repository.ts:2683-2688` — the "Live
  operational exclusions" comment enumerates `push_subscriptions`,
  `database_metadata`, `command_mutation_receipts` and omits
  `request_history`, the fourth deliberately excluded durable table
  (policy recorded only at `docs/structure/assets-and-saves.md:317`).
  `server/fastify/__tests__/backups.test.ts` contains zero `request_history`
  references, so nothing pins the exclusion as intentional; the charter's
  Method §4 allowlist-vs-schema diff test does not exist yet (no test
  compares the `db.test.ts:96` live-table list against
  `SQLITE_BACKUP_TABLES`).
- Loss scenario: not direct loss today (exclusion is deliberate:
  request history is retention-pruned diagnostic data,
  `requestHistory.ts:272-289`). The risk is A-5-class recurrence: a future
  durable table copies the `request_history` pattern (skips the allowlist),
  and with neither an in-code exclusion register nor a CI diff, silently
  never round-trips — user data in that future table is destroyed on the
  first restore-based recovery.
- Fix direction: add `request_history` to the exclusions comment at
  `repository.ts:2684` with its rationale, and land the Method §4
  allowlist-completeness test with an explicit documented-exclusion list.

### DL2-P1-2 — Restoring a pre-credential-store backup durably destroys inline model-profile secrets without minting credentials
- Severity: medium / Confidence: certain
- Evidence: `server/fastify/src/repository.ts:353-362` —
  `loadSettingsFromSqlite` applies `repairPersistedModelProfileInlineSecrets`
  (`repository.ts:270-293`: deletes `providerOptions.apiKey`,
  `vertex.clientEmail`, `vertex.privateKey` from every profile) and
  immediately writes the scrubbed settings back:
  ```ts
  if (repairPersistedModelProfileInlineSecrets(parsed)) {
    db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(parsed))
  }
  ```
  Nothing converts the inline secrets into `providerCredentials` first:
  `convertLegacyModelProfilesCommand`
  (`server/fastify/src/commands/modelProfiles.ts:369-442`) mints
  credentials only from the legacy *scalar* keys, and any command's
  settings read passes through the scrub before a mutation body could see
  the inline values. The behavior is deliberate and test-pinned:
  `server/fastify/__tests__/staleInlineModelProfileSecrets.test.ts:124-136`
  asserts the secrets are durably gone with no replacement credential.
- Loss scenario: user restores a device backup (or imports a `.risu`)
  created before `c8d39a9c6` (2026-07-23) in which model profiles carried
  inline `providerOptions.apiKey` / Vertex service-account secrets → the
  first settings read after restore silently deletes those secrets and
  writes back → profile resolution throws `credentialUnavailable`
  (`server/fastify/src/providerOperations.ts:468-478`) and the stored keys
  are unrecoverable from the live DB (Vertex private-key material may not
  be re-downloadable from GCP). The restore that triggered the scrub is
  itself the user's recovery action, so the automatic safety snapshot may
  already be their only other copy.
- Fix direction: either mint `providerCredentials` rows from inline profile
  secrets inside the scrub (mirroring the legacy-scalar conversion), or
  record this as an explicit `ACCEPTED` security-over-durability decision
  in the audit registry with a user-facing notice when the scrub fires.

## Free-hunt findings

### DL2-P1-F1 — `floatingChatInput` settings item lacks the `getValue` hydration fallback
- Severity: low / Confidence: certain
- Evidence: `src/ts/setting/accessibilitySettingsData.ts:66-72` — the
  check item declares `bindKey: 'floatingChatInput'` with no
  `getValue: (db) => db.floatingChatInput ?? true`, while the value
  resolver uses raw `db[bindKey]` absent `getValue`
  (`src/ts/setting/utils.ts:182-183`). On a server DB created before
  `2b3fef527` the key is `undefined` client-side (server
  `normalizeDatabaseDefaults` runs only on initialize/import), so the
  checkbox renders unchecked while the feature is effectively ON
  (`DefaultChatScreen.svelte:421` treats undefined as enabled). Sibling key
  `translatorExcludeThoughts` shows the required pattern
  (`languageSettingsData.svelte.ts:230`).
- Loss scenario: no durable data loss — state-display mismatch only: a
  user wanting the floating input OFF sees the box already unchecked,
  doesn't click, and the feature stays on. Reported because the charter
  requires the hydration pattern per new key.
- Fix direction: add `getValue: (db) => db.floatingChatInput ?? true` to
  the item.

### DL2-P1-F2 — Import accepts `__RISU_SECRET_MASKED__` placeholders as literal credential values
- Severity: low / Confidence: probable (the placeholder-bearing input file
  must come from outside the normal export path — the unverified link is
  whether any first-party flow produces an importable masked save)
- Evidence: `src/ts/model/providerCredentialRecords.ts:35-38` —
  `normalizeProviderCredentials` keeps any non-blank `apiKey` string, so
  the masking sentinel (`src/ts/providerSecretMask.ts:1`) survives import
  normalization (`importSnapshot.ts:381`) and is stored as a real key;
  `resolveMaskedProviderSecretPlaceholders` runs only on the command PATCH
  path (`routes/commands.ts:38`), not the import path. Server exports are
  never masked (`exportSnapshot.ts:38-66`), but externally assembled saves
  (e.g. built from masked resource reads or the masked bug-report JSON,
  `src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte:21`) can
  carry placeholders.
- Loss scenario: user imports a masked save → the import replaces the
  database, storing `__RISU_SECRET_MASKED__` as credential values → all
  provider requests fail; the user's real keys survive only in the
  automatic safety snapshot (`repository.ts:2312`), which default
  retention (3 automatic snapshots) can prune after a few more
  imports/restores — after that the keys are durably gone.
- Fix direction: have import normalization drop (or reject loudly)
  credential/secret fields equal to `MASKED_PROVIDER_SECRET`.

## Not examined

- Pass 2–5 surfaces (script writes, destructive flows, import boundaries
  beyond the round-trip normalizer, retention/GC/secret-scrub coverage for
  the new providers) — other passes own them; `request_history`
  growth/retention and `greeting_translations` GC specifically deferred to
  Pass 5 per the charter.
- Whether the masked bug-report JSON
  (`SettingsExportButtons.svelte`) is actually accepted by the import
  route's envelope classifier (feeds DL2-P1-F2's unverified link; probing
  it live would require running the server, which the brief forbids).
- Exhaustive per-key sweep of every *pre-delta* settings key's hydration
  fallback — only the delta-born keys were checked, per the charter.
- The client-side legacy encoder `src/ts/storage/risuSave.ts` was checked
  for non-test consumers only (none found); its internal encode paths were
  not line-audited since no production flow reaches them.
