# DL2 Pass 4 report — claude

Delta audited: `28eb3fb66..e1ac763da` at HEAD `e1ac763da`. Note on commit
placement: the three identity-normalization commits the charter names
(`c80c75126`, `d89b0c6d4`, `88066c2a8`) are ancestors of `28eb3fb66`
(they landed just before the closure-record commit); per the brief the live
code at HEAD was audited regardless. The only delta commit touching those
files is `942e6eb2a` (Agent toggles + lorebook inputs), which was audited
in full.

## Checks

- Bounded CharX imports (`dc84d3da1`, `85e808621`) — FINDING DL2-P4-1,
  FINDING DL2-P4-2 (both silent-truncation paths on this surface; the
  bounds themselves fail loudly). Loud-failure evidence: upload/hash errors
  collect into `errors` and reject `done()`
  (`src/ts/process/processzip.ts:301-314`, `:497-504`);
  `importCharacterProcess` awaits `done()` before creating the character
  (`src/ts/characterCards.ts:198`, `:209`) and `importCharacter` alerts on
  throw (`src/ts/characterCards.ts:143-145`); `saveAssets` throws on
  non-OK, count mismatch, and id mismatch
  (`src/ts/globalApi.svelte.ts:165-171`, `:296-311`); 429 retries are
  capped (`:322-336`) and every attempt carries a 5-minute timeout
  (`:338-347`), so backpressure waiters (`processzip.ts:458-471`) cannot
  hang forever — capacity is released in the flush `finally`
  (`processzip.ts:499-504`). A referenced-but-excluded asset makes the
  import throw at resolution (`src/ts/characterCards.ts:862-874`) —
  loud, though the generic "asset not found" message does not mirror
  `risusave_incomplete_blocks`' explicit truncation signal. Staged-asset
  cleanup on abort is delegated to the server reference-counting asset GC
  (content-addressed, 60-min mtime grace, 15-min sweep:
  `server/fastify/src/assetGc.ts:22-28`, `:354-437`,
  `server/fastify/src/app.ts:253-257`); the server realm-import side
  additionally deletes staged files inline on oversize
  (`server/fastify/src/routes/realmImport.ts:1237-1262`). See also
  free-hunt DL2-P4-F2 (GC grace vs. very long imports) and DL2-P4-F3
  (ignored per-entry unzip error argument).
- Character/lorebook identity normalization (`c80c75126`, `d89b0c6d4`,
  `88066c2a8`) — SAFE. Client normalization mints ids only on brand-new,
  not-yet-persisted imported objects before `dispatchCreateCharacter`
  (`src/ts/characterCards.ts:85-122`); `chaId` is always freshly minted at
  import (`src/ts/characterCards.ts:990`), so no pre-existing chats,
  assets, or `greeting_translations` rows can reference the rewritten ids —
  greeting rows key on `(character_id, greeting_index, settings_hash)` with
  `ON DELETE CASCADE` and never on chat/lorebook ids
  (`server/fastify/src/translation/greetingTranslationStore.ts:46-53`).
  Server-boundary repair mints ids at create/import boundaries only
  (`server/fastify/src/commands/characters.ts:98`, `commands/chats.ts:186`,
  `commands/modules.ts:86`, `routes/realmImport.ts:987`,
  `realmImport/characterCard.ts:171`, `:338`), and id-referencing
  operations fail loudly on any mismatch — `reorderLorebookEntriesById`
  validates full id coverage and throws
  (`server/fastify/src/commands/lorebooks.ts:554-578`). The identity-dirty
  scope contract is intact at HEAD: dirty scopes force whole-collection
  `replace` (`src/ts/server/lorebookBridge.svelte.ts:2159-2167`), dirty
  state clears only on accepted replace or canonical projection
  (`:321-350`, `:782`, `:3061-3065`), and no delta commit modified the
  bridge (only `942e6eb2a` touched adjacent files; it adds no per-entry
  command that bypasses the dirty check — agent lorebook inputs are
  read-only resolution, `src/ts/agentLorebookInputs.ts:31-104`).
- Post-import greeting display (`64acdef60`) — SAFE. Not literally
  read-only, but the single write is `chat.fmIndex ??= character.firstMsgIndex ?? -1`
  on freshly imported starter chats before first persistence
  (`src/ts/characterCards.ts:108`); it fills a missing display-selection
  default only (`??=`), touches no pre-existing data, and destroys nothing.

## Findings

### DL2-P4-1 — Oversized `module.risum` is silently dropped, losing the character's trigger/regex scripts
- Severity: medium / Confidence: certain
- Evidence: CharX export moves trigger and regex scripts out of `card.json`
  into `module.risum` and deletes them from the card
  (`src/ts/characterCards.ts:1561-1578`, deletes at `:1569-1570`). On
  import, any zip entry over 50MB is excluded without error — by declared
  size at `src/ts/process/processzip.ts:349-355` or cumulatively at
  `:383-385`/`:406-407` — and `excludedFiles` has no consumer anywhere
  (`grep`: only `processzip.ts:198`, `:437-438` assign it; nothing reads
  it). With `module.risum` excluded, `importer.moduleData` stays undefined
  and the import proceeds silently without it
  (`src/ts/characterCards.ts:195-208`), ending in the normal success flow.
  The lorebook itself survives via `card.json`'s `character_book` fallback,
  but `triggerscript`/`customScripts` exist only in `module.risum`.
- Loss scenario: user exports a character whose module data exceeds 50MB
  (large lorebook/loreCache payloads inflate the risum), or receives such a
  `.charx` → imports it → import completes with a success alert → the
  imported character durably lacks all trigger scripts and regex scripts;
  if the user then discards the source file believing the import complete,
  the scripts are gone. This is exactly the silent-truncation shape the
  check requires to fail loudly like `risusave_incomplete_blocks`.
  (Bound predates the delta — `4ab7b18cf` — but `dc84d3da1`/`85e808621`
  reworked this surface without adding the loud signal, and the check
  demanded verification at HEAD.)
- Fix direction: after `parse()`, fail the import (or at minimum raise a
  blocking warning listing `excludedFiles`) when `card.json`/`module.risum`
  or any card-referenced file was excluded, mirroring
  `RISUSAVE_INCOMPLETE_BLOCKS_ERROR`
  (`server/fastify/src/risuSave/importSnapshot.ts:54`).

### DL2-P4-2 — Oversized data-URI card asset dropped with a transient alert; import continues as success
- Severity: low / Confidence: certain
- Evidence: `src/ts/characterCards.ts:876-886` — a `data:` asset whose
  base64 exceeds ~50MB hits `alertError('Data URI too large'); continue`;
  the loop's next `alertStore.set` progress update (`:852-856`) and the
  final success alert overwrite the error, `resolvedAssetUris[i]` stays
  undefined, and the asset is skipped from the imported character
  (`:897-904`).
- Loss scenario: user imports a card carrying a large inline data-URI asset
  → the error flashes and is replaced by progress/success alerts → import
  reports success while the imported copy permanently lacks that asset
  (emotion image / additional asset / icon). Pre-delta origin
  (`2332a0c9a`), reported because the check requires no silent truncation
  on this surface at HEAD.
- Fix direction: treat the oversize as a hard import failure (throw like
  the `__asset:`/`embeded://` missing-asset paths at `:862-874`), or
  collect and surface a blocking post-import warning.

## Free-hunt findings

### DL2-P4-F1 — Agent-only repair silently destroys activation fields carried by imported cards
- Severity: low / Confidence: certain
- Evidence: in-delta `942e6eb2a`. Server-side, every lorebook repair
  boundary blanks `key`, `secondkey`, `alwaysActive`, `selective`,
  `useRegex` whenever `agentOnly === true` or
  `extensions.risu_agent_only === true`
  (`server/fastify/src/commands/lorebooks.ts:606-615`), and repair runs on
  snapshot/bootstrap/import normalization paths
  (`ensureAllChildLorebooks`/`ensureModuleCollection`/`ensureGlobalLorebookCollection`,
  `commands/lorebooks.ts:92-150`, `:64-90`) — not just on command-create
  payloads. Client card import does the same at conversion
  (`src/ts/characterCards.ts:1139-1153`), and export re-blanks on the way
  out (`:1181-1199`).
- Loss scenario: a card or `.risu` snapshot produced by a third-party tool
  (or an older/off-spec writer) carries `risu_agent_only: true` alongside
  meaningful activation keys → import/normalization silently rewrites the
  stored entry with empty keys and disabled activation → user later
  unchecks Agent-only and finds the keys gone (the UI toggle also does not
  restore them, `src/lib/SideBars/LoreBook/LoreBookData.svelte:357-373`).
  Fields are non-functional under agent-only semantics and the source file
  survives, hence low; but the destruction is silent (repair paths bypass
  the loud `ValidationError` that request-payload validation throws at
  `commands/lorebooks.ts:683-690`).
- Fix direction: on repair paths, prefer clearing the `agentOnly` flag when
  activation fields are non-empty (data-preserving) or log/surface the
  destructive rewrite the way `repairCreatedLorebookEntries` warns about
  minted ids (`commands/lorebooks.ts:291-299`).

### DL2-P4-F2 — Asset-GC grace window can reclaim staged assets of an import still in flight
- Severity: medium / Confidence: speculative (unconfirmed link: a real
  import whose wall time from first asset upload to character commit
  exceeds 60 minutes)
- Evidence: CharX/PNG imports upload all assets to the server during
  streaming/resolution and only create the referencing character at the
  very end (`src/ts/characterCards.ts:85-101` via `dispatchCreateCharacter`
  after `await importer.done()` at `:209`; server realm import likewise
  commits at the end, `server/fastify/src/routes/realmImport.ts:965+`).
  The GC deletes unreferenced assets once file mtime exceeds
  `ASSET_GC_GRACE_MS = 60 min` (`server/fastify/src/assetGc.ts:28`,
  `:380-407`) and sweeps every 15 min
  (`server/fastify/src/app.ts:253-257`). The delta's bounding work
  (`dc84d3da1`, `85e808621`) lengthens worst-case import wall time
  (32MB queue backpressure, per-attempt 5-min timeouts, up to 3
  Retry-After-honoring 429 retries per operation,
  `src/ts/globalApi.svelte.ts:113-115`, `:322-336`).
- Loss scenario: user imports a multi-GB CharX over a slow/rate-limited
  link → first asset batches land at T0, import still running at T0+60min
  → a GC sweep deletes those assets (metadata + bytes) as unreferenced
  orphans past grace → import completes and the character durably
  references now-missing sha ids → images/audio permanently broken until
  the user re-imports the source file.
- Fix direction: refresh staged-asset mtimes (or take a GC-visible
  in-flight import lease) while an import session is active, or scale the
  grace window against active import sessions.

### DL2-P4-F3 — CharX importer discards the per-entry unzip error argument
- Severity: low / Confidence: speculative (fflate's per-entry error
  delivery semantics not verified end-to-end)
- Evidence: `src/ts/process/processzip.ts:363` —
  `file.ondata = (_err, dat, final) => this.#handleFileData(...)` ignores
  `_err`; `#handleFileData` (`:376-392`) has no error path. A corrupt
  entry that errors without a `final` callback never enqueues its asset and
  never records an error; if the entry is unreferenced by `card.json` the
  import completes clean without it (referenced entries still throw at
  `src/ts/characterCards.ts:862-874`, which bounds the blast radius).
- Loss scenario: corrupt zip entry for a non-referenced asset (or a
  mid-stream decompression error surfacing as `dat = null`, which would
  instead crash the push loop with an unrelated TypeError) → asset omitted
  or import aborted with a misleading error; no durable pre-existing data
  is destroyed, hence low/hygiene.
- Fix direction: route `_err` into `this.errors` (and terminate the entry)
  so `done()` rejects with the real cause.

## Not examined

- `.risu` snapshot import / device restore round-trip machinery
  (`risuSave/importSnapshot.ts`, `repository.ts` backup paths) — Pass 1's
  surface; touched here only to cite `RISUSAVE_INCOMPLETE_BLOCKS_ERROR` and
  the repair-at-normalization call sites.
- Deep review of the server realm-import pipeline beyond the size-bounding
  and staged-file-cleanup spot checks cited above (the pipeline predates
  the delta; only its lorebook-repair lines changed in the named commits).
- `convertOffSpecCards` field-completeness (pre-delta, no delta changes).
- fflate internals (streamed unzip error-delivery contract) — bounded to
  the observable handler wiring in DL2-P4-F3.
- Client hub-realm import UI flows other than the `importCharacterProcess`
  entry point (the only client `CharXImporter` construction site at HEAD is
  `src/ts/characterCards.ts:181`).
