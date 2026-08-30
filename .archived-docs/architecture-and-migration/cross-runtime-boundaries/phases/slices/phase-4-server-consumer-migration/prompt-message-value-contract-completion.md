# Prompt-Message Value-Contract Completion

Status: complete through `d31f0eb16` and `53e9fa0c3`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: prompt-row ownership at `701bc555f`.

## Objective

Move the remaining low-risk prompt consumers from browser `OpenAIChat` and
`MultiModal` declarations to Fastify's existing `PromptMessage` and
`PromptMultimodal` value contract.

## Boundary

- Production: Agent Preset messages, asset lookup, lorebook rows, Lua prompt
  rows, memory adapter rows, plain/static sections, prefix-token memoization,
  tokenization, trigger data effects, assembly, dispatch, and generation routes.
- Tests: Lua-runtime, token, assembly, and dispatch fixtures.
- Delivered delta: fourteen production and four server-test type-only
  browser-application-model edges.

## Behavior Contract

Preserve role/content/name/memo/attribute/thought/cache fields, multimodal
kind/base64/dimensions, token charges, Lua JSON round-trips, asset parsing,
prefix memo keys, prompt order, and provider-visible values. Do not change
model/profile resolution, provider dispatch, persistence, revisions, receipts,
or events.

## Validation

Run the owning Agent Preset, assembly, lorebook, Lua, prompt-memory, plain/static
section, token, and trigger suites; expand the closed ownership assertion; run
both typechecks, architecture inventory, formatting, and diff checks.

## Done When

- All bounded consumers import only the Fastify prompt-message contract.
- The baseline accounts for eighteen removed edges without a new exception.
- Row and multimodal behavior remains unchanged.
