# RisuChat Parser-Helper Ownership

Status: complete at `574eacd3c`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the dependency-free RisuChat parser helper vocabulary to a neutral owner
used by browser parsing and Fastify CBS/generation consumers.

## Boundary

- Risu escape/unescape mappings.
- Date/time token formatting and its input bound.
- Legacy block matching.
- Array/dictionary parsing, array construction, and line trimming.
- Delivered delta: five production runtime root-`src` edges; 195 total edges
  became 190.

## Behavior Contract

Preserve private-use mappings, replacement order, current/local time behavior,
English month/weekday formatting, JSON and `§` fallbacks, `::` escaping,
unknown dictionary value behavior, and whitespace trimming. The parser, CBS
registry, matcher dispatch, `calcString`, and chat-variable backend stay put.

## Verification

Shared behavior/ownership and browser escaping passed 5, 1, and 12 tests.
Fastify prompt variables, CBS scripts, display sources, and generation chat
passed 33, 58, 3, and 181 tests. Both typechecks, the 190-edge inventory,
formatting, and diff checks passed.
