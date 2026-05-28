# Phase 9 (Client Thinning) Audit — Claude

Date: 2026-05-28
Auditor: Claude (Opus 4.7)
Scope: docs/fastify/client-thinning EC1–EC7 closure claim

## Method

Each exit criterion was verified independently against the actual source
(parallel sub-agents reading the cited files), then the verification ladder was
re-run end-to-end on this checkout. Cross-checks looked for invariant violations
the audit script does not explicitly enumerate — i.e. the kind of "closed
locally, regressed globally" pattern the workstream was created to stop
(see `docs/fastify/client-thinning/README.md` lines 16–32).

## Verification ladder (re-run on this checkout)

| Step | Result |
| --- | --- |
| `pnpm client-thinning:audit` | passed |
| `pnpm check` | 0 errors / 0 warnings |
| `pnpm test` | 786 passed, 4 skipped |
| `pnpm api:test` | 1228 passed |
| `pnpm build`, `pnpm smoke:fastify-browser` | not re-run (`history.md:191-195` records them green) |

Numbers match `docs/fastify/client-thinning/history.md` lines 190–195 verbatim.

## Per-EC verdicts

| EC | Verdict | Notes |
| --- | --- | --- |
| EC1 Provider ownership | PASS | See § EC1 |
| EC2 Plugin storage + Compatibility Mode | PASS | See § EC2 |
| EC3 Import current-shape normalization | PASS | See § EC3 |
| EC4 Stable id validation + prompt items | **PARTIAL** | Closeout scope shipped, broader invariant violated — see § EC4 and finding **F-A** |
| EC5 Single active writer | PASS | See § EC5 |
| EC6 Asset reference validation | **PARTIAL** | Scoped fields covered, walker drift class not closed — see § EC6 and finding **F-B** |
| EC7 Repeatable audit + ladder | **PARTIAL** | Script + ladder green, but script's whitelist is narrower than the invariants in `decisions.md`, so neither F-A nor F-B is caught — see § EC7 |

## Findings

### F-A — EC4 invariant violation: command-path create helpers still mint IDs

`docs/fastify/client-thinning/decisions.md:84-100` is explicit: command validators
must never call `randomUUID()`, and the EC7 audit candidate "is literally 'no
command-path helper calls `randomUUID()`.'" The audit script's `noMintFunctions`
whitelist (`util/client-thinning-audit.ts:222-227`) only checks 7 leaf-record
functions. Six top-level `create*Record` helpers — all called directly from
POST `/api/v1/commands/*` routes — still mint IDs when the client omits one:

| Helper | File:line | Called from route |
| --- | --- | --- |
| `createCharacterRecord` | `server/fastify/src/commands/characters.ts:117` | `server/fastify/src/routes/commands.ts:2184` (create) |
| `createPresetRecord` | `server/fastify/src/commands/presets.ts:165` | `server/fastify/src/routes/commands.ts:1024,1183,1254` (create / clone / import) |
| `createPersonaRecord` | `server/fastify/src/commands/personas.ts:62` | `server/fastify/src/routes/commands.ts:1548` |
| `createTranslatorPresetRecord` | `server/fastify/src/commands/translatorPresets.ts:73` | `server/fastify/src/routes/commands.ts:1806` |
| `createLoadoutRecord` | `server/fastify/src/commands/loadouts.ts:60` | `server/fastify/src/routes/commands.ts:1996` |
| `createModuleRecord` | `server/fastify/src/commands/modules.ts:75` | `server/fastify/src/routes/commands.ts:3420` |

All six follow the same pattern:

```ts
x.id = typeof x.id === 'string' && x.id.trim() ? x.id : randomUUID()
```

Per the EC4 decision, omission should be a 400 (client must supply the id), not
a silent server-side mint. Tests pass only because they always supply ids.

**Fix sketch:**

1. Change each helper to throw `ValidationError` when the id field is missing
   instead of minting. Repair stays in the import/bootstrap `ensure*Collection`
   helpers (`repair*` pattern).
2. Extend `noMintFunctions` in `util/client-thinning-audit.ts` to include all
   `create*Record` exports under `server/fastify/src/commands/` so future
   reintroduction fails the audit.
3. Add commands.test.ts cases that POST each resource with no id and expect 400.

### F-B — EC6 walker drift: `database.botPresets[*].image` is walked but never validated

`server/fastify/src/risuSave/assetReferences.ts:73-77` collects
`botPresets[*].image` as an asset reference. `createPresetRecord` only validates
`preset.name`; nothing in the preset command path runs
`validateOptionalServerAssetRef` on `image`. A client can POST a preset with
`image: "<malformed-or-missing-asset-id>"` and persistence accepts it, after
which the walker reports it as a missing reference on export.

The other walker fields are covered:

- `userIcon`, `username` — only written via `mirrorLegacyProfile` from a
  validated `persona.icon`; indirectly safe.
- `customBackground` — validated in `server/fastify/src/routes/commands.ts:4191`
  on settings/display patch.
- `personas[*].icon` — validated in `server/fastify/src/commands/personas.ts:186`.
- `modules[*].assets` — validated via `validateAssetTriples` in
  `server/fastify/src/commands/modules.ts:258`.
- `characters[*].*` and `characterOrder[*].*` — validated.

`decisions.md:149-151` explicitly punts the "broader walker-vs-validator drift
class" to EC7's audit. EC7's `checkAssetWalkerValidators`
(`util/client-thinning-audit.ts:347-385`) iterates only character + character
order walker fields, so the residual `botPresets[*].image` gap is structurally
invisible to the audit.

**Fix sketch:** either add `validateOptionalServerAssetRef` for `preset.image`
inside `createPresetRecord` (and any preset patch path that writes `image`), or
broaden `checkAssetWalkerValidators` to enumerate every top-level walker field
and assert a validator covers it. Preferably both.

### F-C — EC6 test gap (minor)

Tests cover malformed + missing cases for `vits.files.*` and
`gptSoVitsConfig.ref_audio_data.assetId`
(`server/fastify/__tests__/commands.test.ts:5218-5311`), but not the *clear*
path (`null`, `''`, `'-'`) that `validateOptionalServerAssetRef` is meant to
accept (`server/fastify/src/commands/assets.ts:5-16`). Not an invariant
violation — the regression-coverage hole the closeout implicitly claims.

**Fix sketch:** add three small assertions covering `null` / `''` / `'-'` for
both audio fields on create and patch.

## Per-EC evidence

### EC1 — Provider ownership (PASS)

- `useServerGeneration` gone from `SERVER_SETTINGS_GROUP_BY_KEY`
  (`src/ts/server/commands.ts:22-336`); only stale reference is the
  `serverCompletion.test.ts` fixture asserting legacy `false` is ignored.
- `resolveServerCompletionRoute` early-returns `local` only when
  `!isFastifyServer` (`src/ts/process/request/serverCompletion.ts:541`);
  unsupported providers fail with `noRetry: true`
  (`src/ts/process/request/request.ts:522-531`).
- Browser Vertex refresh gated with `if (!isFastifyServer)` around the
  projection write (`src/ts/process/request/google.ts:554-561`).
- Server-side Vertex path through
  `server/fastify/src/generation/vertexAuth.ts` is wired into
  `server/fastify/src/generation/gemini.ts:216` and the completion route in
  `server/fastify/src/routes/generation.ts`.

### EC2 — Plugin storage + Compatibility Mode (PASS)

- Every method on `SafeLocalStorage`, `SafeLocalPluginStorage`, and
  `SafeIdbFactory` calls `assertDeviceLocalPluginStorageEnabled()`
  (`src/ts/plugins/pluginSafeClass.ts:14-131`).
- `getLocalPluginStorage()` is gated at `src/ts/plugins/apiV3/v3.svelte.ts:1251-1254`.
- `pluginCompatibilityMode` flows through `setSettingValue` →
  `patchServerBackedSetting` → `/api/v1/commands/settings/advanced`
  (command-backed, not a direct projection write); UI lives in
  `src/ts/setting/advancedSettingsData.ts`; help text warns "device-local,
  unsynced, excluded from server backup/export"
  (`src/lang/en.ts:817` family).
- `pluginV2` listed in `unsupportedServerBridgeKeys`
  (`src/ts/plugins/plugins.svelte.ts:614`); proxy returns `undefined` for it in
  server mode (line 1013); no `pluginCustomStorage` shadow fallback.
- V3 `getRuntimeInfo()` reports `saveMethod: 'server'` and
  `deviceLocalPluginStorage` flag
  (`src/ts/plugins/apiV3/v3.svelte.ts:1247-1248`).

### EC3 — Import current-shape normalization (PASS)

- `server/fastify/src/routes/save.ts:67` calls the exported
  `normalizeRisuSaveImportDatabase` and feeds the returned normalized clone into
  `applyImportedDatabase`. Both JSON and multipart paths converge on
  `normalizeImportDatabase` (`server/fastify/src/risuSave/importSnapshot.ts:155`).
- Non-object payload → `ValidationError` → 400
  (`server/fastify/src/routes/save.ts:72-75`); no persistence on failure.
- Conditional family processing avoids synthesizing absent families
  (`server/fastify/src/risuSave/importSnapshot.ts:159-191`); message id repair
  still happens through the shared normalizer.
- `server/fastify/__tests__/risuSaveImportRoute.test.ts:114-176` exercises the
  duplicate/missing id case through the JSON path.

### EC4 — Stable id validation + prompt items (PARTIAL)

Closeout-level work (prompt-item create requires `id`, message `chatId`
required, lorebook entry/script/trigger replacement validates ids,
`promptTemplate` removed from generic settings, Bot Settings toggle now uses
`/prompt-items/enable`) is correctly implemented and tested. **But the EC4
invariant from `decisions.md:84-100` is violated** — see finding **F-A**.

### EC5 — Single active writer (PASS)

- `server/fastify/src/activeWriter.ts:13-67` registers the active session on
  bootstrap (last-loader-wins) and returns 423 on stale writers for
  `/api/v1/commands/`, `/api/v1/import/risusave`, `/api/v1/assets`,
  `/api/v1/backups`, `/api/v1/storage/write`, `/api/v1/storage/remove`.
- Header `risu-writer-session` sent by every relevant client:
  `src/ts/server/bootstrap.ts:38`, `src/ts/server/commands.ts:2196`,
  `src/ts/globalApi.svelte.ts:232`, `src/ts/server/backups.ts:121`,
  `src/ts/storage/nodeStorage.ts:110,167`.
- Browser handles 423 via `scheduleStaleSessionReload` → `location.reload()`
  (`src/ts/server/activeWriterSession.ts:17-42`).
- Blind 409 replays removed from `patchServerBackedSettings` and
  `runServerCommand`; 409 surfaces as typed `conflict`
  (`src/ts/server/commands.ts:2212-2217`).
- No WebSocket mutation channels exist (stream-jobs is read-only proxy).

### EC6 — Asset reference validation (PARTIAL)

- `validateCharacterAssetRefs` correctly covers `vits.files.*` and
  `gptSoVitsConfig.ref_audio_data.assetId` for both create and patch
  (`server/fastify/src/commands/characters.ts:383-445`); shared by
  `createCharacterRecord` and `readCharacterPatch`.
- `characterOrder.img` and `characterOrder.imgFile` validated by
  `validateCharacterOrderAssetRefs`
  (`server/fastify/src/commands/characters.ts:217-235`).
- Drift class delegated to EC7's audit by `decisions.md:149-151` is **not
  closed** for `botPresets[*].image` — see finding **F-B**.
- Optional-clear path not covered by tests — see finding **F-C**.

### EC7 — Repeatable audit + ladder (PARTIAL)

- Script lands at `util/client-thinning-audit.ts`, wired as
  `pnpm client-thinning:audit`; full ladder is green; `tauribuild` correctly
  absent from `package.json`.
- AST checks for the *named* invariants work, and the EC5 check actually
  extracts routes and compares against `isKnownServerOwnedMutation` (robust).
- But the script's whitelists are narrower than the invariants in
  `decisions.md`:
  - `noMintFunctions` covers 7 leaf-record functions, not the 6 top-level
    `create*Record` helpers (misses **F-A**).
  - `checkAssetWalkerValidators` iterates only character + characterOrder
    walker fields, not the full walker (misses **F-B**).
- The other EC checks (EC1 provider routing, EC2 V3 bridge, EC2 `pluginV2`
  drift, EC4 `promptTemplate` dual-path) pin specific load-bearing strings —
  brittle to refactor, but would catch the regressions they target.

## Bottom line

EC1, EC2, EC3, EC5 are completed as documented. EC4 and EC6 are closed at the
closeout-scope level, but the broader invariants in
`docs/fastify/client-thinning/decisions.md` are not enforced, and EC7's audit
script — the gate that exists specifically to stop this kind of drift — does
not catch either gap. The verification ladder is green only because the audit
script's whitelist is narrower than the invariant it was supposed to enforce.

This is the same "complete against the known direct-write list ≠ complete
against the server-projection invariant" pattern the workstream was created to
stop (`docs/fastify/client-thinning/README.md:16-32`). The structural fix is
broadening EC7's checks so that future leaks fail the audit instead of being
rediscovered by hand.

## Recommended follow-up

1. **F-A** — change every `create*Record` helper in
   `server/fastify/src/commands/` to reject missing ids; extend
   `noMintFunctions` to include them; add 400-on-missing tests.
2. **F-B** — validate `preset.image` in `createPresetRecord` (and any preset
   patch path), and extend `checkAssetWalkerValidators` to enumerate every
   top-level walker field, not just character / characterOrder.
3. **F-C** — add optional-clear (`null` / `''` / `'-'`) assertions to the
   character audio asset tests.
