# Final Client-Thinning Documentation Audit

Date: 2026-05-28

This is a consolidation of the per-item sub-agent audits for EC1 through EC7.
It records documentation-direction variables only: stale assumptions, already
existing code, newly broadened scope, and wording that could steer the remaining
client-thinning work incorrectly.

Historical snapshot: at the time this audit was written, no exit criterion was
resolved by this audit and EC1 through EC7 remained open against that codebase.
This file is no longer the current closeout state. The original EC1 through EC7
workstream later closed in this directory, and the follow-up alpha findings are
tracked and closed under
[`../client-thinning-alpha/`](../client-thinning-alpha/).

## Sub-agent coverage

| Item | Sub-agent focus |
|------|-----------------|
| EC1 / F1 | Provider ownership and browser generation fallback |
| EC2 / F2 | Plugin durable storage and Compatibility Mode |
| EC3 / F3 | JSON import normalization |
| EC4 / F4 | Stable ids and prompt-item semantics |
| EC5 / F5 | Conflict hiding and single active writer |
| EC6 / F6 | Character asset-reference validation |
| EC7 | Repeatable invariant audit and verification ladder |

## Summary

| Item | Current status | Documentation-direction variables |
|------|----------------|-----------------------------------|
| EC1 / F1 | Still open; partly stale wording. | Server generation is still opt-in and browser fallback remains reachable, but several proxy/`xcustom` formats are already server-routed. Server-side Vertex exchange/cache already exists; the remaining Vertex issue is browser fallback plus client-side token refresh writes. |
| EC2 / F2 | Still open; partly stale wording. | Normal `pluginStorage` and unknown-key persistence are already command-backed, and write-time reserved-key shadowing is partly blocked. Remaining gaps are ungated browser-local `SafeLocalStorage`, `SafeIdbFactory`, and `getLocalPluginStorage()`, plus `pluginV2`, read-time shadowing, `saveMethod`, and absent Compatibility Mode. |
| EC3 / F3 | Still open; mostly current. | JSON import persists a route-normalized payload, not a raw payload. The broad normalizer already exists and returns a normalized clone; the JSON path must pass that returned value to `applyImportedDatabase`. |
| EC4 / F4 | Still open; partly stale wording. | Lorebook and script/trigger replacement still repair ids, and missing message `chatId` is still minted. Message duplicate rejection, `/prompt-items/*` CRUD/reorder, and generic settings rejection for `prompt` already exist. Prompt-item create still mints ids, so EC7's "no command-path helper mints ids" wording needs an explicit create-vs-replace rule or an exemption. |
| EC5 / F5 | Still open; scope needs clarification. | Blind 409 replay remains in both wrapper sites, but low-level conflict surfacing and server command revision enforcement already exist. No 423/session lock exists. The session-lock route scope should include all server-owned mutating routes or explicitly list exclusions, because backups and legacy storage writes are also mutating endpoints. |
| EC6 / F6 | Still open; scope needs precision. | Character audio refs are walked but not validated. The existing optional asset-ref validator already handles malformed and persisted-missing ids while allowing empty/clear values. README's "every server asset field the bundle walker treats as a reference" is broader than F6 and exposes at least one additional drift candidate: `characterOrder.img` vs `imgFile`. |
| EC7 | Still open; summaries need alignment. | No invariant audit script, package script, or `ts-morph` dependency exists. The ladder scripts exist and `tauribuild` is absent. EC7 summaries omit EC1/import/assets while `closeout-buckets.md` includes them. Browser smoke patches IndexedDB/OPFS writes, not `localStorage`. |

## EC1 / F1 - Provider ownership

Status: still open.

The central finding remains valid: Fastify mode can still fall back to browser
provider dispatch after serving a masked projection.

Current evidence:

- `useServerGeneration` still defaults to `false` at
  `src/ts/storage/database.svelte.ts:773`.
- The setting still exists as a persisted/runtime setting at
  `src/ts/storage/database.svelte.ts:1347`,
  `src/ts/server/commands.ts:317`, and
  `server/fastify/src/routes/commands.ts:403`.
- Server completion is still gated at
  `src/ts/process/request/serverCompletion.ts:528`.
- If server completion returns `null`, browser dispatch still runs at
  `src/ts/process/request/request.ts:525`, including Google/Vertex dispatch
  around `src/ts/process/request/request.ts:551`.
- Bootstrap still returns a masked projection at
  `server/fastify/src/routes/bootstrap.ts:17`.
- Client-side Vertex refresh still writes into the projection at
  `src/ts/process/request/google.ts:553`.

Direction variables:

- The docs should not say all proxy/`xcustom` formats fall back. Server routing
  already supports several proxy/`xcustom` paths, including OpenAI-compatible
  (`src/ts/process/request/serverCompletion.ts:69`), Anthropic (`:281`),
  Mistral (`:314`), Cohere (`:341`), Responses (`:472`), and Legacy Instruct
  (`:506`). Gemini `reverse_proxy` / `xcustom` still stays local around `:359`.
- Server-side Vertex is not missing. Client routing builds `gemini.vertex` and
  posts through `/api/v1/generate/completion`
  (`src/ts/process/request/serverCompletion.ts:359`, `:868`, `:1079`), and
  Fastify token exchange/cache exists in
  `server/fastify/src/generation/vertexAuth.ts:98`.
- Keep the EC1 direction: remove or const-true the `useServerGeneration` gate in
  Fastify mode, make browser fallback unreachable, and remove the client-side
  Vertex token refresh write path.

## EC2 / F2 - Plugin durable storage

Status: still open.

The main exposure remains: Fastify-mode plugins still receive browser-local
durable APIs outside server ownership.

Current evidence:

- `SafeLocalStorage` writes browser `localStorage` under `safe_plugin_*` at
  `src/ts/plugins/pluginSafeClass.ts:9` and `:14`.
- `SafeLocalPluginStorage` wraps browser `localforage` at
  `src/ts/plugins/pluginSafeClass.ts:48` and `:54`.
- `SafeIdbFactory` opens/deletes prefixed IndexedDB databases at
  `src/ts/plugins/pluginSafeClass.ts:76`, `:91`, and `:94`.
- V2 exposes sandbox `localStorage` and `indexedDB` at
  `src/ts/plugins/plugins.svelte.ts:961`, `:962`, and constructs
  `SafeLocalStorage` at `:985` without a Fastify gate.
- V3 exposes `getLocalPluginStorage()` as `new SafeLocalPluginStorage()` at
  `src/ts/plugins/apiV3/v3.svelte.ts:1245`.
- Runtime info can report `platform: "fastify"` while `saveMethod` remains
  `"local"` at `src/ts/plugins/apiV3/v3.svelte.ts:1238` and `:1242`.

Direction variables:

- Normal plugin storage is already command-backed. Client dispatch exists at
  `src/ts/plugins/plugins.svelte.ts:621`, `:627`, `:641`, and `:647`; unknown
  keys bulk-dispatch at `:706` and `:716`; Fastify routes exist at
  `server/fastify/src/routes/commands.ts:3804`, `:3838`, and `:3871`, with
  coverage around `server/fastify/__tests__/commands.test.ts:4622`.
- Write-time reserved-key shadowing is partly blocked by
  `unsupportedServerBridgeKeys` at `src/ts/plugins/plugins.svelte.ts:591`,
  `:680`, and `:1016`.
- `pluginV2` remains in `allowedDbKeys` at
  `src/ts/plugins/plugins.svelte.ts:548` / `:553`, but no durable
  server-settings/command path was found.
- Read-time shadowing remains possible through the V2 `getDatabase` fallback at
  `src/ts/plugins/plugins.svelte.ts:993`, `:1000`, and `:1002`.
- No `pluginCompatibilityMode` implementation was found under `src` or
  `server`.
- `closeout-buckets.md` should revise "route the async KV
  (`SafeLocalPluginStorage`)" because normal async `risuai.pluginStorage` is
  already routed. The unresolved local async surface is specifically
  `getLocalPluginStorage()` / `SafeLocalPluginStorage`; the docs should say
  whether that API becomes server-backed, unsupported, or compatibility-gated.

## EC3 / F3 - JSON import normalization

Status: still open.

The JSON `{ database }` path still does not share the broad `.risu` current-shape
normalizer.

Current evidence:

- JSON import still accepts `body.database`, route-normalizes it, and applies it
  at `server/fastify/src/routes/save.ts:68`, `:69`, and `:70`.
- The route-local helper still only normalizes selected collections at
  `server/fastify/src/routes/save.ts:185`, `:192`, `:203`, `:211`, and `:213`.
- Multipart `.risu` import normalizes broadly before apply at
  `server/fastify/src/risuSave/importSnapshot.ts:47` and `:61`.
- `normalizeRisuSaveImportDatabase` is already exported at
  `server/fastify/src/risuSave/importSnapshot.ts:83`.
- The broad normalizer covers messages, personas, modules, plugins, plugin
  storage, lorebooks, and scripts around
  `server/fastify/src/risuSave/importSnapshot.ts:155-190`.
- `applyImportedDatabase` delegates to repository import without normalizing at
  `server/fastify/src/routes/save.ts:217`, `:222`, and `:223`.
- Bootstrap loads persisted data and masks secrets, but does not repair shape at
  `server/fastify/src/routes/bootstrap.ts:20` and `:24`.

Direction variables:

- Avoid "persists as-is"; the JSON branch persists a route-normalized inbound
  payload.
- Avoid "bootstrap serves unchanged"; it serves without shape repair, but still
  masks provider secrets.
- The implementation direction should say to pass the returned
  `normalizeRisuSaveImportDatabase(...)` value to `applyImportedDatabase`.
  Merely calling the function before apply is ambiguous because it returns a
  cloned normalized database.

## EC4 / F4 - Stable ids and prompt semantics

Status: still open.

Public replacement paths still repair durable child ids, and raw
`promptTemplate` replacement remains reachable.

Current evidence:

- Lorebook entry replacement still repairs ids:
  `server/fastify/src/commands/lorebooks.ts:165`, `:226`, and `:280`; public
  routes call it at `server/fastify/src/routes/commands.ts:3272`, `:3309`,
  `:3343`, and `:3916`.
- Script/trigger replacement still repairs ids:
  `server/fastify/src/commands/scriptDefinitions.ts:97`, `:104`, and `:130`;
  public routes call it at `server/fastify/src/routes/commands.ts:3950`,
  `:3984`, `:4018`, and `:4052`.
- Missing/invalid message `chatId` is still minted at
  `server/fastify/src/commands/messages.ts:68`; routes use it at
  `server/fastify/src/routes/commands.ts:2841`, `:3000`, and `:3035`.
- `promptTemplate` remains in prompt settings at
  `server/fastify/src/commands/prompts.ts:11` and is accepted as `array|null`
  at `:177`; the route reads/applies it at
  `server/fastify/src/routes/commands.ts:1328` and `:1341`.
- The known UI raw use remains at
  `src/lib/Setting/Pages/BotSettings.svelte:1455`.

Direction variables:

- Message duplicate rejection already exists at
  `server/fastify/src/commands/messages.ts:101` and `:158`, with coverage around
  `server/fastify/__tests__/commands.test.ts:3134`. Only missing/invalid
  `chatId` generation remains in the message case.
- `/prompt-items/*` CRUD/reorder already exists at
  `server/fastify/src/routes/commands.ts:1357`, `:1393`, `:1432`, and `:1466`,
  with events at `server/fastify/src/commands/events.ts:57` and server tests
  around `server/fastify/__tests__/commands.test.ts:1322`.
- Generic settings already rejects the `prompt` group:
  `server/fastify/src/routes/commands.ts:306`, `:4093`, with coverage around
  `server/fastify/__tests__/commands.test.ts:1000`.
- `closeout-buckets.md` should not say "remove the apply branch
  (`commands.ts:1328`)"; `:1328` reads prompt settings, while generic apply is
  around `:1341` / `:4184`. The work is to remove prompt-settings acceptance
  and validation for `promptTemplate`.
- EC7's "no command-path helper mints ids" wording is broader than the current
  F4 bullets because prompt-item create still mints ids at
  `server/fastify/src/commands/prompts.ts:64`. The docs should either define
  create commands as allowed to mint new root/child ids, or explicitly add
  prompt-item create to the audit/fix scope.

## EC5 / F5 - Conflict visibility and single active writer

Status: still open.

Higher-level wrappers still hide the first 409 conflict by replaying stale
payloads, and no active-writer lock exists.

Current evidence:

- `patchServerBackedSettings` retries the same patch after conflict at
  `src/ts/server/commands.ts:1038` and resends it around `:1040-1047`.
- `runServerCommand` retries after conflict at
  `src/ts/server/commands.ts:2145` and `:2151-2153`.
- Low-level conflict surfacing already exists:
  `src/ts/server/commands.ts:345` and `:2204`, with coverage around
  `src/ts/server/commands.test.ts:313`.
- Server command mutation bodies already require `baseRevision` at
  `server/fastify/src/commands/mutations.ts:28`, reject stale revisions around
  `:50-52`, and map revision mismatch to 409 at
  `server/fastify/src/routes/commands.ts:4194`.
- Bootstrap does not register a session; it returns revision/schema/database/
  assets at `server/fastify/src/routes/bootstrap.ts:17`.
- Client bootstrap and command requests send auth headers, not a session id, at
  `src/ts/server/bootstrap.ts:32` and `src/ts/server/commands.ts:2183`.
- A future 423 would currently fall through as a generic error at
  `src/ts/server/commands.ts:2212`, `src/ts/server/bootstrap.ts:51`,
  `src/ts/globalApi.svelte.ts:234`, and `src/ts/server/backups.ts:135`.

Direction variables:

- Do not imply lower-level conflict handling is missing; it exists. The bug is
  the high-level blind replay plus the lack of a single active writer.
- Do not imply only `runServerCommand` retries; `patchServerBackedSettings` has
  its own retry path.
- Command routes have base-revision/409 enforcement, but import and assets do
  not accept a base revision. Import applies at `server/fastify/src/routes/save.ts:48`,
  and asset upload mutates at `server/fastify/src/routes/assets.ts:35`.
- `closeout-buckets.md` should clarify route scope. If the intent is "all
  server-owned mutating routes", that includes backups
  (`server/fastify/src/routes/backups.ts:25`, `:46`, `:62`) and legacy storage
  write/remove endpoints (`server/fastify/src/routes/legacyStorage.ts:67`,
  `:88`) unless explicitly excluded.

## EC6 / F6 - Character asset-reference validation

Status: still open.

The bundle walker treats character audio fields as asset references, but
character create/patch validation still omits them.

Current evidence:

- The walker includes `vits.files.*` at
  `server/fastify/src/risuSave/assetReferences.ts:93` and `:122`.
- The walker includes `gptSoVitsConfig.ref_audio_data.assetId` at
  `server/fastify/src/risuSave/assetReferences.ts:95` and around `:141-143`.
- `validateCharacterAssetRefs` still validates only image, emotion images,
  additional assets, `ccAssets`, and `prebuiltAssetExclude` at
  `server/fastify/src/commands/characters.ts:371`.
- Create and patch are both affected through
  `server/fastify/src/routes/commands.ts:2144` and `:2182`.
- Existing tests cover older validated character asset fields around
  `server/fastify/__tests__/commands.test.ts:4777`, but not `vits.files` or
  `gptSoVitsConfig.ref_audio_data.assetId`.
- UI writes the correct server field at
  `src/lib/SideBars/CharConfig.svelte:1372`.

Direction variables:

- The server asset field is correctly documented as
  `gptSoVitsConfig.ref_audio_data.assetId`, not `ref_audio_path`.
- "Missing" should mean a syntactically valid SHA-256 asset id absent from
  persisted assets. The existing optional validator intentionally allows
  `undefined`, `null`, `""`, and `"-"` at
  `server/fastify/src/commands/assets.ts:7` and `:20`.
- Tighten the open-findings line reference for GPT-SoVITS from `:95/:135` to
  `:95` plus `:141-143`.
- README EC6 says `validateCharacterAssetRefs` covers every server asset field
  the bundle walker treats as a reference. That is broader than F6. One
  additional drift candidate is `characterOrder.img`, walked at
  `server/fastify/src/risuSave/assetReferences.ts:69`, while order validation
  checks `imgFile` at `server/fastify/src/commands/characters.ts:215`.
  The docs should either narrow EC6 to character create/patch audio refs or
  broaden the closeout bucket to all walker/validator drift.

## EC7 - Repeatable invariant audit

Status: still open.

No committed repeatable invariant audit exists.

Current evidence:

- `package.json` has no audit/invariant script in its script block
  (`package.json:9-21`).
- `ts-morph` is not present in dependencies or devDependencies
  (`package.json:23`, `:86`).
- The only `ts-morph` hits are documentation references in
  `docs/fastify/client-thinning/decisions.md:139` and
  `docs/fastify/client-thinning/closeout-buckets.md:82`.
- The verification ladder scripts do exist:
  `package.json:11`, `:13`, `:16`, `:17`, and `:21`.
- `tauribuild` is absent from package scripts; current docs correctly say not
  to use it as a gate.

Direction variables:

- Say "add and wire a ts-morph/rg audit script/package script" rather than
  implying the audit tooling already exists.
- Align EC7 summaries with the detailed spec. README/decisions summaries omit
  EC1, while `closeout-buckets.md` includes EC1 browser fallback and trusted
  projection-write checks at `docs/fastify/client-thinning/closeout-buckets.md:102`.
- Align route scope. The EC7 spec names command/import/asset-write guards, but
  EC5's actual mutating surface also includes backups and legacy storage unless
  those routes are consciously excluded.
- Browser smoke patches IndexedDB and OPFS write APIs at
  `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts:111-119` and asserts
  no records at `:267`, but it does not patch `localStorage`. Any "no local
  storage write audit" wording should be narrowed to IndexedDB/OPFS unless the
  smoke test is expanded.
- The ladder exists, but the agents did not rerun it for this audit.

## Carry-forward doc edits

Before implementation begins, update the direction docs to reflect these
variables:

1. EC1: replace broad proxy/`xcustom` fallback wording with provider-specific
   fallback wording.
2. EC2: distinguish server-backed `risuai.pluginStorage` from browser-local
   `getLocalPluginStorage()` / `SafeLocalPluginStorage`.
3. EC3: specify that JSON import must pass the returned broad-normalizer result
   to `applyImportedDatabase`.
4. EC4: clarify create-vs-replace id minting, and fix the prompt-settings line
   reference/wording.
5. EC5: define the active-writer guard's mutating-route scope, including whether
   backups and legacy storage are in or out.
6. EC6: decide whether EC6 is only the character audio-ref validator gap or the
   broader walker-vs-validator drift class.
7. EC7: align README/decisions/closeout-buckets on EC1 coverage, route scope,
   and the fact that the audit script/package script does not exist yet.
