# DL2 Pass 1 report — codex

## Checks

- `request_history` v28 round-trip policy — SAFE — Persistence is explicitly non-fatal diagnostic history (`server/fastify/src/requestHistory.ts:163-170`) with bounded retention (`server/fastify/src/requestHistory.ts:272-288`). Its exclusion is documented, including that restore preserves the target's live history (`docs/structure/assets-and-saves.md:317`), and the restore allowlist omits the table (`server/fastify/src/repository.ts:2690-2719`).
- `greeting_translations` v27 write paths — SAFE — Whole-character replacement snapshots translations before deleting character rows and restores source-owner rows afterward (`server/fastify/src/repository.ts:503-548`); portable export materializes only source-valid rows (`server/fastify/src/risuSave/exportSnapshot.ts:68-82`), and device restore includes the table (`server/fastify/src/repository.ts:2703-2706`).
- `providerCredentials` device round-trip versus portable no-secret contract — FINDING DL2-P1-1 — Device restore correctly includes the containing `settings` table (`server/fastify/src/repository.ts:2690-2719`), but ordinary portable export loads and emits the unmasked database root (`server/fastify/src/risuSave/exportSnapshot.ts:38-64`, `server/fastify/src/risuSave/exportSnapshot.ts:115-122`).
- Composer and module-editor draft recovery stores — SAFE — Composer drafts are bounded, lineage-scoped `sessionStorage` records (`src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts:36-42`, `src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts:152-220`); module drafts are bounded, encrypted, lineage-scoped IndexedDB records (`src/ts/server/moduleEditorDraftStore.ts:61-71`, `src/ts/server/moduleEditorDraftStore.ts:118-169`). They are documented as browser editing-recovery artifacts rather than durable commands (`src/docs/client-runtime.md:215-233`), so backup inclusion is not expected.
- New delta settings and nested flags — SAFE — The eight new top-level keys are defaulted/normalized at hydration (`server/fastify/src/databaseDefaults.ts:236-263`, `server/fastify/src/databaseDefaults.ts:401-417`, `server/fastify/src/databaseDefaults.ts:488-508`); nested LLM Gateway/Strip CoT values are preserved by their normalizers (`src/ts/model/modelProfileRecords.ts:647-695`, `src/ts/model/modelProfileRecords.ts:819-845`). Settings and prompt presets are device-restore allowlisted (`server/fastify/src/repository.ts:2709-2718`), while portable import reapplies database defaults (`server/fastify/src/risuSave/importSnapshot.ts:359-386`); absent archive, floating-input, and Mood Light values have explicit read fallbacks (`src/lib/Setting/botpreset.svelte:85-92`, `src/lib/ChatScreens/DefaultChatScreen.svelte:420-422`, `src/ts/moodLightMembership.ts:63-66`).

## Findings

### DL2-P1-1 — Portable `.risu` exports disclose shared provider credentials

- Severity: high / Confidence: certain
- Evidence: Credential records contain raw API keys and Vertex private keys (`src/ts/model/providerCredentialRecords.ts:3-11`) and normalization retains those values (`src/ts/model/providerCredentialRecords.ts:24-52`). The ordinary export route builds this unsanitized snapshot and returns its encoded bytes (`server/fastify/src/routes/save.ts:262-289`); the decisive export is `return { ...snapshot.database, [RISU_SERVER_DATA_KEY]: ... }` (`server/fastify/src/risuSave/exportSnapshot.ts:115-122`). Block exports likewise retain every root key not in `BLOCK_RESOURCE_KEYS`, which does not exclude credentials (`server/fastify/src/risuSave/exportSnapshot.ts:28-36`, `server/fastify/src/risuSave/exportSnapshot.ts:212-219`). Current documentation confirms the leak rather than satisfying the charter's no-secret contract (`docs/structure/assets-and-saves.md:157-161`, `docs/structure/assets-and-saves.md:320`).
- Loss scenario: A user saves a shared-provider API key or Vertex service-account private key → requests an ordinary portable `.risu` export and shares or archives it as portable content → the raw credential is embedded in the file, so its confidentiality is durably lost and any recipient can use the provider account.
- Fix direction: Split portable-content snapshot preparation from device-backup preparation. Remove or redact `providerCredentials` (and any dangling credential references) in both legacy and block portable exports, retain the records for device backup/local-backup round-trips, and pin both sides with no-secret and device-restore regression tests.

## Free-hunt findings

None.

## Not examined

- None within the assigned Pass 1 surface; all five enumerated checks and the in-surface free hunt were completed.
- Per the charter, Passes 2-5 and the July verified-SAFE, ACCEPTED, dismissed, Plugin V2, and generation-correctness surfaces were not re-audited.
