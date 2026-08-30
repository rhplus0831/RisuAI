# Memory-Model Capability Ownership

Status: complete at `c51dcac16`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the structural memory-summarization provider predicate to a neutral owner.

## Boundary And Contract

Accept only OpenAI, OpenRouter, and NanoGPT routable verdicts and preserve
unsupported reason prose. Model/profile resolution, credentials, request
options, and dispatch stay in their owners. Delivered delta: two production
runtime edges; 168 total edges became 166.

## Verification

Shared behavior/boundary/ownership, browser UI state, Fastify memory dispatch,
and commands passed 5, 2, 1, 14, 9, and 230 tests. Both typechecks, the 166-edge
inventory, formatting, and diff checks passed.
