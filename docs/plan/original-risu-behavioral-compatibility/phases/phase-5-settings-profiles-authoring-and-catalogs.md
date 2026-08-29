# Phase 5 — Settings, Profiles, Authoring, And Catalogs

Status: Complete
Depends on: Phases 1-4

Completion anchors:

- `5eca30f4872e865efee2c86f4dde7ae71e915f9a` — visible character
  authoring through the real Fastify command survives full browser reload.
- `b34b7a78f28cb5903ece3880073fbb9e46392cb8` — closed settings,
  defaults, preset-field, collection, and legacy/no-control ownership.

## Objective

Verify defaults, legacy settings, presets, profiles, personas, characters,
lorebooks, authoring workflows, uploads, and retained Realm/catalog actions from
editing through selection, persistence, runtime use, and reload.

## Audit Questions

- Are all baseline/default/legacy fields loaded, edited, saved, applied, copied,
  imported, exported, and reset without omission or type drift?
- Does preset/profile selection propagate every runtime-relevant option and
  clear stale values when the baseline does?
- Do character/persona/lore identifiers, order, assets, metadata, and references
  survive authoring, duplication, deletion, import, and reload?
- Are catalog/Realm acquisition and update actions atomic and visibly diagnosed
  when unsupported or failed?
- Can secret fields leak through browser projection, traces, fixtures, or export?

## Required Outputs

- Closed-world settings/default/command-group and preset/profile field matrices.
- Baseline/current save/apply/reset fixtures with missing/null/legacy variants.
- Runtime-consumer ownership for each profile option, linked to Phases 6-7.
- Browser authoring and catalog failure/atomicity journeys.
- Round-trip ownership links to Phase 11 for imported/exported artifacts.

## Exit Criteria

- Every retained field is classified for storage, projection, editing, runtime
  use, interchange, and secrecy as applicable.
- Apply/reset/copy/import cannot silently omit or retain stale runtime values.
- Authoring workflows preserve identity/references and visible failure semantics.
- Focused settings/authoring/catalog and compatibility lanes pass.

## Validation

Run structural field checks, unit/integration tests, built-browser authoring and
reload journeys, affected and compatibility lanes, secret scans where relevant,
formatting, and `git diff --check`.

## Completion Record

Phase 5 closes the retained settings and authoring surface without treating a
Fastify storage layout as baseline behavior. Category E rows
`ORC-SURFACE-094` through `ORC-SURFACE-096` own the new assurance surfaces, and
the pilot row `ORC-SURFACE-001` is re-verified at the Phase 5 structural anchor.

### Closed Settings And Preset Matrices

`server/fastify/__tests__/phase5CompatibilityStructure.test.ts` fails closed on
the omission classes that motivated this phase:

- all 422 retained `Database` fields are partitioned across generic settings,
  collections, character state, dedicated commands, preset-derived values, and
  opaque legacy round-trip ownership;
- every Fastify readable/writable settings group exactly matches the browser
  projection, contains no duplicate or unowned key, and keeps the Agent/model
  derived read-only groups explicit;
- the 82-field legacy preset apply catalog, 65-field model preset catalog,
  20-field prompt preset catalog, and 41-field prompt-model override catalog
  close over current `Database` owners;
- 15 behavior-sensitive first-run defaults, seven semantically omitted legacy
  defaults plus the optional Agent Preset pointer, and 13 documented
  legacy/no-control keys remain explicit; imported `pip` keepalive still
  normalizes to `sound`; and
- the shared provider-secret path registry continues to mask top-level, nested,
  array-row, and record-row secrets before browser projection. Resource and
  command tests retain the stored-secret placeholder and rejection semantics.

The legacy `additionalParams` save/apply/reset pilot remains additive to the
fork baseline: the Original implementation omitted it, while the verified
Fastify contract deliberately preserves it. Missing, null, empty, and
non-default cases remain distinct until the owning preset normalizer runs.

### Authoring And Durable Identity

All eleven repository collection fields now have a structural command prefix,
SQLite table, and deeper phase owner. Character, Agent, Agent Preset, persona,
global-lorebook, prompt, preset, loadout, translator-preset, module, and plugin
authoring retain their targeted command/persistence owners instead of silently
falling back to a whole-database rewrite.

The built-browser journey in
`server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts` opens the visible
character editor, changes name, description, and first message, observes the
accepted `PATCH /api/v1/commands/characters/:characterId`, verifies the stable
`chaId`, reloads the app, and verifies all authored fields again. Unit and
integration owners cover create, patch, select, duplicate, delete, reorder,
accepted, queued, rejected, owner-scoped rollback, and reference-preserving
persona/lorebook/preset variants.

### Realm, Catalog, Upload, And Failure Ownership

The retained browser Realm flow distinguishes an empty catalog from HTTP or
network failure, contains stale completions, requires terms/low-level
confirmation, reconciles the returned command event, and navigates by imported
character id rather than a stale collection index. Explicit unsupported-server
fallback remains covered without reporting a failed import as success.

Fastify Realm JSON and CharX imports stage assets and character persistence as a
bounded operation. Later conversion/write failures remove newly created bytes
while preserving deduplicated bytes; duplicate ids, timeouts, disconnects, and
known/unknown-length limits do not fabricate revisions or events. Direct and
bulk uploads retain content addressing, writer/auth guards, idempotence,
all-or-nothing staging, and a separately revisioned inlay catalog.

### Cross-Phase Boundaries

- Phase 6 owns prompt-time application and generation effects of authored
  values; Phase 7 owns model/profile/provider runtime dispatch and credentials.
- Phase 8 owns Hypa V3 preset runtime behavior; Phase 10 owns module/plugin host
  lifecycle; Phase 11 owns portable bytes, imports/exports, and complete
  round-trip equivalence.
- Proposed `ORC-DECISION-058` and `ORC-SURFACE-062` concern post-fork
  character/module conversion and remain Category J work for Phase 10/13. They
  do not describe a retained Phase 5 character-authoring path and are not
  adjudicated here.
- Phase 4 remains independently routed until its visible responsive/mobile
  comparison and any required maintainer decision are closed. Phase 5's
  evidence does not change that status.

No Phase 5 production defect, new divergence, or new decision was found. The
structural gate and focused suites close all Category E rows with high
confidence; deterministic third-party Realm fixtures and the named cross-phase
boundaries are the recorded residuals.

## Verification Evidence

| Check | Result |
| --- | --- |
| `pnpm test:server` | Passed; 172 files, 3,556 tests, one skipped scale case. This includes settings/default/command, resource secrecy, authoring, Realm, asset-upload, and inlay-catalog owners. |
| Focused Phase 5 DOM command over database/preset, persona, character, Realm-card, and lorebook-bridge owners | Passed; 5 files and 379 tests. |
| `pnpm exec vitest run --project frontend-node src/ts/providerSecretMask.test.ts` | Passed; 1 file and 2 tests. |
| `pnpm build:smoke` plus focused `fastifyBrowserSmoke.spec.ts` character-authoring Playwright case | Passed; production build and 1 built-browser test. |
| `pnpm check:server` | Passed at the structural completion anchor. |
| `pnpm test:compat-harness` | Passed after the independently committed Phase 2 governance-link correction; exact initial and final results are recorded in `latest-verification.md`. |
| `pnpm validate:compat-registers` and fail-closed register Vitest | Passed after the Category E register update; exact counts are recorded in `latest-verification.md`. |
| Phase 5 Prettier check and `git diff --check` | Passed. |
