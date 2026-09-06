# Parser Chat-Variable Injection

Status: complete at `5e7233e2a`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Make RisuChat conditional variable reads host-injected so Fastify parsing uses
its request-scoped backend without registering it into browser module state.

## Boundary And Contract

The browser backend remains the parser default. Fastify injects the same local
chat/global readers used by CBS at direct expansion and recursive callback
entry points. Conditional syntax and truthiness are unchanged.

## Verification

Fastify prompt variables and assembly passed 34 and 135 tests; browser
conditionals and loops passed 27 and 11 tests. Both typechecks, architecture
gates, formatting, and diff checks passed.
