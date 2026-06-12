# Decisions

The recorded decision and rationale for each exit criterion in
[`README.md`](README.md). This is the "why" record; the contract itself
lives in the criteria table.

## EC1 — Provider ownership

**Decision:** Server-owned generation + hard-blocked browser fallback.
Remove the `useServerGeneration` toggle (const-true in Fastify mode).
Unsupported provider formats return an explicit "not supported in server
mode" error rather than silently dispatching with masked placeholders.
Vertex token refresh moves server-side; masking stays.

**Why:** Masking provider secrets is only honest if no browser path
needs them. While server generation is opt-in and partial, non-server-
routable formats (notably Gemini `reverse_proxy`/`xcustom`) and preview
bodies fall back to the browser, so masked secrets break those flows.
Of the three reconciliations — (A) server-own + block, (B) stop masking,
(C) per-key scoped masking — only A keeps the stated security
invariant. Removing the toggle removes the whole class.

## EC2 — Plugin durable storage

**Decision:** Durable plugin storage stays on the already-server-backed
`risuai.pluginStorage`; the three device-local sandbox APIs — sync
`localStorage` (`SafeLocalStorage`), IndexedDB (`SafeIdbFactory`), and
the local async `getLocalPluginStorage()` / `SafeLocalPluginStorage` —
are disabled in Fastify mode. An opt-in **Plugin Compatibility Mode**
restores those device-local APIs:

- Account-wide, command-backed server setting (not a browser-local
  flag, which would be self-undermining).
- When on, restores the three device-local APIs; `risuai.pluginStorage`
  remains server-backed and toggle-independent.
- Relaxes storage location only, never resource ownership: the
  `unsupportedServerBridgeKeys` guard, the `pluginV2` fix, and
  reserved-key shadowing protection stay enforced in both states.
- UI: under Advanced Settings → "not recommended", with a warning that
  the data is device-local, unsynced, and excluded from server
  backup/export.

**Why:** A safe, honest default with an explicit, discouraged escape
hatch beats silently breaking plugins or silently weakening the
invariant. Bulk/unknown-key persistence and write-time reserved-key
shadowing are already server-backed/blocked.

## EC3 — Import current shape

**Decision:** In the JSON import path, pass the returned normalized
clone from `normalizeRisuSaveImportDatabase` (`importSnapshot.ts`) to
`applyImportedDatabase`; delete the narrow route-local normalizer. The
shared normalizer always produces the block-export-required families:
`characters`, `botPresets`, `modules`, `loadouts`, and `plugins` as
arrays plus `pluginCustomStorage` as an object.

ROOT_COMPONENT blocks whose `key` is a reserved family
(`characters`, `botPresets`, `modules`, `loadouts`, `plugins`,
`pluginCustomStorage`, `__directory`) are rejected. Non-reserved
ROOT_COMPONENT fields continue to import as top-level database fields.

**Why:** The bug is a duplicate normalizer drifting out of sync —
exactly the "closed, then rediscovered" pattern. Unifying on one
normalizer removes the entire class. JSON import and `.risu` import
share the durable boundary; their shapes must agree.

## EC4 — Stable-id validation + prompt items

**Decision (4a — split helpers):** Each id helper splits into `repairX`
(import only, may mint ids) and `validateX` (command path, rejects
missing/duplicate). Create commands require a client-supplied id (no
server-side minting). The split is structural — not a shared helper
with an `allowRepair` flag — so the audit can identify which side may
mint.

**Decision (4b — subtractive):** Remove `promptTemplate` from the
prompt-settings command; the `/prompt-items/*` CRUD/reorder commands
are the only editing path. Preset switch carries `promptTemplate`
server-side via `applyPreset`. The one raw client use (enable toggle
`{ promptTemplate: [] }`) routes through a command.

**Why (4a):** The audit candidate is literally "no command-path helper
calls `randomUUID()`." That audit only works if the command validators
never call it — which the split guarantees and a boolean flag defeats.
A shared-helper-with-a-flag is also how repair leaked into commands in
the first place.

**Why (4b):** `promptTemplate` is an id-bearing child array, not a
scalar setting — editing it through the scalar settings patch is a
category error that bypasses per-item id validation. The fix is
subtractive (remove the redundant settings path).

## EC5 — Single active writer

**Decision:** A session-based single-writer lock, not a
conflict-resolution page. Port the `Risuai-NodeOnly` reference commit
`1c1d7bc6dc0bbe8e176730dd6b6b894ea1d8033b` to Fastify: mint a
per-page-load session id; register the active writer on
**bootstrap/page-load** (last-loader wins); reject non-active sessions
with **423** on every server-owned mutating route (commands, import,
assets, backups, legacy storage); the client reacts on 423 by notifying
and reloading. Remove the blind 409 replay as a backstop.

Passive SSE bootstrap refresh does **not** register write ownership.
Bootstrap has two registration modes; only page-load/user-intent
bootstrap may register.

**Why:** Risu was not designed for multi-device use; a 409 almost
always means a stale tab on another device, and the user is usually
aware. Conflicts are rare and self-inflicted — prevent the write at
the source rather than build machinery to resolve it after. The lock
collapses the whole problem: no overwrite-vs-reload UX, no rebase, no
retry-safety classification. Only the stale device's un-persisted
local edits are dropped on reload, and those were made after the user
moved on.

Browser-triggered memory mutation entrypoints (memory job create/cancel,
`POST /api/v1/generate/chat`, `POST /api/v1/generate/preview-prompt`)
are durable server-owned mutations and route through the same lock.
Background worker writes (job claim, summary completion, embeddings)
are classified as internal continuation and are exempt.

## EC6 — Asset reference validation

**Decision:** Extend `validateCharacterAssetRefs` to cover every field
walked by `assetReferences.ts`, including `vits.files.*` (iterate the
dynamic map) and `gptSoVitsConfig.ref_audio_data.assetId`. Reuse the
optional-asset-ref validators with reject-on-missing. The validator is
shared by create and patch, so additive fields cover both.

Optional asset clears keep `undefined`, `null`, `""`, and `"-"`;
malformed asset ids and valid-looking missing persisted asset ids are
rejected.

**Why:** The export/bundle walker defines which persisted strings the
server treats as durable asset references. Unchecked writes there make
export the first place users see missing-asset failures.

## EC7 — Globally scoped identity

**Decision:** Chat folder ids are globally unique in command-written
state. Creation rejects a folder id already used by any character;
import/bootstrap normalization rewrites legacy duplicates after
per-character chat repair and updates same-character chat `folderId`
references.

Chat ids and message ids are globally unique or parent-scoped in
current-shape data. The public route contract remains globally
addressed; import/bootstrap repair normalizes to global uniqueness, and
command-create/fork rejects ids already used under another parent.

Every route handler calling a global resolver
(`requireChatLocation`, `requireMessageLocation`, `chatIdExists`,
`messageIdExists`, `chatFolderIdExists`, or any future one) calls the
matching global normalization (`normalizeAllCharacterChats`,
`normalizeAllChatMessages`) in the same handler before the resolver.

**Why:** Current resolvers return the first match globally;
parent-local uniqueness is not enough unless routes include the parent
id and validate it. Enforcing global uniqueness on create is less
disruptive than changing public route shapes. A structural rule on
normalization-before-resolver catches future drift in one line per
resolver.

## EC8 — Masked secret row identity

**Decision:** Masked secret placeholders in arrays restore only through
stable row identity: `botPresets.id`, `customModels.id`,
`authRefreshes.url`, and `characters.chaId`. If a masked placeholder
cannot prove identity (target row missing identity, duplicate identity,
or no source row), the command is rejected.

**Why:** Index-based restoration is safe only when array shape and
order are unchanged. Phase 9 lets many arrays be edited and reordered
by command, so index restore can transplant secrets across rows.

## EC9 — Asset persistence and read gate

**Decision (persistence):** When `addAsset` sees existing metadata but
the blob file is missing, the upload heals the missing file (re-writes
the bytes) instead of returning metadata-only success. Idempotent
same-asset upload semantics are preserved.

**Decision (read gate):** `getFileSrc` and any sibling asset-URL helper
that returns a URL for `<img>`/`<source>` in Fastify mode return only:

- A raw 64-char server asset id (mapped to `/api/v1/assets/<id>`).
- A legacy `assets/<sha>.<ext>` path (mapped to `/api/v1/assets/<id>`).
- A `data:` URL.
- A `blob:` URL minted in the current page.
- An already-absolute `/api/v1/assets/...` URL.

Unknown shapes throw or return a documented placeholder. No raw
`http://` / `https://` pass-through unless explicitly classified.

**Decision (`saveAsset` metadata):** Every `saveAsset` call site is
classified as either **image-default** (caller is an image upload that
may omit a filename and accept the PNG default) or
**filename-required** (caller passes a real filename so the server
records the honest content-type and extension). Known non-image
callers (VITS, emotions, processzip, modules, transformer ONNX) are
filename-required.

**Why:** A metadata row without a readable blob is not a usable
server-owned asset. The asset-gate-through-`/api/v1/assets` framing
holds only if every URL helper enforces the same gate. PNG-default
behavior for non-image bytes corrupts content-type/extension all the
way through bundle export.

## EC10 — Composite command fan-out

**Decision:** Every function issuing ≥2 mutating server commands
(`runServerCommand`, `dispatch*` wrapping `runServerCommand`) against
a shared optimistic snapshot routes them through a sequencing helper.
The canonical sequencer is `runChatCommandSequence`
(`src/ts/chatCommands.ts:100-114`); a generalized
`runOptimisticCommandSequence(commands)` covers multi-resource
sequences. Where atomicity matters (e.g. folder + chat reorder), a
single composite server endpoint is preferred; the sequencer is the
fallback when the server contract cannot be widened.

**Why:** Fan-out call sites share a structural shape (≥2 `dispatch*`
in one scope with no intervening `await` on the previous response).
Without a structural rule the class keeps growing one call site at a
time.

## EC11 — No command-path id minting (transitive)

**Decision (lookup-side):** Public command route handlers must not
transitively mint durable ids in response to client request payloads.
The audit walks the call graph from each `routes/commands.ts` handler
and fails on any reachable `randomUUID()` / `nanoid()` / `uuidv4()`
unless the call site is in a classified `import/bootstrap-only` set.

**Decision (`ensure*` helpers):** `ensure*Collection` repair-on-read
minting is **permitted** in command routes as fail-shut repair of
legacy degraded persisted state, **provided** the client payload
validator path has no minting and the repair is documented and
audited. The audit asserts every classified helper still only mints
for on-disk state — its arguments cannot derive from the route request
body.

**Why:** The strict "client supplies all ids" rule matches the
optimistic-projection model. Repair-on-read for degraded persisted
state is a fail-shut behavior (degraded state becomes consistent), not
a contract-bypass behavior; documenting and classifying it is the
correct tradeoff. The stricter alternative — a one-shot bootstrap
normalization that runs `ensure*Collection` once at process start — is
a larger change deferred to a future workstream.

## EC12 — Backups cover every server-owned data directory

**Decision:** `createBackup` snapshots and `restoreBackup` restores
**all** of `db.json`, `assets/`, `risu.db` (SQLite memory database),
`data/save/` (legacy storage), and any future sibling of `dataDir`.
Restore is atomic across all four; if restore fails mid-flight the
previous state is preserved.

The audit rule enumerates `dataDir` siblings at audit time (by reading
the `repository.ts` `dataDir` initialization code and listing child
paths referenced anywhere in `server/fastify/src/`) and asserts each
appears in `createBackup` and `restoreBackup`.

**Why:** The asset case was closed early; the same correctness model
applies to every server-owned data directory. The original miss was a
focused-test contract decision, not a structural rule covering the
directory inventory.

## EC13 — Bounded in-memory accumulators

**Decision:** Every process-lifetime mutable Set/Map/Array in
`server/fastify/src/` that grows in response to request traffic has an
eviction policy: a soft cap with LRU eviction, a TTL, or an explicit
"intentionally unbounded; user-paced growth" classification.

The known case (`auth.knownKeyHashes`) gets a soft cap of 4096 entries
with LRU eviction by last-seen. The existing serialized JSON file
format is preserved (the bound is applied before write).

**Why:** The command event sink closed in isolation. The class extends
to any in-memory writer reachable from request traffic. A structural
rule on top-level declarations is the right granularity.

## EC14 — Repeatable invariant audit

**Decision:** `util/client-thinning-audit.ts` derives every check from
one of:

1. **Authoritative source structure** — `SECRET_PATHS` in
   `providerSecrets.ts`; the asset-walker collector table in
   `assetReferences.ts`; route registrations under
   `server/fastify/src/routes/`; the `data*Dir` sibling enumeration in
   `repository.ts`; the export declarations under
   `server/fastify/src/commands/`.
2. **Call-graph walks** rooted at known boundaries — command route
   handlers, passive-refresh entrypoints, asset-URL helpers,
   `saveAsset` callers, `dispatch*` / `runServerCommand` invocations.
3. **Class assertions** about long-lived state — any process-lifetime
   mutable Set/Map/Array in `server/fastify/src/` declared at
   module/class top-level requires a documented eviction policy.

Each rule includes:

- A one-sentence statement of the invariant it enforces.
- A before/after comment block showing the regression class it catches
  and the canonical fix shape.
- A committed pre-fix fixture file and a `*.test.ts` that runs the
  rule against the fixture and asserts non-zero exit.
- A documented "bypass-class" test: the original finding rewritten to
  bypass a hypothetical narrow rule.

**Why:** Closing each finding with a rule that fires on the literal
pre-fix shape lets every rewrite/rename/restructure bypass the gate
while preserving the bug. The audit must assert the invariant, not the
past fix. Reproducible structural tests are what stops the
close/reopen cycle for real.

**Acceptable alternative:** A narrow rule may stand only if (a) the
invariant genuinely depends on a one-shot pre-fix shape (no class
extension is possible), and (b) the rule is annotated as `narrow:`
with the explicit rationale. Default is to reject narrow rules.
