# Decisions

Date: 2026-05-28

These are the binding decisions for Alpha 4. Each criterion records the
default decision, the why, and the acceptable alternative.

## A4EC1 - Audit Is Invariant-Derived {#a4ec1}

**Decision:** Rewrite `util/client-thinning-audit.ts` so every check derives
its surface from one of:

1. **Authoritative source structure**: `SECRET_PATHS` in
   `server/fastify/src/providerSecrets.ts`; the asset-walker collector table
   in `server/fastify/src/risuSave/assetReferences.ts`; the route registrations
   under `server/fastify/src/routes/`; the `data*Dir` sibling enumeration in
   `server/fastify/src/repository.ts`; the export declarations under
   `server/fastify/src/commands/`.
2. **Call-graph walks** rooted at known boundaries: command route handlers,
   passive-refresh entrypoints, asset-URL helpers, `saveAsset` callers,
   `dispatch*` / `runServerCommand` invocations in one scope.
3. **Class assertions** about long-lived state: any
   process-lifetime mutable Set/Map/Array in `server/fastify/src/` declared as
   module/class top-level requires a documented eviction policy.

Each rule must include:

- A one-sentence statement of the **invariant** it enforces.
- A **before/after** comment block showing the regression class it catches and
  the canonical fix shape.
- A test fixture or focused regression test demonstrating the rule failing
  on the pre-fix tree and passing after the fix.

**Why:** Alpha 3 closed each finding with a rule that fired on the literal
pre-fix shape. Every rule then admitted a sincere regression (rename,
alias, restructure) that bypassed the gate while preserving the bug. The
verification audit found six such bypass paths in A3R1-A3R7 alone, plus six
unfixed call sites of A3F12's class. The loop will not end until the audit
asserts the invariant.

**Acceptable alternative:** keep a narrow rule only if (a) the invariant
genuinely depends on a one-shot pre-fix shape (no class extension is
possible), and (b) the rule is annotated as `narrow:` with the explicit
rationale. Default is to reject narrow rules.

## A4EC2 - Composite Command Fan-out Is Serialized {#a4ec2}

**Decision:** Every function that issues two or more mutating server
commands (`runServerCommand`, `dispatch*` that wraps `runServerCommand`)
against a shared optimistic snapshot routes them through a sequencing helper.

The canonical sequencer is `runChatCommandSequence`
(`src/ts/chatCommands.ts:100-114`). For multi-resource sequences a
generalized `runOptimisticCommandSequence(commands)` is added.

The six known fan-out sites in B1 are closed by routing through the
sequencer. Where atomicity matters (e.g. folder + chat reorder), the
preferred fix is a single composite server endpoint; the sequencer is a
fallback when the server contract cannot be widened.

**Why:** A3F12 closed `dispatchCompatibleChatUpdate` with a focused
regression test and the explicit decision that no R-rule was needed. The
verification audit found five sibling call sites that share the same
optimistic snapshot with no serialization. Without a structural rule the
class will keep growing; the cost of a generalized rule is low because every
fan-out call site has the same shape (≥2 `dispatch*` in one scope with no
intervening `await` on the previous response).

**Acceptable alternative:** a single composite server command per call site
removes the fan-out at the source. Either is acceptable; the audit rule
fails on the structural fan-out either way.

## A4EC3 - No Command-Path Id Minting, Including Transitively {#a4ec3}

**Decision:** Two sub-decisions.

**4EC3a (the B2 path):** Public command route handlers must not transitively
mint durable ids in response to client request payloads. The fix for
`POST /commands/lorebooks` is to require client-supplied entry ids on
nested `data` (no `repairId: true` for that flow). The audit rule walks the
call graph from each `routes/commands.ts` handler and fails on any reachable
`randomUUID()` / `nanoid()` / `uuidv4()` unless the call site is in a
classified `import/bootstrap-only` set.

**4EC3b (the B3 path):** `ensure*Collection` repair-on-read minting is
**permitted** in command routes as a fail-shut repair of legacy degraded
persisted state, **provided** the client payload validator path has no
minting and the repair is documented and audited. The classification is:

- `ensure*` helpers in `server/fastify/src/commands/` are in the
  `repair-on-read` allowlist if they only mint for missing/duplicate
  pre-existing on-disk rows, never for client request payload fields.
- The audit asserts every classified helper still only mints for on-disk
  state by checking that its arguments do not include any value derived from
  the route request body.

**Why (4EC3a):** This is the same A3F3/A3F4 invariant class. The fix path is
client-supplied ids, matching the rest of the Alpha 3 closeout.

**Why (4EC3b):** `ensure*` helpers are reachable from every command route
that loads the resource family; rewriting them to never mint requires a
controlled one-shot bootstrap normalization that does not currently exist.
The repair-on-read class is a fail-shut behavior (degraded persisted state
becomes consistent), not a contract-bypass behavior (the client payload
contract is intact). Documenting and classifying it is the right tradeoff;
deferring the bootstrap-normalize rewrite to a future workstream is
acceptable.

**Acceptable alternative (4EC3b only):** implement a one-shot bootstrap
normalization that runs `ensure*Collection` once at process start (or on
schema-version bump) and remove the repair-on-read from every command path.
This is the stricter fix and the larger change; it is not chosen for Alpha 4.

## A4EC4 - Backups Preserve Every Server-Owned Data Directory {#a4ec4}

**Decision:** `createBackup` snapshots and `restoreBackup` restores **all**
of:

- `db.json` (already covered).
- `assets/` (already covered).
- `risu.db` (SQLite memory database).
- `data/save/` (legacy storage directory).
- Any future sibling directory of `dataDir`.

Restore is atomic across all four. If restore fails mid-flight the previous
state is preserved.

The audit rule enumerates `dataDir` siblings at audit time (by reading the
`repository.ts` `dataDir` initialization code and listing the child paths
referenced anywhere in `server/fastify/src/`) and asserts each appears in
`createBackup` and `restoreBackup`.

**Why:** A3F8 closed the assets case. The same correctness model applies to
every server-owned data directory. The reason the audit missed it is the
A3F8 closeout was a focused-test contract decision, not a structural rule
covering the directory inventory.

**Acceptable alternative:** declare `risu.db` as "best effort, not part of
backup contract" and document it in user-facing UI. Rejected because the
memory tables are tied to `db.json` references and the mismatch corrupts
downstream behavior.

## A4EC5 - In-Memory Accumulators Are Bounded {#a4ec5}

**Decision:** Every process-lifetime mutable Set/Map/Array in
`server/fastify/src/` that grows in response to request traffic has an
eviction policy: a soft cap with LRU eviction, a TTL, or an explicit
"intentionally unbounded; user-paced growth" classification.

The B6 case (`auth.knownKeyHashes`) gets a soft cap of 4096 entries with LRU
eviction by last-seen. The existing serialized JSON file format is preserved
(the bound is applied before write).

The audit rule walks every top-level declaration in
`server/fastify/src/**/*.ts`, classifies each mutable collection by whether
its writers are reached from request handlers, and fails on any unclassified
write-from-handler collection.

**Why:** A3F13 closed the command event sink in isolation. The class
extends to any in-memory writer reachable from request traffic. A
structural rule on top-level declarations is the right granularity.

**Acceptable alternative:** none for the rule. For the cap value, 4096 is a
conservative default; any documented number is acceptable.

## A4EC6 - `saveAsset` Callers Declare Honest Metadata {#a4ec6}

**Decision:** Every `saveAsset` call site in `src/` is classified as either:

- **image-default**: the caller is an image upload that may omit a filename
  and accept the PNG default. The audit enumerates these and asserts no new
  ones are added unclassified.
- **filename-required**: the caller passes a real filename (or the
  underlying source's key/extension) so the server records the honest
  content-type and extension.

The known non-image callers (VITS, emotions, processzip, modules) move to
filename-required. The `/none.webp` image case keeps `.webp` even if it goes
through saveAsset (today it does not - it loads a baked-in URL - but if it
ever did, the classification would be image-default for `.png` PR or
explicit `.webp` filename).

**Why:** A3F10 fixed the ONNX caller in isolation. The class extends to
every non-PNG byte payload. The audit must enumerate `saveAsset` callers and
assert each is in the classified list.

## A4EC7 - Asset Read URL Gate Is Narrow {#a4ec7}

**Decision:** `getFileSrc` and any sibling asset-URL helper that returns a
URL for `<img>`/`<source>` in Fastify mode return only:

- A raw 64-char server asset id (mapped to `/api/v1/assets/<id>`).
- A legacy `assets/<sha>.<ext>` path (mapped to `/api/v1/assets/<id>`).
- A `data:` URL.
- A `blob:` URL minted in the current page.
- An already-absolute `/api/v1/assets/...` URL.

Unknown shapes throw or return a documented placeholder. No raw
`http://`/`https://` pass-through unless explicitly classified.

**Why:** A3F7 closed `readServerAssetBytes`. `getFileSrc` is the parallel
path for rendered URLs. The "asset gate through `/api/v1/assets`" framing
in A3F7 only holds if every URL helper enforces the same gate.

**Acceptable alternative:** allow `https://` for known-trusted prefixes
(e.g. hub asset CDN) with explicit classification. Default rejects.

## A4EC8 - Every Globally-Addressed Mutation Normalizes First {#a4ec8}

**Decision:** Every route handler that calls a global-resolver helper
(`requireChatLocation`, `requireMessageLocation`, `chatIdExists`,
`messageIdExists`, `chatFolderIdExists`, or any future global resolver)
calls the matching global normalization (`normalizeAllCharacterChats`,
`normalizeAllChatMessages`) in the same handler before the resolver.

The B9 case (`/chats/:chatId/lorebooks` calling
`normalizeSelectedChatLorebooks` instead of `normalizeAllCharacterChats`) is
the visible drift; the audit rule covers the general class.

**Why:** A3F5 enforced normalization at write time across most routes, but
"most" is what re-opens. A structural rule is one line per resolver and
catches future drift.

## A4EC9 - Docs Reflect Current State {#a4ec9}

**Decision:** `docs/fastify/status.md` and `docs/fastify/status/next-steps.md`
are reconciled only after Alpha 4 closes the full ladder and writes
`final-audit.md` / `history.md`. Stale Alpha-3 wording in
`docs/fastify/client-thinning-alpha-3/open-findings.md` ("repairPresetRecord
is now only used by import/bootstrap normalization paths") is corrected when
B10 closes.

**Why:** Standard rule-first sequencing. The verification audit found at
least one stale Alpha-3 doc claim contradicted by code; do not propagate it
to broader status docs until the underlying claim is true again.
