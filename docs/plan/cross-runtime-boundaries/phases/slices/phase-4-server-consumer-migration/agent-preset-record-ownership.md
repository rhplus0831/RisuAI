# Agent-Preset Record Ownership

Status: complete at `4715693a1`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move Agent and Agent Preset record vocabulary, normalization, migration, and
validation to a neutral owner.

## Boundary And Contract

Preserve limits, defaults, ChatML validation, legacy embedded-step migration,
dependency rules, toggle/lorebook inputs, cloning, and validation prose.
Commands, persistence, model selection, scheduling, and execution remain in
their existing owners. Delivered delta: eight production and two server-test
runtime/type edges; 178 total edges became 168.

## Verification

Shared boundary/ownership/ChatML dependency and record behavior passed 2, 1, 1,
and 14 tests; Fastify Agent execution passed 25 tests. Both typechecks, the
168-edge inventory, formatting, and diff checks passed.
