# Image-Generation Operation Contract

Status: complete at `054116c5d27235b124b12a2f84b1c6d6c827ea5a`.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the server image-generation provider taxonomy, credentials, and
provider-discriminated request envelopes from the browser application tree into
an explicit schema-first `@risuai/protocol/image-generation-operation` subpath.

## Source And Destination

- `src/ts/server/imageGenerationProtocol.ts` to
  `@risuai/protocol/image-generation-operation`.
- Browser image-generation/stable-diff consumers and Fastify image/Lua
  handlers/tests adopt the package exports.
- The current boundary cursor classifies four direct edges to the source.

## Behavior Contract

- Preserve all eight provider identifiers and the `none`, `stored`, and
  `provided` credential variants.
- Preserve each provider discriminator and its exact prompt, model, quality,
  dimension, style, aspect, person-generation, image, LoRA, and opaque NovelAI
  payload shape.
- Authentication, stored-secret resolution, provider selection, URL policy,
  payload and response limits, upstream requests, error masking, Lua policy,
  and image persistence remain Fastify-owned.
- The browser continues sending only the selected credential descriptor and
  provider payload; the move adds no credential, response, or asset caching.
- Rollback restores the old contract module and consumer imports together.

## Validation

Focused protocol fixtures, browser/Fastify image-generation tests, structural
provider parity, protocol import audit, `pnpm check:protocol`, `pnpm
check:server`, `pnpm check`, affected tests, formatting, and `git diff --check`.

## Done When

- Provider taxonomy, credentials, and all request variants are schema-derived at
  the explicit protocol subpath.
- Browser and Fastify consumers use the package owner and fixtures prove every
  discriminator, nested LoRA/image shape, and rejected cross-pairing.
- The old application-tree protocol module is removed.
- The architecture baseline records the exact four-edge reduction without
  moving endpoint, credential, provider, Lua, or asset policy.

Stop if schema extraction changes an accepted payload, narrows the opaque
NovelAI request, exposes stored credentials, or requires provider/security
behavior to move into the protocol package.

## Result

- `@risuai/protocol/image-generation-operation` now owns TypeBox schemas and
  derived types for all eight providers, three credential variants, and every
  provider-discriminated request envelope.
- Contract fixtures prove all variants, exact request/credential/nested objects,
  cross-provider rejection, and structurally opaque NovelAI payload handling.
- Browser, Fastify, Lua, and structural consumers use the explicit package
  subpath and the old application-tree contract module is removed.
- Fastify still owns exact provider limits, credentials, endpoints, upstreams,
  Lua policy, response validation, error masking, and asset persistence.
- The boundary cursor fell by exactly four edges, from 361 to 357: two
  production and two server-test edges.
