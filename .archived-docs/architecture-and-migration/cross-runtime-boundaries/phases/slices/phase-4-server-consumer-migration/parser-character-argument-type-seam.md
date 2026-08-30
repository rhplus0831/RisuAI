# Parser Character-Argument Type Seam

Status: complete at `0fb61855a`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Remove Fastify Lua runtime's type-only dependency on the browser RisuChat parser
without moving parser state or behavior.

## Boundary And Contract

Use the narrowest structural character argument accepted by the Lua bridge.
Preserve the existing field shapes and optionality, browser parser exports, Lua
conversion behavior, and request-local execution policy. Delivered delta: one
production type-only edge; 164 total edges became 163.

## Verification

The focused ownership and Lua runtime suites passed 1 and 52 tests; architecture
inventory passed 10 tests. Both typechecks, formatting, and diff checks passed.
