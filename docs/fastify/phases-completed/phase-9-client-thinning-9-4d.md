# Phase 9-4d - Asset Reference Commands

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added shared Fastify command validation for durable references to
  uploaded server assets.
- Allowed character asset fields through the existing character create and
  patch commands: `image`, `emotionImages`, `additionalAssets`,
  `ccAssets`, and `prebuiltAssetExclude`.
- Allowed module `assets` through the existing module create and patch
  commands.
- Validated persona `icon`, display `customBackground`, and character
  order folder `imgFile` references through their owning commands.
- Routed Fastify-mode browser asset bytes through `POST /api/v1/assets`;
  server-backed web now stores raw server asset ids for new references.
- Resolved raw server asset ids and legacy-looking `assets/<id>.<ext>`
  references to `/api/v1/assets/:id` when reading or previewing assets.
- Extended the Fastify asset content-type map for additional asset file
  types already exposed by the UI: SVG, CSS, and common font formats.

## Guardrails

- No generic durable asset-reference command was added. References are
  still patched through the owning resource commands and emit the owning
  resource event.
- Legacy local mode storage keeps the existing `assets/<id>.<ext>` path shape.
- Server validators require referenced server asset ids to exist in the
  Fastify asset metadata before the owning command commits.
- Bundle walking, full `.risu` import/export, asset GC, plugin
  records/storage, projection enforcement, storage gating, and
  provider-key masking remain deferred.

## Tests

- Added Fastify command tests for valid asset references across
  characters, modules, personas, display settings, and character folders.
- Added negative Fastify command coverage for malformed and missing asset
  references with no revision bump.
- Updated browser command helper tests so character and module asset
  fields are preserved in command payloads.
- Focused verification:
  `pnpm api:test -- commands.test.ts` passed with 1109 tests.
- Focused browser verification:
  `pnpm test -- src/ts/server/commands.test.ts` passed with 692 tests and
  4 skipped.
- `pnpm check` is clean.
- `pnpm test` passes with 692 tests and 4 skipped.
- `pnpm api:test` passes with 1109 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4e plugin records and configuration.
- Keep plugin-storage kv and plugin database setter translation in 9-4f.
- Keep `.risu` import/export and bundle asset walking in 9-8.
