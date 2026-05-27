# Provider Coverage

## Goal

Provider and proxy tests should prove that provider IO uses the Fastify proxy contract and does not depend on legacy node, hosted function, or local-only branches.

## Current Inventory

- `src/ts/globalApi.svelte.ts:560` now builds Fastify `/api/v1/proxy/*` routes only for buffered proxy fetches, stream job creation/deletion, and stream job WebSocket paths.
- `src/ts/globalApi.proxy.test.ts:80` covers client route selection and fails if `/proxy2` or `/proxy-stream-jobs` fragments reappear.
- `public/functions/proxy.js` and `public/functions/proxy2.js` were deleted in Phase 4.
- Local-network streaming route selection is covered against the Fastify-only contract.

## Expected Coverage

- Fastify proxy request and streaming behavior.
- Provider calls that previously selected hosted or legacy proxy paths.
- Local-network restriction behavior under the Fastify-only runtime.
- Failure responses when proxy configuration is invalid.

## Exit Criteria

- Tests fail if client provider IO tries `/proxy2`, `/proxy-stream-jobs`, or `public/functions` paths.
- Fastify proxy tests cover the retained route behavior.
- Removed provider paths are documented in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
