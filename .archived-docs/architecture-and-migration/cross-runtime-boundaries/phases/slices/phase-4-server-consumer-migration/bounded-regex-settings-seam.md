# Bounded-Regex Settings Seam

Status: complete at `9bcffa62e`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: regex output-size normalization at `83e8aabfa`.

## Objective

Replace the bounded-regex runtime's aggregate browser `Database` declaration
with the smallest Fastify-owned settings input it reads.

## Boundary

- Strict/worker compatibility mode.
- Input, output, and display timeouts.
- Regex output-size limit in MiB.
- Delivered delta: one production and one server-test type-only aggregate
  browser-model edge; 213 total edges became 211.

## Behavior Contract

Preserve compatibility-mode routing, timeout selection and normalization,
worker isolation, output limits, error classification, and all caller-visible
fallback behavior. Do not change regex execution or browser settings ownership.

## Verification

Bounded-regex behavior and closed ownership suites passed 15 and 1 tests. Both
typechecks, the 211-edge architecture inventory, formatting, and diff checks
passed.
