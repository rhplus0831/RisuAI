# Client Thinning — Server-Projection Contract

This directory consolidates the standing client-thinning workstream that
grew out of Phase 9. The original Phase 9 migration milestone closed on
2026-05-26; the contract here remained open because each verification
pass kept finding new classes of server-projection violations.

Five follow-up alpha passes (Alpha 1 through Alpha 5) each closed a
finding set and extended the invariant to defend the bug class
structurally rather than the literal pre-fix call site. This document
is the consolidated contract; the Phase 9 command map lives in
[`command-map.md`](command-map.md), and the decision rationales for
each exit criterion live in [`decisions.md`](decisions.md).

## Scope

**Fastify-served web mode only.** The production web SPA is built into
`dist/`, served by `server/fastify`, receives the injected
`globalThis.__FASTIFY__ = true` marker, and uses the same Fastify origin
as the owner of durable state through `/api/v1/*`. The browser renders
UI, forwards user intent, applies bootstrap/event projections, and
handles browser-only effects.

Out of scope: Vite-only dev serving, API-only Fastify without static SPA
serving, legacy native/mobile wrappers, legacy local browser persistence,
service-worker/installable-app paths, and alternative servers. These are
all no-port history.

## The Invariant

In Fastify-served web mode:

1. **Projection.** The browser is a projection of server-owned durable
   state. No client path writes durable state outside server commands;
   no command path mints stable ids the client cannot observe; no
   passive read claims write ownership.
2. **Boundary fidelity.** Server-owned bytes and identifiers are
   preserved across the durable boundary: backup/restore copies every
   server-owned data directory, asset uploads carry honest content
   metadata, and asset reads gate to the documented surface.
3. **Bounded state.** Long-lived server state is bounded: every
   in-process accumulator that grows with requests has an eviction
   policy.
4. **Structural audit.** `util/client-thinning-audit.ts` asserts these
   invariants structurally — derived from authoritative source
   structures, not pattern-matched against past fixes. Each rule has a
   committed pre-fix fixture and a test that runs the rule against the
   fixture and asserts non-zero exit.

Point 4 is what stops the close/reopen cycle: every "complete" claim
must be checkable by the audit and demonstrably red on the pre-fix
tree.

## Exit Criteria

Client thinning is complete only when **every** criterion is true in
Fastify-served web mode and covered by a committed regression test
(or audit rule + fixture).

### Provider and command boundaries

| #   | Criterion                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC1 | **Provider ownership.** Server generation is the only generation path in Fastify mode (`useServerGeneration` const-true; browser dispatch unreachable; unsupported formats error explicitly). No client-side durable token writes (Vertex refresh is server-side).         |
| EC2 | **Durable writes go through commands/import only.** Durable plugin storage uses the server-backed `risuai.pluginStorage`; device-local sandbox APIs (sync `localStorage`, IndexedDB, `getLocalPluginStorage()`) are disabled by default. An account-wide, command-backed Plugin Compatibility Mode may restore them without relaxing resource ownership. `pluginV2`, read-time shadowing, and `saveMethod` honesty are fixed. |
| EC3 | **Imports produce current-shape data.** JSON `{ database }` import and `.risu` import share the exported `normalizeRisuSaveImportDatabase`; bootstrap never serves shapes that public commands cannot address by stable id. ROOT_COMPONENT cannot overwrite reserved resource families. |
| EC4 | **Public commands validate stable identity.** Id helpers split into import-only `repairX` (may mint ids) and command-path `validateX` (rejects missing/duplicate, 400). Create commands require client-supplied ids. The raw `promptTemplate` settings path is removed — prompt items go through `/prompt-items/*`. |
| EC5 | **Single active writer.** Only the most recently bootstrapped session may mutate; stale sessions are rejected (`423`) and reload. Passive bootstrap refresh does not register write ownership. Generic settings commands surface 409 conflicts instead of blind retry.    |

### Asset and identifier boundaries

| #   | Criterion                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC6 | **Asset references validated where written.** Every field walked by `assetReferences.ts` (including `botPresets[*].image`, `vits.files.*`, and `gptSoVitsConfig.ref_audio_data.assetId`) is validated on every public command path that can mutate it. Optional clear values (`undefined`, `null`, `""`, `"-"`) remain supported. |
| EC7 | **Scoped identities are unambiguous.** Chat folder ids are globally unique. Chat ids and message ids are globally unique or parent-scoped — import/bootstrap normalization plus command-write rejection enforce this; every globally-addressed mutation normalizes first.   |
| EC8 | **Secret row identity is stable.** Masked secret placeholders in arrays restore by stable row identity (`botPresets.id`, `customModels.id`, `authRefreshes.url`, `characters.chaId`), not by index. Reorder/delete cannot transplant secrets.                                |
| EC9 | **Asset persistence and reads are consistent.** Re-uploading an existing asset id heals a missing blob. `getFileSrc` and sibling URL helpers return only documented shapes (raw asset id, legacy `assets/<sha>.<ext>`, `data:`, `blob:`, or `/api/v1/assets/...`) — arbitrary URL pass-through is rejected. `saveAsset` callers declare honest metadata. |

### Server-side correctness

| #    | Criterion                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC10 | **Composite command fan-out is serialized.** Any function that issues ≥2 `runServerCommand`/`dispatch*` calls against one optimistic snapshot serializes them so each command reads the revision returned by the previous one.                                              |
| EC11 | **No command-path id minting, transitively.** No public command route handler transitively calls a helper that mints durable ids. `ensure*Collection` repair-on-read is permitted only for missing/duplicate on-disk rows whose arguments never derive from the request body. |
| EC12 | **Backups preserve every server-owned data directory.** `createBackup` / `restoreBackup` cover `db.json`, `assets/`, `risu.db`, `data/save/`, and any future sibling of `dataDir`. Restore is atomic across all four.                                                       |
| EC13 | **In-memory accumulators are bounded.** Every process-lifetime mutable Set/Map/Array in `server/fastify/src/` reachable from request handlers has a documented eviction policy (LRU cap, TTL, or explicit user-paced classification).                                       |
| EC14 | **Repeatable invariant audit.** A ts-morph/rg audit (`pnpm client-thinning:audit`) re-checks the invariants above. Rules derive from `SECRET_PATHS`, the asset-walker collector table, route registrations, `dispatch*` declarations, `dataDir` sibling enumeration, and `saveAsset` caller enumeration. Each rule has a committed pre-fix fixture and a `*.test.ts` that asserts non-zero exit. |

## Verification Ladder

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

The ladder alone is not sufficient evidence: each new audit rule must
also be demonstrated red on a pre-fix fixture.

`pnpm tauribuild` appears in older Phase 9 closeout docs but no longer
exists after the Fastify-only cleanup. Do not reintroduce it as a
closeout gate.

## Alpha Evolution Log

Each alpha pass closed its known finding set and revealed a new audit
blind spot. The dates are when each pass closed; the substantive
contract has been folded into the exit criteria above.

| Pass    | Closed     | What it extended                                                                                                                                                                                                                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 9 | 2026-05-26 | EC1–EC7. Original `useServerGeneration`/plugin storage/import-shape/stable-id/single-writer/asset-validator contract plus the first audit script.                                                                                            |
| Alpha 1 | 2026-05-28 | EC3, EC4, EC6, EC7 reach. Root command id minting, JSON-vs-`.risu` import drift, asset-walker validator parity (`botPresets[*].image`), chat folder global uniqueness, module reference validation, asset healing/clear-value coverage.    |
| Alpha 2 | 2026-05-28 | EC5, EC11, EC14 reach. Chat fork id minting closed; memory-job and generation-time mutations brought under the active-writer lock; the audit discovers routes by registration rather than substring.                                       |
| Alpha 3 | 2026-05-28 | EC5, EC7, EC8, EC9, EC13 reach. Passive bootstrap refresh stopped claiming write ownership; chat/message global identity normalized at import; backup asset bytes preserved; masked secret rows restored by stable id; event sink bounded. |
| Alpha 4 | 2026-05-28 | EC10–EC14. Audit script rewritten to derive from authoritative source structures rather than pre-fix substrings; composite fan-out, transitive id minting, full `dataDir` backup coverage, all process-lifetime accumulators, `saveAsset` metadata, asset URL gate, and global-resolver normalization moved to structural rules. |
| Alpha 5 | open       | EC14 reproducibility extension. Every audit rule must have a committed pre-fix fixture and `*.test.ts` so "demonstrably red on the pre-fix tree" is reproducible by CI. The structural rules of Alpha 4 are otherwise intact.              |

The recurring lesson: closing a finding without a structural audit rule
re-derived from authoritative sources lets the same bug class return at
a different call site.

## Future Work

When a new finding is opened, extend the exit criteria above and the
audit script in the same change. Do not reopen an existing criterion to
add a single new call site — broaden the rule so the class is closed
structurally.
