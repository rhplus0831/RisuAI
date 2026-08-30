# Parser Character-Argument Type Seam

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Remove Fastify Lua runtime's type-only dependency on the browser RisuChat parser
without moving parser state or behavior.

## Boundary And Contract

Use the narrowest structural character argument accepted by the Lua bridge.
Preserve the existing field shapes and optionality, browser parser exports, Lua
conversion behavior, and request-local execution policy. Expected delta: one
production type-only edge; 164 total edges become 163.

## Verification

Run a focused ownership/structural proof, affected Lua/parser and assembly
tests, both typechecks, architecture inventory, formatting, and diff checks.
