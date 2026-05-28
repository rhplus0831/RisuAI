# Open Findings

Date: 2026-05-28

Status: **closed 2026-05-28.** Findings B1-B10 were discovered by the
2026-05-28 verification audit after the
[`../client-thinning-alpha-3/`](../client-thinning-alpha-3/) closeout. The
Alpha 4 closeout fixed every finding with structural audit gates or
focused regression tests. No Alpha 4 findings remain open. See
[`final-audit.md`](./final-audit.md).

## Summary

| Finding | Severity | Criterion           | Status |
| ------- | -------- | ------------------- | ------ |
| B1 - Composite command fan-out at seven unfixed call sites | Medium  | A4EC1 / A4EC2 | **Closed 2026-05-28** (all seven sites routed through `runOptimisticCommandSequence`) |
| B2 - Public lorebook create transitively mints entry ids | High    | A4EC1 / A4EC3 | **Closed 2026-05-28** (no-mint `validate*` helpers replace the repair-permissive constructors on the 5 red routes) |
| B3 - `ensure*Collection` repair-on-read mints ids reachable from command routes | Medium  | A4EC1 / A4EC3 | **Resolved 2026-05-28 by classification** (audit treats `ensure*`/`normalize*` as non-propagating with arg-provenance check) |
| B4 - Backup omits `data/risu.db` (SQLite memory database)                       | Medium  | A4EC1 / A4EC4 | **Closed 2026-05-28** |
| B5 - Backup omits `data/save/` (legacy storage directory)                       | Medium  | A4EC1 / A4EC4 | **Closed 2026-05-28** |
| B6 - `auth.knownKeyHashes` grows unboundedly                                    | Medium  | A4EC1 / A4EC5 | **Closed 2026-05-28** |
| B7 - `saveAsset` callers ship no filename for non-PNG bytes                     | Medium  | A4EC1 / A4EC6 | **Closed 2026-05-28** |
| B8 - `getFileSrc` Fastify fallback returns arbitrary URL strings                | Low     | A4EC1 / A4EC7 | **Closed 2026-05-28** |
| B9 - `/chats/:chatId/lorebooks` skips global chat normalization                 | Low (defense in depth) | A4EC1 / A4EC8 | **Closed 2026-05-28** |
| B10 - `repairPresetRecord` is dead but exported                                 | Low     | A4EC1 / A4EC3 | **Closed 2026-05-28** (export deleted) |

## B1 - Composite Command Fan-out at Six Unfixed Call Sites

Severity: **Medium**

A3F12 closed `dispatchCompatibleChatUpdate` with focused regression tests and an
explicit "no R-rule needed" decision. The same anti-pattern - two or more
`runServerCommand` / `dispatch*` invocations against a shared optimistic
snapshot without serialization - exists at six other call sites. Each is a
race against the cached server-command revision; the second/third call
receives 409 and rolls back the optimistic snapshot, leaving the partial
mutation visible until the next SSE refresh.

Evidence:

- `src/lib/SideBars/SideChatList.svelte:246-248` - folder drag `Sortable.onEnd`
  in server-mode dispatches `dispatchReorderChatFoldersByIds(...)` then
  `dispatchReorderChatsByIds(...)` back-to-back on the same `previous`
  snapshot.
- `src/ts/process/triggers.ts:2211-2213` and `:2261-2263` - `v2ModifyLorebook`
  and `v2SetLorebookActivation` both call `setCurrentCharacter(char)` (which
  itself dispatches a character update) then
  `dispatchReplaceCharacterLorebooks(char.chaId, char.globalLore ?? [], ..., 0)`
  with `delayMs = 0`.
- `src/ts/process/sendChatContext.ts:72-93` - on first send after a missing
  `chatId` migration, dispatches `dispatchUpdateCharacter` for
  `lastInteraction` then `dispatchReplaceMessages` for the backfill.
- `src/ts/process/modules.ts:540-548` - `applyModule()` dispatches up to three
  `dispatchReplace*` commands (`Lorebooks`, `Scripts`, `Triggers`) with shared
  pre-snapshot.
- `src/ts/process/mcp/risuaccess/modules.ts:493-499` -
  `ModuleHandler.setModuleInfo` fires `dispatchUpdateModule` and
  `dispatchEnableModule` for the same module without awaiting.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:288-308` and
  `src/ts/server/lorebookBridge.svelte.ts:387-407` - `queueReplacement` keys
  schedules by independent strings; when one `$effect` cycle dirties two keys
  (a common pattern for combined data + metadata updates) both timers fire in
  the same tick with `delay = 0`.

The already-closed serialization helper `runChatCommandSequence`
(`src/ts/chatCommands.ts:100-114`) is the template for the fix. The audit gate
must enforce the class - "no function issues ≥2 unawaited mutating commands
against a shared optimistic snapshot" - rather than the specific call site.

Closeout direction:

- Route every multi-dispatch site through a shared sequencer (existing
  `runChatCommandSequence`, or a generalized `runOptimisticCommandSequence`).
- Or replace the multi-dispatch site with a single composite server command if
  atomicity is required (e.g. folder + chat reorder ought to be one server
  endpoint).
- Add the structural audit rule.

## B2 - Public Lorebook Create Transitively Mints Entry Ids

Severity: **High**

`POST /api/v1/commands/lorebooks` accepts `body.lorebook` and calls
`createGlobalLorebookRecord(body.lorebook)` at
`server/fastify/src/routes/commands.ts:3173`. That helper at
`server/fastify/src/commands/lorebooks.ts:134-145` invokes
`repairLorebookEntries(lorebook.data ?? [], '${label}.data')` (line 142),
which routes nested entries through `createLorebookEntryRecord(..., { repairId: true })`
(line 262), which mints `entry.id = randomUUID()` when the input lacks an id
(line 325).

A client POST of `{ lorebook: { id: "lb", data: [{ key: "k", content: "c" }] } }`
silently mints UUIDs for every entry. The route response only echoes
`lorebookId` (line 3188), so the client cannot learn the minted entry ids.

This is the exact A3F3/A3F4 invariant class - command-path durable id minting
that the client cannot predict - but reached transitively through the
non-`repair*`-prefixed wrapper `createGlobalLorebookRecord`. A3R3 only flags
direct identifier calls to `repair*`-prefixed helpers from
`routes/commands.ts`, so this path is invisible to the current audit.

Closeout direction:

- Switch the `data` validation on the create path to require client-supplied
  entry ids (no `repairId: true`), or split the helper so the create path uses
  a non-minting validator.
- Audit rule must follow transitive calls from each public command route
  handler and fail on any reachable `randomUUID()`.

## B3 - `ensure*Collection` Repair-on-read Mints Ids Reachable from Command Routes

Severity: **Medium** (depends on chosen semantics)

A class of normalization helpers in `server/fastify/src/commands/` mints
durable ids by `randomUUID()` when pre-existing on-disk rows have missing or
duplicate ids:

- `ensurePresetCollection` (`commands/presets.ts:131-158`, randomUUID at lines
  139 and 140).
- `ensureGlobalLorebookCollection` (`commands/lorebooks.ts:45-71`, randomUUID
  at line 62 via `repairGlobalLorebookRecord`).
- `ensureModuleCollection` (`commands/lorebooks.ts:107-132`, randomUUID at
  lines 122 and 124).
- `ensureCharacterCollection` (`commands/characters.ts:52-104`, randomUUID at
  line 93).
- `ensureTranslatorPresetCollection`
  (`commands/translatorPresets.ts:20-63`, randomUUID at line 44).

Each is called from many public command route handlers in
`server/fastify/src/routes/commands.ts`. The minting only fires for
pre-existing degraded on-disk state (missing/duplicate ids), never for the
client's request payload - the client payload validators (`createPresetRecord`,
`createCharacterRecord`, etc.) still reject missing or duplicate ids.

This is therefore one of two things, and the docs do not currently say which:

1. **A violation** of `decisions.md` A3EC2 ("public command routes must not
   call repair helpers that can mint ids"), because the helpers transitively
   do. The fix is to move repair-on-read out of the command path: either run
   it once during a controlled bootstrap normalization, or reject command
   requests that find degraded state.
2. **Acceptable fail-shut repair**, because the client payload contract is
   intact and the minting only fixes legacy degraded persisted state. The fix
   is documentation: declare in `decisions.md` that command-path
   `ensure*Collection` minting is allowed for legacy repair, and have the
   audit rule classify it explicitly.

Alpha 4 must pick one in [`decisions.md`](./decisions.md) before implementing
A4EC3.

Closeout direction: see decisions.md A4EC3.

## B4 - Backup Omits `data/risu.db` (SQLite Memory Database)

Severity: **Medium**

`server/fastify/src/repository.ts:216-238` (`createBackup`) writes `db.json`
and copies `assets/` into the snapshot directory.
`server/fastify/src/repository.ts:257-297` (`restoreBackup`) restores those
two only.

`server/fastify/src/db.ts:37-67` opens `data/risu.db` (SQLite), which holds
the schema-version revision counter and the hypa-v3 memory tables
(`memory_chunks`, `memory_summaries`, `memory_embeddings`, `memory_jobs`;
declarations at `server/fastify/src/db.ts:149-213`).

Restore re-bumps the revision via `bumpRevision`
(`repository.ts:295`) but leaves the memory tables in their **post-snapshot**
state. A user who creates a backup, runs memory ingestion, and restores keeps
the post-snapshot memory rows while the `db.json` references whatever set the
backup captured. Same correctness class as A3F8 (server backups not preserving
asset bytes) for a different durable store.

No regression coverage in `server/fastify/__tests__/backups.test.ts` exercises
memory-table round-trip across restore.

Closeout direction:

- Snapshot and restore `data/risu.db` atomically alongside `db.json` and
  `assets/`.
- Audit rule enumerates `dataDir` children and asserts each is in
  `createBackup` / `restoreBackup`.

## B5 - Backup Omits `data/save/` (Legacy Storage Directory)

Severity: **Medium**

`server/fastify/src/routes/legacyStorage.ts:14-18` creates and writes
`data/save/` for the legacy `/api/v1/storage/{write,read,list,remove}`
routes. `createBackup`/`restoreBackup` never copies that directory; its
contents disappear from any restore.

`src/ts/globalApi.svelte.ts:290-293` (`saveDb`) is a no-op in Fastify mode,
but `src/ts/storage/risuSave.ts:400` ("remotes/${name}.local.bin") and other
explicit forageStorage write paths can still land bytes in `data/save/` via
the legacy storage commands.

Closeout direction: same fix as B4. Audit rule enumerates the directory
inventory.

## B6 - `auth.knownKeyHashes` Grows Unboundedly

Severity: **Medium**

`server/fastify/src/auth.ts:7-12` declares
`knownKeyHashes: Set<string>`. `server/fastify/src/auth.ts:46-51`
(`registerPublicKey`) adds a hash on every successful login and writes the
JSON-serialized Set to disk. There is no eviction, no TTL, no soft cap.

A long-running server with a churning device pool (ephemeral key pairs from
misbehaving or short-lived clients, automation, etc.) accumulates trusted
hashes forever, in-memory and on-disk. This is the A3F13 class - unbounded
in-process accumulator - that A3F13 closed only for the command event sink.

No audit rule covers process-lifetime accumulators.

Closeout direction:

- Add either a soft cap with LRU eviction or a last-seen TTL on
  `knownKeyHashes`.
- Audit rule flags any process-lifetime Set/Map/Array in `server/fastify/src/`
  declared as `private`/`const` at module/class top level that lacks a
  documented eviction policy.

## B7 - `saveAsset` Callers Ship No Filename for Non-PNG Bytes

Severity: **Medium**

`src/ts/globalApi.svelte.ts:206-262` (`saveAsset`) defaults to `png` when no
filename is supplied (line 217). A3F10 fixed one non-image caller (the ONNX
transformer importer) by passing `.onnx`; the same omission exists at multiple
other non-image callers:

- `src/ts/characterCards.ts:728` - VITS audio files: `saveAsset(... base64 bytes)` with no filename.
- `src/ts/characterCards.ts:669,699` - emotion images at multiple call sites.
- `src/ts/characterCards.ts:592` - `/none.webp` placeholder image (would be persisted as `.png` though it is WebP).
- `src/ts/process/processzip.ts:405` and `:427` - generic zip-entry asset uploads.
- `src/ts/process/modules.ts:219` - module asset payloads.

VITS payloads are audio/model files, not PNGs; the persisted metadata records
`image/png` + `.png` even when the bytes are e.g. WAV or ONNX. Bundle export
later writes those bytes with the wrong extension.

Closeout direction:

- Each non-image caller passes a real filename (using the source key/extension
  or a known type).
- Image callers may keep the PNG default but must be explicitly classified.
- Audit rule enumerates `saveAsset` call sites and asserts each is in a
  classified list (image-default or filename-required).

## B8 - `getFileSrc` Fastify Fallback Returns Arbitrary URL Strings

Severity: **Low** (no auth header attached, but a database fingerprinting
vector)

`src/ts/globalApi.svelte.ts:148-159` returns the raw `loc` for `http://`,
`https://`, `data:`, and `/api/v1/assets/` prefixes, and otherwise falls back
to `serverAssetUrl(loc) ?? loc` for unknown shapes. The fallback returns the
raw `loc` for unknown shapes in Fastify mode.

This does not attach `risu-auth` (so it is not an A3F7 leak), but it
contradicts the "asset gate through `/api/v1/assets`" framing from A3F7. A
poisoned database value routed through `<img src>` causes the browser to
fetch from an attacker-controlled origin.

Closeout direction:

- Reject unknown shapes in Fastify mode; return a known placeholder or throw
  (matching A3F7's `readServerAssetBytes` discipline).
- Audit rule asserts that every Fastify branch of every asset-URL helper
  returns only documented shapes.

## B9 - `/chats/:chatId/lorebooks` Skips Global Chat Normalization

Severity: **Low (defense in depth)**

`PUT /api/v1/commands/chats/:chatId/lorebooks` at
`server/fastify/src/routes/commands.ts:3424-3460` calls
`normalizeSelectedChatLorebooks(target, chatId)`
(`server/fastify/src/commands/lorebooks.ts:285-300`), which only invokes
`ensureCharacterCollection` (per-character `chaId` dedupe), then
`requireChatLocation` (global resolver, first match wins).

Every other globally-addressed chat route calls `normalizeAllCharacterChats`
first, so persisted chat ids are globally unique in practice. But if any
future writer ever skips global normalization, this route will write
`localLore` to the wrong duplicate chat. A3R4 cannot detect this drift
because its trigger is text match on the legacy create-time pattern, not
"every resolver call is preceded by a normalize call."

Closeout direction:

- Add the `normalizeAllCharacterChats` call before `requireChatLocation` in
  this route.
- Audit rule: every route calling `requireChatLocation` /
  `requireMessageLocation` must be preceded by the matching global
  normalization in the same handler.

## B10 - `repairPresetRecord` Is Dead but Exported

Severity: **Low**

`server/fastify/src/commands/presets.ts:189-197` exports
`repairPresetRecord`. `rg "repairPresetRecord" server/ src/` shows no
production callers. The dead export survives because A3R3 only flags direct
identifier calls in route handlers, not stale exports.

A drive-by PR can re-introduce id minting in one line. Documentation in
`open-findings.md` (Alpha 3) still claims the helper is "used only by
import/bootstrap normalization paths"; that is no longer accurate.

Closeout direction:

- Delete the export, since it is unused.
- Or update the audit to flag any **import** of an id-minting helper into a
  route file, not just call sites.

## Audit Notes And Exclusions

- Runtime-local caches (MCP display, translation/model caches, embedding
  caches, inlay assets, plugin permission prompts) are still explicitly out of
  scope per the original phase-9 closeout.
- The Alpha-3 ladder remains green; the verification confirmed that. The B
  findings are not regressions of A3F#; they are class extensions or new
  classes the prior audit did not measure.
