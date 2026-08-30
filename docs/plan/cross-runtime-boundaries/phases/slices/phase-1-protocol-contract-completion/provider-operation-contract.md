# Provider Operation Contract

Status: ready.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the provider metadata/translation/voice operation taxonomy and request
envelope from the browser application tree into an explicit schema-first
`@risuai/protocol/provider-operation` subpath.

## Source And Destination

- `src/ts/server/providerOperationsProtocol.ts` to
  `@risuai/protocol/provider-operation`.
- The browser provider-operation client and Fastify handler/tests adopt the
  package exports.
- The current boundary cursor classifies three direct edges to the source.

## Behavior Contract

- Preserve all 18 operation strings and the `none`, `stored`, `model-profile`,
  and `provided` credential variants.
- Preserve optional input and the existing model, text/translation, and token
  count input shapes, including current additive-object behavior.
- Credential resolution, stored-secret access, model-profile lookup,
  authentication, rate/payload policy, provider dispatch, masking, and error
  handling remain Fastify-owned.
- The browser continues sending only the selected credential descriptor and
  operation input; the move adds no credential or result caching.
- Rollback restores the old contract module and consumer imports together.

## Validation

Focused protocol fixtures, provider-operation browser/server tests, protocol
import audit, `pnpm check:protocol`, `pnpm check:server`, `pnpm check`, affected
tests, formatting, and `git diff --check`.

## Done When

- The operation taxonomy and envelopes are schema-derived at the explicit
  protocol subpath.
- Browser and Fastify consumers use the package owner and compatibility fixtures
  prove every discriminated variant.
- The old application-tree protocol module is removed.
- The architecture baseline records the exact edge reduction with no behavior
  or authority movement.

Stop if the contract cannot represent a currently accepted request, if a schema
would expose stored credentials, or if provider dispatch/security behavior would
need to move with the DTO.
