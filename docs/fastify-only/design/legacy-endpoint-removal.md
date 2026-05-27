# Legacy Endpoint Removal

## Decision

Remove legacy non-Fastify client endpoints instead of forwarding or aliasing them to Fastify routes.

## Rationale

There are no existing Fastify users that need compatibility migrations, and keeping legacy paths makes the client continue to model multiple runtimes. The Fastify-only contract should use `/api/v1/*` consistently for storage, proxy, and server-backed IO.

## Implementation Notes

- Remove legacy storage paths from `src/ts/storage/nodeStorage.ts`.
- Remove legacy proxy paths from `src/ts/globalApi.svelte.ts`.
- Delete hosted function proxy files once no client code selects them.
- Update route tests so removed endpoints are not part of the supported contract.

## Revisit Triggers

- A production user migration is explicitly required before the Fastify-only release.
- External integrations are discovered that cannot update to `/api/v1/*`.
- The Fastify API is versioned in a way that requires a formal compatibility window.

## References

- `src/ts/storage/nodeStorage.ts:6`
- `src/ts/globalApi.svelte.ts:560`
- `public/functions/proxy.js:1`
- `public/functions/proxy2.js:1`
