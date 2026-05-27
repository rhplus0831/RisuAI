# Phase 3: Storage Contract Cleanup

## Goal

Make Fastify storage the only supported persistence contract.

## Scope

- Remove legacy storage endpoints from `src/ts/storage/nodeStorage.ts`.
- Remove local browser persistence selection from `src/ts/storage/autoStorage.ts` when it acts as a runtime alternative.
- Update bootstrap behavior that falls back to local save-file loading.
- Ensure auth and storage failures report Fastify-backed errors instead of silently selecting local mode.
- Update storage route tests to cover the retained Fastify contract.

## Boundaries

- Do not add compatibility redirects for removed storage paths.
- Do not remove import/export utilities if they are normal Fastify-served user actions.
- Do not change `.risu` data semantics unless storage tests require an explicit schema update.

## Exit Criteria

- Client storage uses `/api/v1/storage/*` only.
- Local browser storage is not selected as an app runtime.
- Storage tests and smoke coverage pass against Fastify.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/storage/nodeStorage.ts:6`
- `src/ts/storage/autoStorage.ts:28`
- `src/ts/bootstrap.ts:137`
