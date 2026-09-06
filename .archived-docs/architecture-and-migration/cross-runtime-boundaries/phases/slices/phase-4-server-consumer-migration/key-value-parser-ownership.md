# Key/Value Parser Ownership

Status: complete at `e71c5944e`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move dependency-free default-variable parsing to a neutral owner used by the
browser facade and Fastify prompt defaults.

## Boundary And Contract

Preserve newline splitting, first-`=` extraction, empty key/value rejection,
whitespace, and empty/error fallback. Delivered delta: one production runtime
edge; 199 total edges became 198.

## Verification

Shared behavior/ownership, server prompt-variable, and browser chat-variable
suites passed 5, 1, 33, and 7 tests. Both typechecks, the 198-edge inventory,
formatting, and diff checks passed.
