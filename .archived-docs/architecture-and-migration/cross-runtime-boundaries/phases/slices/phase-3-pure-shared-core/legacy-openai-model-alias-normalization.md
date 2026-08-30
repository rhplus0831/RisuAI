# Legacy OpenAI Model-Alias Normalization

Status: complete at `23e5a4b30`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core regex output-size leaf at `83e8aabfa`.

## Objective

Move the browser/Node-neutral legacy OpenAI model-ID alias table and normalizer
into the audited shared-core owner without changing stored selections or
provider request payloads.

## Source And Destination

- Source: `src/ts/model/legacyOpenAIModelAliases.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: the browser OpenAI request adapter and Fastify chat-completions,
  legacy-instruct, and Responses API adapters.

## Behavior Contract

- Preserve every existing alias key and mapped wire model exactly.
- Preserve unknown identifiers by returning the input string unchanged; do not
  trim, validate, case-fold, or coerce.
- Keep legacy IDs in stored settings and normalize only at the provider request
  boundary.
- Do not change provider selection, credentials, endpoints, request options,
  streaming, retries, response parsing, or error behavior.

## Validation

Shared-core import audit and typecheck, focused differential alias fixtures,
browser request and all three Fastify provider owning tests, both typechecks,
architecture inventory, formatting, and `git diff --check`.

## Done When

- All four production consumers use the shared subpath.
- The browser-tree implementation is deleted and the three matching Fastify
  cross-runtime edges disappear without a new exception.
- Known-alias payloads and unknown-ID pass-through match the pre-extraction
  behavior in browser and Fastify request tests.

Stop if the helper needs provider state, credentials, endpoints, persistence,
request orchestration, or runtime-specific behavior.

## Result

The exact alias table and pass-through normalizer now live at
`@risuai/shared-core/legacy-openai-model-aliases`. All four production consumers
use the shared owner, the old browser-tree module is gone, focused provider
tests preserve wire payloads, and the reviewed boundary fell to 327 direct
root-`src` edges.
