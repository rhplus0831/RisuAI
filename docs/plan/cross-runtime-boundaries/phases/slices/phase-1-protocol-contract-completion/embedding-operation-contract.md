# Embedding Operation Contract

Status: ready.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the remote embedding model taxonomies and text/group operation envelopes
from the browser application tree into an explicit schema-first
`@risuai/protocol/embedding-operation` subpath.

## Source And Destination

- `src/ts/server/embeddingOperationsProtocol.ts` to
  `@risuai/protocol/embedding-operation`.
- Browser embedding/memory consumers and the Fastify embedding handler/tests
  adopt the package exports.
- The current boundary cursor classifies three direct edges to the source.

## Behavior Contract

- Preserve six remote model identifiers, the contextual Voyage model subset,
  `query`/`document` input types, credential variants, and stored/provided custom
  endpoint configuration.
- Preserve the `texts` versus `groups` discriminator, their allowed model sets,
  input nesting, success dimensions, and vector nesting.
- Credential resolution, custom URL policy, authentication, payload and batch
  bounds, deadlines, provider requests, response bounds, and finite/dimension
  vector validation remain Fastify-owned.
- Persistence, cache, event, and mutation behavior: none.
- Rollback restores the old contract module and consumer imports together.

## Validation

Focused protocol fixtures, browser/Fastify embedding tests, protocol import
audit, `pnpm check:protocol`, `pnpm check:server`, `pnpm check`, affected tests,
formatting, and `git diff --check`.

## Done When

- Model/input taxonomies and request/success envelopes are schema-derived at the
  explicit protocol subpath.
- Browser and Fastify consumers use the package owner and fixtures prove every
  discriminator, nesting rule, and invalid cross-pairing.
- The old application-tree protocol module is removed.
- The architecture baseline records the exact edge reduction without moving
  endpoint, credential, or vector policy.

Stop if schema extraction changes an accepted payload, weakens contextual model
pairing, exposes stored credentials, or requires provider/security behavior to
move into the protocol package.
