# Phase 9-6e - Provider Secret Masking

Date: 2026-05-26

## Summary

- Fastify bootstrap now masks provider/media/memory secret fields before
  serving the browser projection. Persisted `db.json` keeps the real server
  secrets.
- A shared server helper in `server/fastify/src/providerSecrets.ts` owns the
  masked sentinel and field inventory for scalar, object, map, and array
  secret paths such as provider keys, `OaiCompAPIKeys`, `customModels`,
  MCP refresh tokens, image-provider keys, and memory keys.
- Grouped settings commands now resolve the shared masked placeholder as
  "leave unchanged"; explicit new secret values still replace stored server
  secrets.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/commands.test.ts`
  - passed; 72 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-7a, the server-side `.risu` fixture corpus and codec
  harness.
- Keep import/export routes, repository writes, asset bundle walking, and
  broader provider dispatch flattening deferred to their assigned later
  slices.
