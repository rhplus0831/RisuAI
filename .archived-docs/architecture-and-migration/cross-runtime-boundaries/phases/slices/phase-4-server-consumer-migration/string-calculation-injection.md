# String-Calculation Injection

Status: complete at `645f562a3`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move deterministic string calculation to a neutral owner while injecting the
runtime-specific chat/global variable resolver.

## Boundary And Contract

Preserve numeric and string operations, comparison and fallback behavior, and
variable lookup semantics. The browser facade injects the browser backend;
Fastify CBS and trigger effects inject the Fastify-local backend. Delivered
delta: two production runtime/mixed root-`src` edges; 187 total edges became
185.

## Verification

Shared calculation behavior/ownership/import-boundary and Fastify conditionals,
prompt variables, and triggers passed 9, 1, 2, 27, 33, and 143 tests. Both
typechecks, the 185-edge inventory, formatting, and diff checks passed.
