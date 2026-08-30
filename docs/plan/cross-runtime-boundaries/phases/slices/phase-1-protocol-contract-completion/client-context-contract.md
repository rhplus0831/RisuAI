# Client-Context Contract

Status: complete at `e729dabe489ce4974cf0f669a74e47ba69927008`.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the reported browser-language and viewport DTO plus its compatibility
normalizer into an explicit schema-first `@risuai/protocol/client-context`
subpath while retaining browser environment capture in the browser adapter.

## Source And Destination

- The neutral DTO and `normalizeReportedClientContext` move from
  `src/ts/process/request/clientContext.ts` to
  `@risuai/protocol/client-context`.
- `readBrowserClientContext` remains in the application-tree adapter and uses
  the protocol normalizer.
- Fastify generation routes and prompt types plus the display-source contract
  adopt the package exports.
- The current boundary cursor classifies four direct production edges: one
  runtime and three type-only.

## Behavior Contract

- Preserve optional browser language, screen width, and screen height fields.
- Preserve language trimming, the 128-character BCP-47-like syntax guard,
  finite positive dimension checks, integer rounding, and the 100,000 clamp.
- Invalid/empty inputs continue returning `undefined`; unknown object fields are
  ignored and partial valid contexts are retained.
- `navigator` and `window` reads, throwing privacy-getter recovery, generation
  assembly, prompt/CBS consumption, authentication, and writer policy remain in
  their current owners.
- Rollback restores the normalizer/type to the browser adapter and server imports
  together.

## Validation

Focused protocol normalization fixtures, existing browser client-context and
Fastify generation/prompt tests, protocol import audit, `pnpm check:protocol`,
`pnpm check:server`, `pnpm check`, affected tests, formatting, and
`git diff --check`.

## Done When

- The DTO and normalizer are exported from the explicit protocol subpath with a
  schema-derived public type.
- Fastify and neutral display-source consumers use the package owner while the
  browser adapter alone captures environment values.
- Fixtures prove accepted, partial, ignored, malformed, rounded, clamped, and
  throwing-getter behavior without changing the wire.
- The architecture baseline records the exact four-edge reduction without
  moving browser or server policy.

Stop if extraction changes any normalized output, requires browser globals in
the protocol package, or moves prompt, route, authorization, or writer behavior.

## Result

- `@risuai/protocol/client-context` now owns the TypeBox schema, derived DTO,
  and behavior-preserving client-context normalizer.
- Protocol fixtures prove trimming, language syntax, partial and unknown-field
  handling, empty/malformed inputs, finite positive dimensions, rounding, and
  clamping; browser fixtures retain guarded host-getter coverage.
- Fastify generation/prompt and neutral display-source consumers use the
  explicit package subpath, while the application adapter remains the only
  `navigator` and `window` reader.
- Prompt/CBS behavior, generation assembly, authorization, writer policy, and
  browser privacy-getter recovery did not move.
- The boundary cursor fell by exactly four production edges, from 345 to 341:
  one runtime and three type-only.
