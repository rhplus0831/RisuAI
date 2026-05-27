# Closeout Buckets

Date: 2026-05-28

The work breakdown for the open findings, in suggested order, encoding the
decisions in [`decisions.md`](./decisions.md). Each bucket closes one exit
criterion ([`README.md`](./README.md)) and its finding
([`open-findings.md`](./open-findings.md)). A bucket is done only when its
finding is resolved **and** the exit criterion's regression proof is committed.

| Order | Bucket | Closes | Finding |
|-------|--------|--------|---------|
| 1 | Provider ownership (server-only generation) | EC1 | F1 |
| 2 | Plugin durable storage + Compatibility Mode | EC2 | F2 |
| 3 | Import current-shape normalization | EC3 | F3 |
| 4 | Stable-id validation + prompt-item semantics | EC4 | F4 |
| 5 | Single active-writer session lock | EC5 | F5 |
| 6 | Character asset-reference validation | EC6 | F6 |
| 7 | Repeatable audit script + full verification ladder | EC7 | — |

1. **Provider ownership (EC1=A).** Make server generation the only path in
   Fastify mode: **remove `useServerGeneration`** (treat as const-true in Fastify
   so the toggle no longer gates dispatch). Make browser provider dispatch
   unreachable — formats the server cannot own yet return an explicit
   "unsupported in server mode" error instead of silently dispatching with masked
   placeholders. Move the Vertex token refresh server-side (server Vertex routing
   already exists in `server/fastify/src/generation/vertexAuth.ts`); remove the
   client projection write at `google.ts:553`. Masking stays.
2. **Plugin durable storage (EC2=B + Compatibility Mode).** Default: durable plugin
   storage stays the already-server-backed `risuai.pluginStorage` (no change
   there); disable the three device-local sandbox APIs in Fastify mode —
   `SafeLocalStorage` (sync), `SafeIdbFactory` (IndexedDB), and
   `getLocalPluginStorage()`/`SafeLocalPluginStorage` (local async) — with
   explicit unsupported errors. Add an **account-wide, command-backed**
   `pluginCompatibilityMode` setting (settings allowlist +
   `SERVER_SETTINGS_GROUP_BY_KEY`, mirroring the `verbosity` fix); when on,
   restore those three device-local APIs. The toggle relaxes storage *location* only:
   `unsupportedServerBridgeKeys`/`pluginV2`/reserved-key ownership stay enforced
   in **both** states. Fix `pluginV2` (drop from `allowedDbKeys` or give it a real
   command path), fix read-time shadowing via the V2 `getDatabase` fallback
   (`:1002`), and make `getRuntimeInfo().saveMethod` (+ a capability flag) honest.
   UI: the toggle sits under Advanced Settings → not-recommended, warning that its
   data is device-local, unsynced, and excluded from server backup/export.
3. **Import normalization (EC3=A).** In the JSON path in `save.ts`, **pass the
   returned normalized clone** from the already-exported
   `normalizeRisuSaveImportDatabase` (`importSnapshot.ts:83`) to
   `applyImportedDatabase` — the normalizer returns a cloned normalized DB, so
   calling it without using the return value is a no-op. Delete the narrow
   route-local normalizer. Audit any test that deliberately seeds malformed data
   via JSON (it will now be normalized on the way in).
4. **Stable-id validation + prompt items (EC4).**
   - *4a (split helpers):* split each id helper into `repairX` (import/bootstrap
     only, may mint ids) and `validateX` (command path, rejects missing/duplicate
     with 400). Lorebook entries (`ensureLorebookEntries`) and script/trigger defs
     (`ensureDefinitionRecords`) get the full split; messages need only to **stop
     generating the missing `chatId`** (`createMessageRecord:68`) — duplicate
     rejection already exists. Create commands require a client-supplied id and
     reject missing (incl. prompt-item create, `prompts.ts:64`); no command-path
     helper may call `randomUUID()`.
   - *4b (subtractive prompt items):* drop `promptTemplate` from
     `PROMPT_SETTINGS_KEYS` (`prompts.ts:19`) and remove prompt-settings
     acceptance + validation for it (`prompts.ts:177`); note `commands.ts:1328`
     only *reads* prompt settings (generic apply is around `:1341`/`:4184`). The
     existing `/prompt-items/*` CRUD/reorder commands become the only editing
     path; preset switch already carries `promptTemplate` server-side via
     `applyPreset`. Route the `BotSettings.svelte:1455` enable/disable toggle
     (`{ promptTemplate: [] }`) through a command (clear/delete-all) instead of
     the settings patch.
5. **Single active-writer session lock (EC5).** Port the `Risuai-NodeOnly`
   reference (`1c1d7bc6`): mint a per-page-load session id; register the active
   writer on **bootstrap** (last-loader-wins); reject non-active sessions with
   **423** on **every server-owned mutating route** — `/api/v1/commands/*`,
   import (`save.ts`), asset upload (`assets.ts`), backups (`backups.ts`), and
   legacy storage writes (`legacyStorage.ts`); read routes are untouched. The
   client reacts on 423 by notifying the user and reloading (re-bootstrap +
   re-register). Still remove the blind 409 replay at `commands.ts:2152` and
   `:1038` as a backstop; a stray same-session 409 surfaces a plain error/reload.
   No conflict-resolution page; no retry-safety classification.
6. **Asset-reference validation (EC6).** Extend `validateCharacterAssetRefs`
   (`characters.ts:371`) to iterate the `vits.files` dynamic map (report
   `vits.files.<key>`) and validate `gptSoVitsConfig.ref_audio_data.assetId`,
   reusing `validateOptionalServerAssetRef`. Shared by create and patch already;
   reject-on-missing. Tests: valid/missing/malformed on both paths. Scope is the
   character **audio** refs only — the broader walker-vs-validator drift class
   (e.g. `characterOrder.img` vs `imgFile`) is left to EC7's audit.
7. **Repeatable audit + ladder (EC7).** Land the audit script below, then run the
   full ladder. No audit/invariant package script and no `ts-morph` dependency
   exist yet (`package.json`); both must be added and wired (the ladder scripts
   already exist; `tauribuild` is correctly absent).

## EC7: audit-script specification

The point of EC7 is to stop the "closed, then rediscovered" cycle by turning the
invariants into repeatable structural checks. `ts-morph` is more useful here than
LSP/`pnpm check`: most remaining failures are semantic contract gaps, not type
errors, so `pnpm check` can pass while the contract is still wrong.

Candidate checks (ts-morph + `rg`):

- **EC5:** assert **no `/api/v1/commands/*` mutation route or import/asset-write
  route bypasses the active-session check** (every mutating handler runs the
  guard). Replaces the previous "classify retry safety" check, which the
  session-lock decision made unnecessary.
- **EC4:** find **command-path helpers that call `randomUUID()`** / otherwise mint
  ids (must be none; repair lives only in import/bootstrap `repairX` helpers).
- **EC4:** find resources reachable through **both** a typed command **and** a
  generic-settings/whole-array channel (the `promptTemplate`-style dual path).
- **EC2:** with Compatibility Mode off, assert **no sandbox path exposes sync
  `localStorage`/IndexedDB durable writes** (the browser smoke currently patches
  IndexedDB/OPFS, not `localStorage` — extend it or scope the assertion to match);
  compare `allowedDbKeys`,
  `unsupportedServerBridgeKeys`, settings maps, and command dispatch tables for
  drift; flag `pluginV2`-style allowed keys with no command path.
- **EC6:** compare the **asset-reference walker fields** against the owning command
  validators (no walker field without a validator).
- **EC1:** flag **browser provider-dispatch fallbacks** reachable without server
  ownership, and durable writes inside `withTrustedServerProjectionWrite` with no
  command/import follow-up.

The script decides no semantic policy on its own; it makes the audit repeatable
so a future "complete" claim is checkable rather than re-derived by hand.

## On tooling

- **TypeScript/Svelte LSP** helps navigation, hover, references, and editor
  diagnostics. It does not close this workstream by itself.
- **ts-morph** is the right tool for the standing audit (above).
