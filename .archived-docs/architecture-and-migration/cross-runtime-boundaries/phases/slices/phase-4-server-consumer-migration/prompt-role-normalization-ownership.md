# Prompt Role Normalization Ownership

Status: complete at `663019ccb`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move dependency-free prompt-block role normalization and prompt-template row
normalization to neutral shared owners used by browser and Fastify consumers.

## Boundary And Contract

- `@risuai/shared-core/prompt-block-role` owns the closed role vocabulary,
  aliases, and fallback behavior.
- `@risuai/shared-core/prompt-template-normalization` owns structural row
  normalization without importing browser prompt/database declarations.
- Browser modules remain facades for existing callers; Fastify imports the
  shared leaves directly.
- Prompt selection, persistence, hydration, rendering policy, command
  authorization, and compatibility fallback remain in their runtime owners.

Delivered delta: two production runtime edges and two browser-owned source
targets. The checked boundary moved from 160 to 158 edges.

## Verification

Prompt-block role, closed ownership, and prompt-template normalization suites
passed 4, 4, and 5 tests. Shared-core import/type gates, browser/server owning
tests, architecture inventory, root/server typechecks, formatting, and diff
checks passed.
