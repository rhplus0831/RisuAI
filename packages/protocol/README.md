# Shared Protocol Contracts

`@risuai/protocol` is the browser-safe source of truth for wire contracts used
by both the Svelte client and Fastify. Runtime schemas are TypeBox values and
TypeScript types are derived from those schemas.

Keep this package limited to serialized DTOs, protocol versions, capability
taxonomies, and pure validation/parsing helpers. Runtime source must not import
Svelte, Fastify, Node APIs, repositories, application stores, provider code, or
database models. `importBoundary.test.ts` enforces that rule.

Generation SSE objects include their discriminator as `type`; the Fastify
formatter moves it to the named SSE `event:` field. Shipped generation events
are additive, so their object schemas intentionally accept unknown properties.
Security-sensitive or explicitly closed protocols, such as startup telemetry,
use `additionalProperties: false`.

Run the focused checks with:

```sh
pnpm check:protocol
pnpm exec vitest run packages/protocol/src
```
