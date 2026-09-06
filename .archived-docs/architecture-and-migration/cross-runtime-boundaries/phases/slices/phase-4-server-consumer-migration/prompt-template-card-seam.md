# Prompt-Template Card Seam

Status: complete at `ee87bc6ac`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: prompt-row ownership at `701bc555f`.

## Objective

Give Fastify prompt normalization, preflight, memory, and rendering a closed
server-owned prompt-template card union instead of browser `PromptItem` types.

## Boundary

- Cards: plain/jailbreak/cot, ChatML, typed content, author note, chat range,
  and cache-point variants.
- Delivered delta: four production and three server-test type-only
  browser-application-model edges.

## Behavior Contract

Preserve null/empty templates, implicit `postEverything`, utility-bot template
selection, roles and wrapping, author-note defaults, chat ranges, cache
depth/role, stable-card caching, row order, and no-mutation behavior. Template
normalization and rendering remain at their existing runtime owners.

## Verification

Memory, preflight, templates, and the closed ownership suites passed 10, 28, 71,
and 1 tests. Both typechecks, the 251-edge architecture inventory, formatting,
and diff checks passed.
