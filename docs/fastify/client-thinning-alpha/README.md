# Fastify Client Thinning Alpha - Task-Agent Contract

Date: 2026-05-28

Status: **open alpha workstream / task-agent handoff.** This directory is a
sibling to [`../client-thinning/`](../client-thinning/) and uses the same
structure: invariant, exit criteria, open findings, decisions, buckets, audit,
and history.

The original `client-thinning` closeout remains the historical baseline. This
alpha workstream exists because the follow-up Codex/Claude audits found new
server-projection gaps that are not caught by the current
`pnpm client-thinning:audit` script.

## Why this is an alpha workstream

The prior workstream closed the known EC1-EC7 implementation set, but later
audits found blind spots in the repeatable invariant gate:

- Public root create commands still mint missing ids even though command-path
  identity is documented as client-supplied and stable.
- JSON import can accept shapes that block export rejects.
- Asset-reference walking covers fields that command write validators do not.
- Some identity/reference scopes remain ambiguous, such as chat folders and chat
  module references.

This directory turns those audit findings into task-agent work. Do not use it to
rewrite the historical `client-thinning` record; use it to close the alpha
findings with code, tests, and audit-script coverage.

## Fastify-served web mode

In this workstream, **Fastify-served web mode** means the production web SPA
built into `dist` is served by `server/fastify`, receives the injected
`globalThis.__FASTIFY__ = true` marker, and uses the same Fastify origin as the
owner of durable state through `/api/v1/*`. The browser renders UI, forwards user
intent, applies bootstrap/event projections, and handles browser-only effects.

This scope includes Fastify routes and shared browser/server modules used by the
Fastify-backed projection flow. It excludes Vite-only dev serving, API-only
Fastify without static SPA serving, Tauri/native/mobile wrappers, legacy local
browser persistence, service-worker/installable-app paths, and alternative
servers.

## The invariant

> In Fastify-served web mode, the browser is only a projection of server-owned
> durable state. Every command, import, export, asset write, reference list, and
> repair path must preserve stable server-owned identity and must be covered by a
> repeatable invariant audit.

For this alpha workstream, the invariant scope is the AF1-AF10 / AEC1-AEC7
finding set plus any directly related invariant gap uncovered while closing those
buckets. It is not a fresh whole-system client-thinning re-audit.

## Current database shape

For AEC2, **current database shape** means the exportable persisted database
contract required by `buildRisuSaveExportBlocks` in
`server/fastify/src/risuSave/exportSnapshot.ts`. The required top-level resource
families are `characters`, `botPresets`, `modules`, `loadouts`, and `plugins` as
arrays, plus `pluginCustomStorage` as an object. Exported character records must
have a non-empty `chaId`.

Import and bootstrap repair may add those required families as empty collections
or route them through their existing family-specific normalizers. They should not
invent unrelated frontend `Database` defaults unless a specific normalizer owns
that field.

## Task-agent rules

- Pick one bucket from [`closeout-buckets.md`](./closeout-buckets.md). Treat the
  bucket's primary ownership as the starting boundary, but touch adjacent command
  helpers, routes, tests, docs, shared normalizers, or audit scripts when required
  to close the bucket's exit criteria.
- Do not mark a bucket closed until the finding is fixed, focused regression
  tests are committed, and `pnpm client-thinning:audit` is extended when the bug
  class was previously invisible to it.
- Keep command validation and import repair separate. Command paths reject
  malformed/missing durable ids; import/bootstrap repair paths may normalize
  legacy data.
- When a fix changes an invariant, update
  [`decisions.md`](./decisions.md), [`open-findings.md`](./open-findings.md),
  [`closeout-buckets.md`](./closeout-buckets.md), and
  [`history.md`](./history.md) in the same change.
- After all alpha buckets close, refresh [`final-audit.md`](./final-audit.md)
  with a clean validation pass.

## Exit criteria

Alpha is complete only when every criterion is true in Fastify-served web mode
and has committed regression proof.

| #    | Exit criterion                                                                                                                                                                                                                                                                                                                  | Required regression proof                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AEC1 | **Root command ids are stable.** Public Fastify command create paths and their command helpers require client-supplied durable ids. Import/bootstrap repair helpers are outside this command-path no-mint rule and may normalize legacy missing ids. The invariant audit covers root create helpers, not just child validators. | Missing-id POSTs for every public create route return 400; `pnpm client-thinning:audit` fails if any public command-path create helper calls `randomUUID()` or an equivalent id-minting fallback. |
| AEC2 | **Imports/export share current shape.** JSON import, `.risu` import, ROOT_COMPONENT blocks, bootstrap, and block export agree on current database shape. Imports either normalize to an exportable shape or reject.                                                                                                             | Minimal JSON import cannot produce export-invalid state; ROOT_COMPONENT cannot overwrite reserved resource families into invalid shapes.                                                          |
| AEC3 | **Asset walker and validators agree.** Every field walked as an asset reference is validated where command paths write it, including `botPresets[*].image`.                                                                                                                                                                     | Create/patch tests reject malformed and missing asset ids for walked fields; the audit enumerates all top-level walker fields.                                                                    |
| AEC4 | **Scoped identities are unambiguous.** Chat folder ids are globally unique in command-written state, matching the current public patch/delete route shape that addresses folders by `folderId` alone. Public patch/delete cannot affect the wrong character's folder.                                                           | Duplicate folder ids across characters are rejected on command create or repaired during import/bootstrap normalization, and patch/delete tests prove deterministic targeting.                    |
| AEC5 | **Durable reference lists are intentional.** Normal chat/character module links target normal user modules and reject nonexistent or MCP module ids on command writes, unless new compatibility evidence is documented in `decisions.md` with explicit tolerant-state tests.                                                    | Command tests cover nonexistent module ids and MCP module ids according to the chosen rule.                                                                                                       |
| AEC6 | **Asset persistence is consistent.** Re-uploading an existing asset id cannot leave metadata present while the blob is missing, and optional asset clear values are covered by tests.                                                                                                                                           | Missing-blob re-upload behavior is tested; `null`, `""`, and `"-"` clear paths are tested for optional character audio refs.                                                                      |
| AEC7 | **Docs and audit state agree.** Closeout/status docs reflect the actual alpha result, and any newly discovered invariant class is added to the audit script before closeout.                                                                                                                                                    | `README`, `open-findings`, `closeout-buckets`, `history`, and `final-audit` agree after the full ladder passes.                                                                                   |

Progress as of 2026-05-28: **AEC1, AEC2, AEC3, AEC4, AEC5, and AEC6 are
closed; AEC7 is open.** Next ordered pickup: Bucket 8, documentation/status
reconciliation.

## Verification ladder

Run focused tests for each bucket first, then the shared ladder before claiming
alpha closeout:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

`pnpm tauribuild` is not a current package script and is not an alpha closeout
gate.

## Document map

- [`open-findings.md`](./open-findings.md) - verified open alpha findings,
  mapped to exit criteria and task-agent buckets.
- [`decisions.md`](./decisions.md) - implementation decisions and rationale for
  each alpha criterion.
- [`closeout-buckets.md`](./closeout-buckets.md) - task-agent work breakdown,
  ownership boundaries, and focused proof commands.
- [`audit.md`](./audit.md) - cross-audit verification summary used to seed this
  workstream.
- [`final-audit.md`](./final-audit.md) - current alpha final-audit state and the
  template for the eventual closeout pass.
- [`history.md`](./history.md) - resolved alpha findings and verification
  results. It is intentionally sparse until buckets close.
