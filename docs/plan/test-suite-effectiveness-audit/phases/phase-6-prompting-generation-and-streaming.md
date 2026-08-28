# Phase 6: Prompting, Generation, And Streaming

Status: Pending; depends on Phases 0-3 and consumes Phase 4 chat findings.

## Objective

Audit whether prompt and generation tests protect model-visible semantics,
terminal streaming behavior, cancellation, disconnect/recovery, and durable
transcript finalization across client, protocol, Fastify, and browser layers.

## Scope

- Prompt rows, history windows, lore/memory/template inputs, static/plain
  sections, token/preflight budgets, and golden fixtures.
- Generation operations, chat/completion routes, dispatch, streaming/non-stream
  parsing, terminal frame assertions, backpressure, body caps, and request abort.
- Atomic send, cancellation races, disconnect/reattach, finalization retry,
  operation replay, startup recovery, reroll/alternate persistence, and effects.
- Agent Preset execution and output composition where the primary contract is
  generation behavior.
- Shared generation protocol and the opt-in compatibility matrix.

Primary discovery guide:
[`prompting-generation-and-streaming.md`](../../../tests/prompting-generation-and-streaming.md).

## Audit Questions

- Do exact fixtures encode supported prompt semantics rather than incidental
  object shape or obsolete pre-Fastify behavior?
- Are SSE frame order, terminal uniqueness, error/cancel disposition, fragmented
  input, and slow-consumer bounds independently proved?
- Do tests distinguish committed, provisional, retrying, stalled, cancelled,
  and unconfirmed generation outcomes?
- Is duplicated client/server vocabulary protected by shared typed contracts or
  vulnerable to coordinated test drift?
- Does compatibility normalization preserve meaningful transcript and provider
  request differences?
- Is there sufficient built-browser proof for normal composer-to-stream-to-
  durable-reload behavior?

## Required Outputs

- End-to-end contract map from prompt inputs through provider request, stream,
  persistence, visible effects, and reload.
- Golden/fixture semantic ownership and intentional update rules.
- Findings for oracle-only tests, duplicate matrices, self-fulfilling provider
  mocks, terminal vocabulary drift, missing browser journeys, and ambiguous
  durability states.
- Compatibility verdict for every removal or semantic consolidation in scope.

## Exit Criteria

- Every Phase 6 test, fixture family, oracle, and compatibility owner has a
  disposition.
- Unique prompt, frame, cancel, disconnect, replay, finalization, and reroll
  contracts remain protected at faithful layers.
- Critical/High transcript-loss or false-terminal findings are resolved or
  explicitly gated.
- No golden is refreshed solely to accommodate cleanup.
- Count/fixture deltas and residual browser/parity gaps are recorded.

## Validation

- Focused client process/protocol and Fastify generation tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:compat-harness` when prerequisites are available
- Relevant accepted-send/reroll browser specs, then `pnpm test:smoke`
- Isolated clone/load/backpressure gates where affected
- `pnpm format:check`
- `git diff --check`
