# Report F — Import/export formats & UI-visible flows (CLAUDE track)

Delta audited: `f2dc174f4..HEAD` (177 commits). Baseline: worktree
`/home/codex/risu-baseline-71c476e9c` (fork point `71c476e9c`). All current-side
citations are against HEAD (`8bf88e43c`). "Baseline" below always means the
fork-point worktree, never `~/Risuai`.

Method: enumerated every delta commit touching card/CharX/CHAT/preset/save
import-export code and the two named UI flows, read both sides of each change,
and traced acceptance/rejection and exported-content deltas. No files other
than this report were created or modified.

---

## F-1 — CharX/card imports now reject whole files the fork point imported with partial content (med)

**Origin:** `932386424` (oversized zip entries, oversized inline data-URIs) and
`babaaa2db` L6 (per-entry decompression errors). Not present in ADJUDICATION.md.

**Current behavior:**
- Any CharX zip entry exceeding the 50 MiB per-entry bound aborts the whole
  import with `character_card_incomplete_import`:
  `src/ts/characterCards.ts:280-283` (throw when `importer.excludedFiles.length > 0`),
  exclusion recorded at `src/ts/process/processzip.ts:471`.
- Any CCv3 inline `data:` asset whose base64 payload is ≥ 50 MiB aborts the
  whole import: `src/ts/characterCards.ts:997-1002`
  (`throw oversizedDataUriImportError(...)`). This applies to CharX, PNG, and
  JSON card imports (the limit is threaded through `importCharacterCardSpec`).
- A zip entry that fails decompression is routed to `#handleFileError`
  (`src/ts/process/processzip.ts:378-381, 414-424`), which records the error;
  `done()` then rejects (`processzip.ts:316-325`) and the import throws at
  `src/ts/characterCards.ts:274-283`.

**Baseline behavior:**
- Oversized entries were pushed to `excludedFiles` and silently skipped; the
  character imported without them
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/processzip.ts:365-366`;
  `excludedFiles` is never read by the baseline import path,
  `.../src/ts/characterCards.ts:80-160`).
- Oversized data-URIs produced `alertError('Data URI too large')` and
  `continue` — import proceeded minus that asset
  (`.../src/ts/characterCards.ts:871-876`).
- Per-entry decompression errors were discarded: `file.ondata = (_err, dat,
  final) => this.#handleFileData(...)`
  (`.../src/ts/process/processzip.ts:339`); the errored entry simply never
  completed and the rest imported.

**User-visible consequence / repro:** Original Risu's CharX writer has no
per-entry size bound (`.../src/ts/process/processzip.ts` `CharXWriter.write`),
so Original happily exports a card with, e.g., a 60 MB video asset. At the fork
point that file imported (minus the oversized asset, with at most a transient
alert); at HEAD the import fails entirely with an error naming the file. Same
for a charx with one corrupt/deflate-broken member: fork point imported the
rest, HEAD rejects. Applies to file imports and Realm `realm.charx` downloads
(`src/ts/characterCards.ts:2064-2069`).

**Charter classification:** stricter-than-baseline acceptance on surface 4
(import formats) — a compat break even with a nice message. The change is a
deliberate DL2 anti-silent-truncation fix (C9/L6) but is not among the standing
individual decisions in ADJUDICATION.md. Verdict recommendation: `decide`
(candidates: keep the loud rejection, or keep-partial-import-with-loud-warning
to restore fork-point acceptance).

**Confidence:** high (both sides read directly; regression tests in
`src/ts/characterCards.pngImport.test.ts` encode the new rejection).

---

## F-2 — Original `.risup`/preset JSON imports became prompt-only: model selection dropped, sampler values inert (med)

**Origin:** `a14730dac` (in delta). Not in ADJUDICATION.md; not a DL2 item.

**Current behavior:** the only preset import entry points
(`src/lib/Setting/botpreset.svelte:722`, `src/App.svelte:178`) route legacy
full presets to `addImportedPromptPreset`
(`src/ts/storage/database.svelte.ts:7153-7157`), which filters the payload
through `promptPresetExportPayload` (`src/ts/presetSplit.ts:300-311`):
- Model/connection fields (`aiModel`, `subModel`, `koboldURL`,
  `textgenWebUI*URL`, `modelProfiles`, `openrouterRequestModel`,
  `customAPIFormat`, `useInstructPrompt`, …) are discarded entirely — they are
  in `MODEL_PRESET_FIELDS` (`presetSplit.ts:5-71`) but not in the prompt
  payload, and no model preset is created.
- Sampler fields (`temperature`, `top_p`, `top_k`, penalties, `NAISettings`, …)
  are copied as prompt-preset override fields but apply only when
  `overrideModelParameters === true`
  (`src/ts/storage/database.svelte.ts:6706-6713`,
  `src/ts/presetSplit.ts:389-394`); imports never set that flag
  (`extractPromptPresetModelOverrideFields`, `presetSplit.ts:257-265`, copies
  it only if the source file already has a boolean — Original files never do).
  So imported sampler values are stored but inert.
- Only the "others" override family (jsonSchema, fallbackModels, modelTools,
  additionalParams, …) still applies on selection
  (`database.svelte.ts:6714-6718`).
- The NAI (`presetVersion >= 3`) and SillyTavern JSON import branches now also
  terminate in `addImportedPromptPreset`
  (`database.svelte.ts:7052`, `7151`), so their converted sampler values are
  inert the same way.

**Baseline behavior:** `importPreset` pushed the full legacy object into
`db.botPresets`
(`/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:2298-2330,
2457`; NAI branch `:2345`), and selecting the preset applied everything —
model, connection URLs, and samplers.

**Pre-delta fork behavior (showing this is a delta regression):** at
`f2dc174f4`, payloads carrying model-only fields were routed through
`addImportedLegacyPreset`, which created a linked model-preset half AND set
`promptPreset.overrideModelParameters = true` ("Legacy full presets always
applied their parameter values") —
`git show f2dc174f4:src/ts/storage/database.svelte.ts` lines 6194-6222 and
7055-7060. `a14730dac` deleted that routing and the
`hasModelPresetOnlyFields` detector.

**User-visible consequence / repro:** export any preset from Original Risu as
`.risup`, import it at HEAD, select it, send a message: the request goes out on
whatever model preset is currently active, with the active model's temperature
and top_p — not the imported preset's model/sampler values as at the fork
point (and as at `f2dc174f4`). Surfaces 2 and 4.

**Charter classification:** `decide`. The commit documents the boundary as
intentional, but under the 2026-08-12 bar intent alone does not adjudicate it,
and there is no maintainer row for it. A middle option exists: restore the
`addImportedLegacyPreset` routing for payloads with model-only fields (the
code is still live at `database.svelte.ts:6270-6298` and used by the ST-chat
converter, `src/ts/process/prompt.ts:582,660`).

**Confidence:** high.

---

## F-3 — Chat exports refuse cold-storage stub chats instead of exporting (low)

**Origin:** `babaaa2db` (DL2 C8; fix commit, not a standing decision row).

**Current behavior:** `assertChatsReadyForExport`
(`src/ts/characters.ts:454-461`) throws a localized error naming the chats
(`src/lang/en.ts:1079`) before any download from both `exportChat`
(`characters.ts:491`) and `exportAllChats` (`characters.ts:1117`), which also
gates the export-then-reset flow.

**Baseline behavior:** cold storage exists at the fork point with the same
stub mechanics
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/coldstorage.svelte.ts:20,
299-300`), and `exportChat` serialized whatever was in the chat object with no
stub check (`.../src/ts/characters.ts:192-232`) — a cold chat exported as a
corrupt pointer-stub JSON that silently lost the conversation.

**User-visible consequence / repro:** a user with an aged (cold) chat picks
"Export as JSON" without opening it first: fork point produced a file
(contents: stub), HEAD raises "open the chat first" and produces nothing.

**Charter classification:** stricter export acceptance, data-loss-protective;
baseline behavior was silent corruption. Recommendation: `keep` (needs
maintainer confirmation since C8 is not in ADJUDICATION.md's standing list).

**Confidence:** high.

---

## F-4 — Kobold endpoint joining is not fork-point parity for path-bearing URLs (low)

**Origin:** `59f4b3552` (in delta). The WORK-INDEX row
(`docs/audit/WORK-INDEX.md:126`) records it as fixing the fork's own
`/api/v1/api/v1/generate` duplication; the commit does not claim, and does not
achieve, byte parity with baseline URL semantics.

**Current behavior:** segment-aware suffix join
(`server/fastify/src/generation/kobold.ts:78-96`): missing tail segments of
`api/v1/generate` are appended to any base path.

**Baseline behavior:**
`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:959-962` —
pathname shorter than 3 chars is replaced with `api/v1/generate`; any other
pathname is used **verbatim** as the POST target.

**Divergence matrix (same `koboldURL` input → request URL):**
- bare host → identical (`/api/v1/generate` both sides).
- `http://h/api/v1` → baseline POSTs `/api/v1` (a request real Kobold 404s →
  generation failed at fork point); HEAD POSTs `/api/v1/generate` (works).
  This case is delta-introduced behavior (pre-delta fork produced
  `/api/v1/api/v1/generate`, also failing).
- custom path, e.g. `http://h/my-kobold-proxy` → baseline POSTs the URL
  verbatim (works for users whose reverse proxy maps that path); HEAD POSTs
  `/my-kobold-proxy/api/v1/generate` (breaks them). NOTE: this half predates
  the delta (`git show f2dc174f4:server/fastify/src/generation/kobold.ts`
  lines 74-84 already appended `/api/v1/generate` to any path lacking it), so
  it is reported here as an adjacent pre-existing divergence needing its own
  ledger row, not as a delta regression.

**Charter classification:** surface 2 (outgoing request URL differs for
identical inputs). For the `/api/v1` case recommendation is `keep`
(baseline emitted an unusable request); the verbatim-custom-path case should
get an explicit `decide`, since baseline supported arbitrary complete URLs and
current code cannot express them.

**Confidence:** high on mechanics (both functions read in full; regression
tests `server/fastify/__tests__/kobold.test.ts` cover the three delta shapes).

---

## F-5 — Fork-exported cards now carry live activation config on Agent-only lorebook entries; they activate in Original Risu (low)

**Origin:** `24899a0dc` (DL2 L5; in delta).

**Current behavior:** V2/V3 card export keeps `keys`, `secondary_keys`,
`constant`, `selective`, `use_regex` on entries flagged
`risu_agent_only`/`agentOnly` (`src/ts/characterCards.ts:1305-1320` for
createBaseV2, `:1788-1800` for createBaseV3), relying on readers to filter the
extension flag. Import likewise preserves activation config
(`characterCards.ts:1263-1280`).

**Baseline behavior:** the agent-only concept does not exist at the fork point
(no `risu_agent_only`/`agentOnly` hits anywhere in
`/home/codex/risu-baseline-71c476e9c/src/`), and Original's import reads
`keys`/`constant`/`selective` while ignoring unknown extension flags
(`.../src/ts/characterCards.ts:940-1010` region, `convertCharbook`).

**User-visible consequence / repro:** author a card at HEAD with a lorebook
entry marked Agent-only (keys populated, or `alwaysActive`), export as
PNG/CharX, open it in Original Risu at the fork point: the entry is a normal
active lorebook entry and injects into prompts. Before this delta commit the
fork exported such entries with blanked keys/flags, so they stayed inert in
Original. Strictly this is new-feature semantics in a foreign reader (fork
point could not author such entries), so it is not a fork-point parity break
for fork-point-authored content — but it changes what the fork's export format
means to Original readers, which is squarely this brief's direction 2.

**Charter classification:** `decide` (options: current representation with the
cross-app caveat documented, vs. exporting agent-only entries in inert form
and stashing the author config under the extension). Low severity: affects
only cards using the fork-only flag, shared back to Original.

**Confidence:** high.

---

## F-6 — `prebuiltAssetExclude` export/import rewriting (informational, no Original-visible change)

**Origin:** `bcc9727db` (in delta).

**Current behavior:** on export, exclusion references are rewritten to the
packaged asset URIs (`src/ts/characterCards.ts:114-121`, applied at `:1668`);
on import, references are resolved to imported server asset IDs and
unresolvable ones are discarded (`characterCards.ts:123-148`, applied at
`:1159-1163`).

**Baseline behavior:** exclusions were exported verbatim as internal storage
keys (`/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:1641`) and
imported verbatim (`:1009`); since imported assets get fresh storage paths,
the exclusion list never matched after any round-trip and
`{{chardisplayasset}}` filtering silently degraded to "show everything"
(`.../src/ts/cbs.ts:1497-1500`).

**Original-visible consequence:** none — a fork-exported card in Original has
non-matching exclusion strings exactly as a baseline-exported card did (inert
either way); within the fork, round-trips now preserve exclusions (an
improvement). Persisted-field content differs from what fork-point export
would have written (packaged URIs vs. stale keys; discarded vs. retained stale
entries on import), so it is recorded here for the ledger.

**Charter classification:** `keep` (baseline behavior was accidental breakage;
user-visible outcome in Original equivalent).

**Confidence:** high.

---

## Visibility notes (already-decided or pre-delta; NOT new findings)

- **Standalone CHAT save blocks reject (`43ac4a1cc`).** The rejection itself
  predates the delta (`6f71dcc0f`, pre-`f2dc174f4`); the delta only added the
  typed 422 + localized diagnostic
  (`server/fastify/src/risuSave/importSnapshot.ts:92-100, 208-209`,
  `server/fastify/src/routes/save.ts`). Baseline's own decoder has **no** CHAT
  case in its block switch
  (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/risuSave.ts:515-560`) —
  fork-point Original silently dropped such chats and imported the rest — and
  fork-point Original's writer never emits CHAT blocks (enum only,
  `risuSave.ts:97`), so only saves from **newer** upstream versions can
  trigger it. Backed by the documented 2026-08-11 no-conversion decision;
  listed for ADJUDICATION.md visibility only.
- **Ooba Legacy streaming stays buffered (`59f4b3552`).** Baseline streamed
  Ooba Legacy over WebSocket
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:704-720`);
  current is buffered-only with disabled UI toggles + notice
  (`server/fastify/src/prompt/chatDispatch.ts:1580-1583`,
  `src/lib/Setting/Pages/BotSettings.svelte`). Backed by "Decision 2026-08-11"
  (`docs/audit/WORK-INDEX.md:127`), but that decision is absent from
  ADJUDICATION.md's standing list — recommend adding a row rather than
  re-litigating.
- **Bundle-export secret warning (`babaaa2db` D1)** — standing decision
  (ADJUDICATION.md), not re-reported.
- **Exported prompt presets gain an `archived` key (`babaaa2db` C12,
  `src/ts/presetSplit.ts:308`).** Original's importer spreads the payload over
  `presetTemplate` and keeps unknown keys inert
  (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:2317`);
  no Original-visible effect. (Prompt-only preset export *content* predates
  the delta — `git show f2dc174f4` shows identical `downloadPreset` — so it is
  out of this brief's delta scope; only the import side regressed, see F-2.)
- **App ToS flow removed (`faa276c38`).** Realm downloads now gate on Realm
  terms (`alertRealmTerms`, `src/ts/characterCards.ts:1988`) instead of the
  removed application ToS. First-run/product decision, not a format; noted for
  completeness.
- **`de4c1e3ec` (streamsaver static import + chunk-preload alerts) and
  `ada629f01`/`f6df8cb1e`/`16842f066`** carry `Ported-from:` upstream hashes —
  out of scope per charter (upstream-sync reference, not fork-point).

## Areas swept and found clean (explicit)

- **`cc0a862af` truthful creation/import completion:** no new file-shape
  validation anywhere in the diff (`src/ts/characterCards.ts`,
  `src/ts/characterCommands.ts:765-880`, `src/ts/characters.ts:140-176`). The
  JSON off-spec fallback (`char_name`/`char_persona`/`char_greeting`,
  `characterCards.ts:255-258`), TavernAI-V1 PNG fallback
  (`characterCards.ts:477-484`), and rcc-encrypted paths all still accept
  exactly what baseline accepted. Newly-surfaced rejections occur only when
  the server layer refuses/queues the create (writer loss, staging failure) —
  conditions that pre-delta produced a *phantom success* for the same file and
  that cannot occur at the fork point (no server). No enumerable
  newly-rejecting file shapes.
- **CHAT file import (`importChat`, `src/ts/characters.ts:750-940`):**
  untouched by the delta (no diff hunks); `risuChat` ver 1/2, `risuAllChats`
  ver 1/2, jsonl, and html `.idat` acceptance identical to `f2dc174f4`. The
  only delta change is additive tolerant parsing of the fork-only
  `modelPresetSelectionSource` field (`characters.ts:975-979`).
- **CHAT export JSON shape:** still `{type:'risuChat', ver:2, data, folders}`
  (`characters.ts:513-527`), byte-compatible with baseline
  (`baseline characters.ts:226-231`); all-chats still
  `{type:'risuAllChats', ver:2, data, folders}` (`characters.ts:1118-1126`).
- **Card export writers:** v2 `chara` PNG chunk, v3 `ccv3` chunk, CharX
  `card.json`+`module.risum` layout, asset naming (`chara-ext-asset_:N`,
  `embeded://assets/...`, `x_meta/`) all unchanged in the delta
  (`src/ts/characterCards.ts:1390-1719` vs. baseline `1234-1520` — the only
  delta hunks are F-5 and F-6 above). No v27-v31-era fields leak into card
  JSON (`createBaseV2`/`createBaseV3` delta hunks contain only the agent-only
  change).
- **.risu save/bundle export writers:** `exportSnapshot.ts` and
  `bundleExport.ts` have zero delta commits; the block writer emits only
  baseline-decodable block types (`exportSnapshot.ts:125-192`). The v29-v31
  tables (generation operations/effects, command_events, finalization
  retries, memory_*) live only in the fork-only SQLite bundle
  (`server/fastify/src/repository.ts:2764-2796`) and never enter the portable
  `.risu` database; the DL2 allowlist CI test guards new tables. The
  `__risuServerData` root key predates the delta.
- **Bundle import (`23d3e98f6`):** acceptance unchanged — the commit
  validates/propagates the server's `assetReport` and changes completion
  *messaging* only (`src/ts/server/backups.ts`; asset-report reader rejects
  nothing file-driven, it validates the fork server's own response).
- **`e8c038044` (DL2 C11/C13/C14/L7):** request_history caps, portable
  greeting-translation row attribution, asset-GC grace, tolerant rewrite
  reader — all operate on fork-only data (greeting_translations is v27,
  fork-only); no Original-format acceptance or content change.
- **Translation display (`4ed196b1f`):** `autoTranslateBotOnly` does not exist
  at the fork point (zero hits in the baseline tree); the commit only splits
  display vs. request eligibility for that fork-only mode
  (`src/lib/ChatScreens/Chat.svelte:860-867`). With the toggle off (the only
  state expressible at fork point), display eligibility is `autoTranslate ===
  true`, matching pre-delta and baseline bilingual behavior. No fork-point
  divergence.
- **Preset envelope compatibility:** HEAD still writes
  `presetVersion: 2` + rpack + `encryptBuffer(...,'risupreset')`
  (`src/ts/storage/database.svelte.ts:6945-6954`) — byte-format readable by
  baseline `importPreset` (`baseline database.svelte.ts:2309-2318`). Envelope
  *validation* on import (`Invalid preset envelope`) predates the delta
  (`dee4bea7d`, pre-`f2dc174f4`).
- **Credential-sentinel row drop (`babaaa2db` L4):** only rows carrying the
  literal `__RISU_SECRET_MASKED__` sentinel are dropped; Original saves can
  never contain it (fork-only sentinel). Clean.
- **Preset secret scrub (`a72d0a680`):** operates on stored
  bot_presets/model_presets rows carrying fork-era `modelProfiles` secrets;
  the six inline keys baseline's `downloadPreset` strips are still stripped
  identically at HEAD (`database.svelte.ts:6936-6941` vs. baseline `2254-2259`).
  No Original-format content change in the delta.

## Could not verify

- No live Original Risu instance was run; all "Original reads this" claims are
  static analysis of the baseline worktree's importers (I read every cited
  reader path, but did not execute round-trips end-to-end).
- Whether `importModelPresetCommand` (`src/ts/server/commands.ts:2585`) has any
  reachable UI path that could re-import the model half of an Original preset —
  I found none (grep over `src/`), but a dynamically-dispatched path could have
  escaped the search; F-2's severity assumes there is none.
- Baseline cold-storage *entry* conditions (when a chat goes cold) were not
  traced in detail for F-3; the finding relies on the stub representation and
  export path, which are verified on both sides.
- `charxJpeg` export readback in Original (unchanged in the delta; not
  exercised).
- Whether the 2026-08-11 WORK-INDEX decisions (Ooba streaming, standalone CHAT
  blocks, no-queued-state-machine) were maintainer-issued in the
  charter-required individual sense — the docs say "Decision 2026-08-11" and
  memory records the work-index review with the user, but ADJUDICATION.md does
  not list them; Stage 4 should confirm and add rows.
