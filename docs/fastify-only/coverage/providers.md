# Provider Coverage

## Goal

Provider and proxy tests should prove that provider IO uses the Fastify proxy contract and does not depend on legacy node, hosted function, or local-only branches.

## Current Inventory

- `src/ts/globalApi.svelte.ts:560` currently has Fastify `/api/v1/proxy/*`, legacy node proxy, and hosted hub proxy branches.
- `public/functions/proxy.js:1` and `public/functions/proxy2.js:1` are separate hosted function proxy surfaces.
- Local network restrictions currently key off node-server semantics and need to be checked against the Fastify-only contract.

## Expected Coverage

- Fastify proxy request and streaming behavior.
- Provider calls that previously selected hosted or legacy proxy paths.
- Local-network restriction behavior under the Fastify-only runtime.
- Failure responses when proxy configuration is invalid.

## Exit Criteria

- Tests fail if client provider IO tries `/proxy2`, `/proxy-stream-jobs`, or `public/functions` paths.
- Fastify proxy tests cover the retained route behavior.
- Removed provider paths are documented in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
