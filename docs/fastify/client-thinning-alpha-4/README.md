# Fastify Client Thinning Alpha 4 - Open

Date: 2026-05-28

Status: **open.** This directory records the fourth client-thinning follow-up
pass after [`../client-thinning-alpha-3/`](../client-thinning-alpha-3/) closed.

## Why Alpha 4 Exists

Alphas 1, 2, and 3 each closed the call sites they found, then re-discovered the
next class. A definitive verification was run on 2026-05-28 against the
post-Alpha-3 checkout. The verification confirmed every documented A3F1-A3F13
fix is in place at the cited line numbers, the full ladder passes, and the
`pnpm client-thinning:audit` script is green.

It also confirmed why the close/reopen loop has not ended.

The standing `util/client-thinning-audit.ts` defends the **literal pre-fix
source text** rather than the **invariant**. Every A3R1-A3R7 rule has a
practical regression path that does not trip it (substring-only matching,
hardcoded allow-lists, narrow file scope). And the same A3F12-class fan-out bug
that was closed at one call site is alive at six other call sites; the A3F8
backup gap is alive for the SQLite memory database; the A3F10 metadata default
is alive for VITS/emotion/zip/module asset uploaders; an A3F13-class unbounded
accumulator exists in `auth.knownKeyHashes`.

These are not new bug classes the previous passes overlooked. They are the same
bug classes, at call sites the previous passes did not reach, with audit rules
written narrowly enough that no rerun catches them.

Alpha 4 has one job: **make the audit defend the invariant, not the past
fix.** Every behavior closure in this pass is downstream of that.

## Scope

Alpha 4 covers Fastify-served web mode only, identical to Alpha 3. In scope:

- Rewriting `util/client-thinning-audit.ts` to derive its checks from
  authoritative source structures (`SECRET_PATHS`, the asset-walker collector
  table, route registrations, `dispatch*` declarations) instead of hardcoded
  allow-lists and pre-fix substrings.
- Closing the call sites where already-closed invariants are still violated
  (B1-B10 below).
- Adding rule-first regression coverage so each new audit rule fails on the
  pre-fix tree and passes after the fix.

Out of scope unless required by a finding:

- Re-opening any closed A3F# behavior fix that the verification confirmed in
  place.
- Local browser mode, Vite-only dev serving, Tauri wrappers.
- A full rewrite of the Phase 9 command map.

## Alpha 4 Invariant

The invariant statement extends Alpha 3:

> In Fastify-served web mode:
>
> 1. The browser is a projection of server-owned durable state. No client path
>    writes durable state outside server commands; no command path mints stable
>    ids the client cannot observe; no passive read claims write ownership.
> 2. Server-owned bytes and identifiers are preserved across the durable
>    boundary: backup/restore copies every server-owned data directory, asset
>    uploads carry honest content metadata, asset reads gate to the documented
>    surface.
> 3. Long-lived server state is bounded: every in-process accumulator that
>    grows with requests has an eviction policy.
> 4. The audit script asserts these invariants structurally, not by
>    pattern-matching past fixes.

Point 4 is what stops the loop.

## Exit Criteria

Alpha 4 is complete only when **every** criterion is true in Fastify-served web
mode **and** covered by a committed regression test (or audit rule + test).
Each criterion maps to one or more buckets in
[`closeout-buckets.md`](./closeout-buckets.md).

| #     | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                  | Required regression proof                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A4EC1 | **Audit is invariant-derived.** `util/client-thinning-audit.ts` derives its checks from authoritative source structures (`SECRET_PATHS`, the asset-walker collector table, route-registration walks, `dispatch*`/`runServerCommand` enumeration, `data*` directory enumeration, `saveAsset` caller enumeration). No rule fires on a hardcoded pre-fix substring; every rule explains the invariant it enforces. | Each new rule fails on the pre-fix tree (committed test fixture or before/after diff) and passes after the fix.    |
| A4EC2 | **Composite command fan-out is serialized.** Any function that issues ≥2 `runServerCommand`/`dispatch*` calls against one optimistic snapshot serializes them so each command reads the revision returned by the previous one. The six known call sites (see B1) are closed.                                                                                                                                    | Audit rule fails on a synthetic two-dispatch-no-await function and passes after serializing each known call site.  |
| A4EC3 | **No command-path id minting, including transitively.** No public command route handler transitively calls a helper that mints durable ids (`randomUUID()` / `nanoid` / `uuidv4`). Repair helpers exist for import/bootstrap only.                                                                                                                                                                              | Audit rule walks the call graph from each `routes/commands.ts` handler and fails on any reachable `randomUUID()`.  |
| A4EC4 | **Backups preserve every server-owned data directory.** Backup/restore copies `db.json`, `assets/`, `risu.db` (SQLite), and `data/save/` (legacy storage), and any future sibling of `dataDir`. Restore is atomic across all four.                                                                                                                                                                              | Backup audit rule enumerates `dataDir` siblings and asserts each is in `createBackup` and `restoreBackup`.         |
| A4EC5 | **In-memory accumulators are bounded.** `auth.knownKeyHashes` (and any sibling Set/Array/Map declared in server modules) has an eviction policy.                                                                                                                                                                                                                                                                | Audit rule flags any process-lifetime Set/Map/Array in server modules that lacks a documented bound or eviction.   |
| A4EC6 | **`saveAsset` callers declare honest metadata.** Every `saveAsset(bytes, ...)` call either passes a filename or is explicitly classified as image-default. Non-image callers carry their real extension/content-type all the way to bundle export.                                                                                                                                                              | Audit rule enumerates `saveAsset` callers; non-image callers must pass a filename or be in a tested classification.|
| A4EC7 | **Asset read URL gate is narrow.** `getFileSrc` and any sibling helper that returns a URL for `<img>`/`<source>`/etc. in Fastify mode return only documented shapes (raw asset id, `assets/<sha>.<ext>`, data:, blob:, `/api/v1/assets/...`). Arbitrary URL pass-through is rejected.                                                                                                                            | Audit rule asserts the Fastify-mode branches of asset URL helpers reject unknown shapes; focused tests cover them. |
| A4EC8 | **Every globally-addressed mutation normalizes first.** Every route that calls a global resolver (`requireChatLocation`/`requireMessageLocation`/equivalent) normalizes the relevant id space first.                                                                                                                                                                                                            | Audit rule walks routes that call global resolvers and asserts a preceding global normalize call.                  |
| A4EC9 | **Docs reflect current state.** `status.md`, `status/next-steps.md`, and this directory's history/final-audit agree after the full ladder passes.                                                                                                                                                                                                                                                               | Doc-only.                                                                                                          |

## Verification Ladder

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Alpha 4 also requires each new audit rule to be demonstrated red on the pre-fix
tree (before/after diff). The ladder alone is not sufficient evidence of
closeout.

## Document Map

- [`open-findings.md`](./open-findings.md) - B1-B10 findings with evidence.
- [`decisions.md`](./decisions.md) - default decisions per exit criterion.
- [`closeout-buckets.md`](./closeout-buckets.md) - bucket order, rule-first.
- [`final-audit.md`](./final-audit.md) - written at closeout.
- [`history.md`](./history.md) - written at closeout.
- [`audit.md`](./audit.md) - the verification audit that opened this pass
  (combined Codex + Claude sub-agent sweep, recorded here for traceability).
