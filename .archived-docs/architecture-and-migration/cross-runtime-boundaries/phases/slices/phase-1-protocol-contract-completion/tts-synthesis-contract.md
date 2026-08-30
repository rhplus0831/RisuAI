# TTS Synthesis Contract

Status: complete at `cc7cfc0fd6e5154beab6b0c19121e287a402d17e`.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the TTS synthesis operation taxonomy, credentials, provider inputs, and
OpenAI endpoint configuration from the browser application tree into an
explicit schema-first `@risuai/protocol/tts-synthesis` subpath.

## Source And Destination

- `src/ts/server/ttsProtocol.ts` to `@risuai/protocol/tts-synthesis`.
- Browser TTS callers and the Fastify TTS handler/tests adopt the package
  exports.
- The current boundary cursor classifies four direct edges to the source.

## Behavior Contract

- Preserve all five synthesis operation identifiers and the `none`, `stored`,
  `provided`, and `stored-character` credential variants.
- Preserve ElevenLabs, Fish, Hugging Face, NovelAI, and OpenAI input fields,
  NovelAI versions, six OpenAI formats, and optional caller-owned OpenAI
  endpoint configuration.
- Authentication, stored-secret/character resolution, endpoint policy, input
  and response limits, provider requests, audio validation, and error masking
  remain Fastify-owned.
- The browser continues sending credential descriptors and provider inputs; no
  raw stored credential, audio cache, or character configuration moves.
- Rollback restores the old contract module and consumer imports together.

## Validation

Focused protocol fixtures, browser/Fastify TTS tests, structural operation
parity, protocol import audit, `pnpm check:protocol`, `pnpm check:server`, `pnpm
check`, affected tests, formatting, and `git diff --check`.

## Done When

- Operation/format taxonomies, credentials, provider inputs, and discriminated
  requests are schema-derived at the explicit protocol subpath.
- Browser and Fastify consumers use the package owner and fixtures prove every
  operation/input pairing, credential variant, and nested OpenAI configuration.
- The old application-tree protocol module is removed.
- The architecture baseline records the exact four-edge reduction without
  moving credential, endpoint, provider, character, or audio policy.

Stop if schema extraction changes an accepted payload, exposes stored
credentials, weakens operation/input pairing, or requires provider/security
behavior to move into the protocol package.

## Result

- `@risuai/protocol/tts-synthesis` now owns TypeBox schemas and derived types
  for all five synthesis operations, four credential variants, provider inputs,
  six OpenAI formats, and every operation-discriminated request envelope.
- Contract fixtures prove every operation, credential, and format plus exact
  request, nested-configuration, and operation/input rejection behavior.
- Browser, Fastify, and structural consumers use the explicit package subpath
  and the old application-tree contract module is removed.
- Fastify still owns credential and character resolution, endpoints, request
  and response limits, provider calls, audio validation, and error masking.
- The boundary cursor fell by exactly four edges, from 357 to 353: two
  production and two server-test edges.
