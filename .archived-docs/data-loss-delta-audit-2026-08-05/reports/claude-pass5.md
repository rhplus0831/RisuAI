# DL2 Pass 5 report — claude

## Checks

- **Credential scrub coverage for post-store providers (LLM Gateway, Neuralwatt)** — SAFE —
  None of the four provider commits (`d9981b5c5`, `b11cbdfeb`, `0b6ef0dfb`, `78e726e2a`)
  touched the mask registry or repository (`git show --stat <hash> -- src/ts/providerSecretMask.ts
  server/fastify/src/providerSecrets.ts server/fastify/src/repository.ts` shows empty diffs for all
  four); the only registry change in the delta is `c8d39a9c6` itself. Both providers store secrets
  exclusively via the shared credential picker (`src/lib/Setting/Pages/Model/ModelProviderPanel.svelte:123,593-606`
  binds `credentialId`; `apiKey` appears nowhere in `ModelProfileEditorDrawer.svelte`), and their
  only new durable providerOptions are non-secret enums
  (`src/ts/model/modelProfileRecords.ts:66-71,178` — reasoningEffort/verbosity/serviceTier/routing).
  The API key exists only in-memory post credential-merge
  (`src/ts/model/modelProfileResolver.ts:719-755` → consumed at `:1354-1366`); inline persistence is
  rejected at write time (`modelProfileRecords.ts:497-499` throws "apiKey is no longer supported"),
  the settings PATCH path routes `modelProfiles` through that validator
  (`server/fastify/src/routes/commands.ts:9406`), and the provider-agnostic load-time scrub
  (`server/fastify/src/repository.ts:270-293`, applied in `loadSettingsFromSqlite` at `:358` with
  write-back) covers any residue for *every* profile regardless of providerId. The
  `providerCredentials` mask paths remain registered (`src/ts/providerSecretMask.ts:37-38`). Catalog
  fetches for both providers are credential-free (`src/ts/model/llmgateway.ts:28`,
  `src/ts/model/neuralwatt.ts:39` — `credential: { source: 'none' }`).

- **`request_history` growth/retention** — SAFE (one adjacent lifecycle gap reported as free-hunt
  DL2-P5-F1) — Retention is bounded: `normalizeRequestHistoryLimit` clamps to 0..10,000 with
  default 20 (`server/fastify/src/requestHistory.ts:6-7,114-117`); `beginRequestHistory` prunes after
  every insert (`:159`), `listRequestHistory` prunes on every list (`:293`), and a settings patch of
  `requestHistoryLimit` prunes immediately inside the mutation
  (`server/fastify/src/routes/commands.ts:2213-2214`), so setting 0 purges the table at once
  (`requestHistory.ts:274-276`). Per-row delete route exists
  (`server/fastify/src/routes/requestHistory.ts:47-59`). The key is read through
  `normalizeRequestHistoryLimit(...)` at every call site, so `undefined` on existing DBs yields the
  bounded default, never unbounded growth. Capture is credential-safe: profile snapshots carry only
  ids/names (`requestHistory.ts:119-133`), chat capture stores finalized messages
  (`server/fastify/src/prompt/chatDispatch.ts:1102-1124`), the legacy route stores only
  messages/system (`server/fastify/src/routes/generation.ts:487-496`), and the Ollama Cloud proxy
  strips headers/params, persisting only system/messages/instructions/input
  (`server/fastify/src/ollamaCloudToolProxy.ts:300-311`) while the bearer key lives only in the
  fetch headers (`:144-150`). History persistence failures are deliberately non-fatal
  (`tryBeginRequestHistory`/`completeRequestHistory` catch, `requestHistory.ts:163-172,208-210`).

- **`greeting_translations` GC on character delete** — SAFE — The table declares
  `character_id ... REFERENCES characters(id) ON DELETE CASCADE`
  (`server/fastify/src/translation/greetingTranslationStore.ts:47`) and every connection enables
  enforcement (`server/fastify/src/db.ts:333` `PRAGMA foreign_keys = ON`), so the targeted delete
  path (`server/fastify/src/repository.ts:709-722`, which also records the cascaded
  `greeting_translations` write at `:714`) cleans rows atomically. The broad rewrite path snapshots
  rows before the cascade-triggering `DELETE FROM characters` and re-inserts only rows whose
  character survives (`repository.ts:505,540-548`), so a character removed via whole-collection
  replace also drops its rows. Trashing does NOT delete the character row (`trashTime` is a marker
  field, `server/fastify/src/commands/characters.ts:21,299`), so translations correctly survive
  trash→restore. FK enforcement also makes dangling-row *insertion* impossible (an insert for a
  missing character fails), and restore inserts `characters`/`chats` before `greeting_translations`
  (allowlist order, `repository.ts:2703-2705`).

- **Agent-preset module deletion lifecycle (`0522cb4cb`, `76dcd9f99`)** — SAFE — Deleting a
  reusable Agent is refused while any preset invokes it
  (`server/fastify/src/commands/agentPresets.ts:374-380` throws
  "Agent is still used by N Agent Preset invocation(s)"); the client mirrors the count
  (`src/ts/agents.ts:42-47`). Deleting an Agent Preset is scoped and reference-clean: it clears the
  default only if it pointed at the deleted preset (`agentPresets.ts:214-215`) and deletes
  `agentPresetId` only from chats/loadouts that reference exactly that preset
  (`agentPresets.ts:1327-1352`, guarded by `!== presetId` continues). RisuAI-module integration is a
  free-text id/namespace string (`moduleIntergration`,
  `src/ts/agentPresetRecords.ts:154-155`); deleting a module leaves a dangling name that resolution
  tolerates read-only — unmatched ids simply select nothing
  (`src/ts/moduleIntegration.ts` `parseModuleIntegration`,
  `server/fastify/src/prompt/modules.ts:66-69`) and a use referencing a missing agent is skipped
  without any durable write (`agentPresetRecords.ts:262-264`). Legacy preset-owned steps are
  migrated into standalone Agents, not dropped
  (`agentPresetRecords.ts:230-252` — content-preserving `agentRecordFromLegacyStep`). Provider
  credential lifecycle rechecked in passing: delete is blocked while any profile references the
  credential (`server/fastify/src/commands/providerCredentials.ts:103-109`), masked placeholders
  cannot be committed as literal secrets (`:183-187`), and updates are optimistic-concurrency
  guarded (`:75-80`).

## Findings

None from the enumerated checks.

## Free-hunt findings

### DL2-P5-F1 — `request_history` rows survive device-backup restore across lineage rotation
- Severity: low / Confidence: certain
- Evidence: `server/fastify/src/repository.ts:2690-2719` — `SQLITE_BACKUP_TABLES` does not include
  `request_history`; both restore branches clear/replace only allowlisted tables
  (`repository.ts:3344-3347` clears the allowlist when no SQLite payload exists,
  `:3400-3406` DELETE+INSERT per allowlisted table when one does), then rotate the database lineage
  (`:3348`, `:3410`). No other code deletes `request_history` on restore (`grep request_history
  repository.ts` matches only the allowlist absence; the only delete paths are the prune/route
  deletes in `requestHistory.ts:272-289,326-328` and the settings-patch prune at
  `routes/commands.ts:2213-2214`).
- Loss scenario: not destruction but unexpected *retention* with an integrity edge — user restores a
  device backup (e.g., replacing a corrupted or foreign database, or wiping to a clean snapshot
  before handing the server over) → restore swaps every durable store and rotates the lineage → the
  previous installation's full LLM request transcripts (complete prompts including chat content,
  responses, character/chat names in `context_json`) remain readable at
  `GET /api/v1/request-history` inside the restored database, referencing character/chat ids that no
  longer exist. The user's reasonable belief that restore reset the durable state is silently wrong
  for this store.
- Fix direction: decide the exclusion explicitly (charter Pass 1 owns the round-trip half): either
  add `request_history` to `SQLITE_BACKUP_TABLES`, or clear it in both restore branches alongside
  the lineage rotation and document it as device-local telemetry. Feed the decision into the Method
  §4 allowlist-completeness test's documented-exclusion list.

### DL2-P5-F2 — One invalid `greeting_translations` row bricks every broad character write
- Severity: low / Confidence: speculative (the unconfirmed link: no shipped writer currently
  produces an invalid row — entry requires a version downgrade after a future enum extension, or
  out-of-band DB edits)
- Evidence: `server/fastify/src/repository.ts:505` — `replaceAllCharactersInTable` starts with
  `listAllGreetingTranslations(db)`, whose `rowFromStored` →
  `parseRawMessageTranslation` throws `GreetingTranslationValidationError` on any row whose
  `translatorType` falls outside the hardcoded set or whose hash/timestamp fields disagree
  (`server/fastify/src/translation/greetingTranslationStore.ts:100-112,146-155`). The rows are not
  schema-versioned. `replaceAllCharactersInTable` runs inside the broad command-mutation paths
  (`server/fastify/src/commands/mutations.ts:260,360,564`) and the restore/import paths
  (`repository.ts:1262,1883,2337,2390`).
- Loss scenario: a single poisoned row (e.g., written by a future version that legitimately adds a
  translator type, then the user downgrades — schema_version stays 28 so the downgrade is not
  refused) → every broad character-collection write and every restore throws and rolls back → the
  user can no longer persist any change that routes through the broad path until the row is removed
  by hand. Fail-loud, so no silent loss, but a durable write outage caused by cache-class data.
- Fix direction: make `listAllGreetingTranslations`' snapshot-for-rewrite path drop (or pass
  through opaquely) rows that fail validation instead of throwing — the rows are re-derivable
  translation cache, strictly less valuable than the character write being blocked.

## Not examined

- Round-trip/backup-allowlist membership questions for `request_history`, `providerCredentials`,
  and the new settings keys — Pass 1's surface; I verified only the lifecycle/secrets half and
  noted the restore-side complement in DL2-P5-F1.
- The client `RequestHistorySettings.svelte` UI flows (delete buttons, limit editor) beyond
  confirming the server routes and command validation they call; no dev server was run.
- Exhaustive secret-audit of every value that can reach `metadata_json`/`api_metadata_json` via
  provider `done`/`error` frame `apiMetadata` for all providers — I verified the frame builders in
  `chatDispatch.ts`/`generation.ts` and the four capture sites pass only status/model/finish
  metadata, but did not walk every per-provider adapter's `apiMetadata` construction.
- `memorySummarizeJobHandler`'s summarize adapter internals beyond its capture site
  (`server/fastify/src/memorySummarizeJobHandler.ts:224-241` — prompt messages only).
- Voyage Context 4 (`54864e1ca`) beyond confirming it reuses the pre-registered `voyageApiKey`
  mask path and adds no new secret storage.
- Whether hybrid agent-preset records carrying both `agentUses` and non-empty legacy `steps` can
  exist in the wild (normalization would discard the steps at
  `src/ts/agentPresetRecords.ts:236-239`); no shipped version writes that shape, so I judged it
  unreportable rather than speculating further.
