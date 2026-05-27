# Phase 4: Proxy And API Routing

## Goal

Route provider and proxy IO through Fastify only.

## Scope

- Remove legacy node proxy branches from `src/ts/globalApi.svelte.ts`.
- Remove hosted hub or hosted function proxy branches that are not part of Fastify.
- Delete `public/functions/proxy.js` and `public/functions/proxy2.js` after no client code selects them.
- Update local-network restriction checks so they align with Fastify-only semantics.
- Keep provider fixture behavior stable unless the route contract intentionally changes.

## Boundaries

- Do not rewrite provider-specific prompt or response behavior as part of proxy cleanup.
- Do not keep deleted proxy paths as aliases.
- Keep security checks explicit in the Fastify route path.

## Exit Criteria

- Client proxy calls use `/api/v1/proxy/*` only.
- Hosted function proxy files are gone.
- Provider and route tests cover retained Fastify proxy behavior.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/globalApi.svelte.ts:560`
- `public/functions/proxy.js:1`
- `public/functions/proxy2.js:1`
