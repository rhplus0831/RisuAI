# Human Wakeup: Redefine Phase 9

Date: 2026-05-28

Status: Phase 9 should stay open. The repeated close/reopen cycle is not an
agent discipline problem by itself; it is a scope-definition problem. The
current codebase has already fixed the first visible blocker set, but deeper
audits keep finding additional violations because "Phase 9 complete" has been
treated as a checklist of known writes rather than as a small set of enforceable
server-projection invariants.

## Short Answer

Yes, Phase 9 is larger than the current closeout loop assumes.

The phase should be redefined from:

> Close the remaining direct-write and Fastify persistence bugs.

to:

> In Fastify-served web mode, the browser is only a projection of server-owned
> durable state. Bootstrap, generation, imports, plugin storage, commands,
> assets, and conflict handling must all preserve that invariant.

The old definition lets the agent close one known bucket, rerun green tests,
and mark the phase complete. The new definition gives the agent a stable
boundary: Phase 9 is done only when the server-projection contract is true and
covered by regression tests.

## Why The Loop Keeps Repeating

Recent history shows a pattern:

- The first rework fixed nine concrete issues, including nested secret masking,
  character-module persistence, stale trusted-write aliases, plugin DB bridge
  narrowing, welcome setup persistence, `verbosity`, DevTool autopilot,
  malformed RISUSAVE errors, and asset upload revision events.
- The follow-up audit then found a different class of issues: provider dispatch
  ownership, plugin-local durable storage, JSON import normalization, stable-id
  command semantics, blind conflict retry, and missing asset validation.
- The committed Fastify docs still contain "complete" language, while the
  working rework README reopens Phase 9 with unresolved findings.

That means the agent is not merely missing the same item repeatedly. It is
closing local symptoms while the global invariant remains underspecified.

## Redefined Phase 9 Invariants

Phase 9 should be considered complete only if all of these are true in
Fastify-served web mode:

1. Bootstrap is a projection, not an authority leak.
   - Secrets masked from `/api/v1/bootstrap` must not be required by any
     browser-side durable or provider-dispatch path.
   - If provider secrets are masked, provider calls must be server-owned.

2. Browser durable writes go through commands or import routes.
   - Direct projection writes are either impossible or intentionally wrapped as
     optimistic local projection updates followed by command/import persistence.
   - Durable browser-local storage must not remain authoritative for server
     resources.

3. Plugin-visible durable state is server-owned or explicitly unsupported.
   - Plugin DB bridge keys must map to commands, be routed to server plugin
     storage, or be rejected in Fastify mode.
   - Plugin sandbox APIs must not expose `localStorage`, localForage, or
     IndexedDB as durable Fastify-mode storage unless their semantics are
     intentionally device-local and documented as non-authoritative.

4. Imports produce current-shape data.
   - JSON import and multipart `.risu` import must share the same current-shape
     normalization policy, or JSON whole-DB import must be restricted.
   - Bootstrap must not serve malformed historical row shapes that public
     commands cannot address safely.

5. Public commands validate stable resource identity.
   - Public command payloads must reject missing or duplicate durable child IDs.
   - ID generation belongs in import/bootstrap normalization, not in public
     replacement commands.
   - Prompt item replacement must use prompt item semantics, not generic prompt
     settings patching.

6. Revision conflicts are visible unless replay is proven safe.
   - A 409 should not be blindly converted into last-writer-wins by resending
     the same stale payload with a newer revision.
   - Retry should be limited to commands proven commutative/idempotent against
     intervening state.

7. Asset references are validated where they are written.
   - Owning resource commands must validate every server asset field that the
     export/bundle walker treats as an asset reference.

## Current Confirmed Gaps

These were confirmed by parallel sub-agent audits against the current codebase.

### P1: Provider Secrets Are Masked While Browser Provider Fallback Remains

`/api/v1/bootstrap` returns `maskProviderSecrets(persisted.database)`, but the
browser can still skip server generation and dispatch providers directly.

Evidence:

- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/providerSecrets.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/process/request/serverCompletion.ts`
- `src/ts/process/request/request.ts`
- `src/ts/process/request/google.ts`

Scope: broad if Phase 9 keeps the intended security invariant. A tactical fix
could stop masking secrets again, but that gives up the server-owned provider
goal. The real fix is to make Fastify provider dispatch server-owned, remove or
block browser fallback in server mode, and move/disable client-side Vertex token
refresh writes.

### P1: Plugin APIs Still Expose Browser-Local Durable Storage

The plugin sandbox still exposes durable browser storage APIs in Fastify mode:

- `SafeLocalStorage` writes `localStorage`.
- `SafeLocalPluginStorage` writes localForage.
- `SafeIdbFactory` opens/deletes IndexedDB databases.
- V2 installs these as sandbox `localStorage` and `indexedDB`.
- V3 reports `platform: "fastify"` but `saveMethod: "local"` and returns
  `SafeLocalPluginStorage`.

Evidence:

- `src/ts/plugins/pluginSafeClass.ts`
- `src/ts/plugins/plugins.svelte.ts`
- `src/ts/plugins/apiV3/v3.svelte.ts`

Scope: medium. Disabling these in Fastify mode is smaller than server-backing
them. IndexedDB likely should be explicitly unsupported unless a new server API
is designed.

Additional plugin bridge issues:

- `pluginV2` appears to slip through as an allowed key without a real command
  path.
- Server-backed `pluginCustomStorage` can shadow reserved DB-family names when
  read through the V2 `getDatabase` fallback.

### P1: JSON Import Can Persist Non-Current-Shape DB Data

Multipart `.risu` import uses broad current-shape normalization, but JSON
`{ database }` import uses a narrower route-local normalizer and then persists
the database as-is.

Evidence:

- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/importSnapshot.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/bootstrap.ts`

Scope: medium. Likely fix: share the `.risu` import normalizer with JSON import
or restrict JSON whole-DB import. Add tests that import missing/duplicate IDs
through JSON and assert normalized bootstrap output or a 400.

### P1/P2: Public Commands Still Repair Stable IDs

Several public command helpers still generate or replace durable child IDs
instead of rejecting malformed command input:

- Lorebook entry duplicate IDs are replaced.
- Script/trigger missing or duplicate IDs are generated/replaced.
- Message `chatId` is generated when missing.
- `promptTemplate` is accepted through generic prompt settings and emitted as
  `prompt.settings.updated`.

Evidence:

- `server/fastify/src/commands/lorebooks.ts`
- `server/fastify/src/commands/scriptDefinitions.ts`
- `server/fastify/src/commands/messages.ts`
- `server/fastify/src/commands/prompts.ts`
- `server/fastify/src/routes/commands.ts`

Scope: medium. Split import/bootstrap repair helpers from public command
validators, then make public replacement routes return 400 for missing or
duplicate child IDs.

### P2: Browser Command Helper Hides 409 Conflicts

The server correctly returns 409 revision conflicts, but the browser command
helper immediately retries the same stale payload with `currentRevision`.

Evidence:

- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/server/commands.ts`
- `src/ts/setting/utils.ts`
- `src/ts/server/commands.test.ts`

Scope: small central code change, medium/large behavior blast radius. Reorder,
replacement, truncation, generation/history, and array/object patch commands are
the riskiest classes.

### P2: Character Audio Asset Refs Are Not Validated By Commands

Bundle export walks character audio fields as asset references, but character
create/patch validation does not cover those fields.

Evidence:

- `server/fastify/src/risuSave/assetReferences.ts`
- `server/fastify/src/commands/characters.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/process/transformers.ts`

Scope: small. Add validation for `vits.files` and
`gptSoVitsConfig.ref_audio_data.assetId`, plus create/patch tests for valid,
missing, and malformed refs.

## Tooling Assessment

### TypeScript And Svelte LSP

LSP would help with navigation, hover, references, and editor-style diagnostics.
It would not by itself close Phase 9. Most remaining failures are semantic
contract gaps, not type errors. `pnpm check` can pass while Phase 9 is still
wrong.

Use LSP as convenience, not as the primary audit mechanism.

### ts-morph

ts-morph is more useful than LSP for the next audit pass because it can turn
the invariants into repeatable structural checks. Good candidates:

- Compare plugin `allowedDbKeys`, `unsupportedServerBridgeKeys`, settings maps,
  and command dispatch tables.
- Find public command helpers that call `randomUUID()` or otherwise repair IDs.
- Find route handlers that accept whole-resource arrays through generic settings
  commands.
- Compare asset-reference walker fields against owning command validators.
- Inventory `runServerCommand` callers and classify retry safety by command
  family.

ts-morph will not decide semantic policy, but it can prevent another
"closed, then rediscovered" cycle by making the audit repeatable.

## Recommended Next Step

Stop trying to close Phase 9 as a list of discovered bugs. First land a short
Phase 9 redefinition document or update the command map with the invariants
above. Then split the work into explicit closeout buckets:

1. Provider ownership and masked-secret invariant.
2. Plugin durable storage and bridge reserved-key behavior.
3. Import current-shape normalization.
4. Stable-ID public command validation.
5. Conflict retry policy.
6. Asset-reference validation completeness.
7. A repeatable ts-morph/rg audit script plus the full verification ladder.

Only after those buckets have regression coverage should the status docs say
Phase 9 is complete again.
