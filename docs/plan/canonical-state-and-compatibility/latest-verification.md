# Canonical State And Compatibility Retirement Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `47146eb759a8369ad407e872ce5897604a2ae7f4`
- Phase 1 predecessor: `1e758cd22`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Workstream 1 convention release: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: first Phase 2 slice, legacy flat model configuration migration.

## Migration Proof

- Named schema step v34 `durable-model-profile-ownership` creates stable
  `mp_legacy_<role>` profiles and role bindings without changing command
  revision or emitting command events/receipts.
- The same pure transform runs at fresh initialization, legacy `db.json`,
  portable import, and restore-import boundaries. A SQLite-trigger fault after
  settings writes proves atomic rollback; retry and second reopen are stable.
- Existing profiles, bindings, ordering dividers, runtime defaults, and matching
  credential references remain authoritative. Profile JSON never receives an
  inline secret.
- Inline-only Vertex state stays on the legacy resolver and is recorded as the
  Phase 5 repair hold because converting it without an existing credential
  reference would change provider choice or persist secret material.
- Explicit legacy conversion remains revisioned and supported. Normal resolver,
  request-routing, preset, loadout, current import, and historical `db.json`
  evidence passed with the compatibility reader still present for rollout.

## Commands And Results

- Fifteen focused files passed 503 tests across migration/defaults, interruption
  and reopen, commands, legacy/current imports, initialization/bootstrap,
  resolver and role routing, presets/loadouts, architecture, and compatibility
  governance.
- `pnpm check`, client declarations, Fastify typecheck, and browser-smoke
  typecheck passed.
- The cross-runtime inventory remains at 327 edges; the reviewed existing
  `databaseDefaults.ts` model-helper edges only gained required symbols.
- Focused Prettier and `git diff --check` passed.

## Verdict

The legacy flat model migration slice passes at `47146eb75`. Stable durable
profiles/bindings now exist before normal runtime for usable state, with
deterministic rollback/retry and no secret copying. Phase 2 continues with the
normal model consumer cutover; the model-owner cursor is not released yet.
