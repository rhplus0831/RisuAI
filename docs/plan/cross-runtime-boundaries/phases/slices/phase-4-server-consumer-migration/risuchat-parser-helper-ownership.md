# RisuChat Parser-Helper Ownership

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the dependency-free RisuChat parser helper vocabulary to a neutral owner
used by browser parsing and Fastify CBS/generation consumers.

## Boundary

- Risu escape/unescape mappings.
- Date/time token formatting and its input bound.
- Legacy block matching.
- Array/dictionary parsing, array construction, and line trimming.
- Expected delta: two production runtime root-`src` edges; 195 total edges
  become 193.

## Behavior Contract

Preserve private-use mappings, replacement order, current/local time behavior,
English month/weekday formatting, JSON and `§` fallbacks, `::` escaping,
unknown dictionary value behavior, and whitespace trimming. The parser, CBS
registry, matcher dispatch, `calcString`, and chat-variable backend stay put.

## Validation

Run shared behavior/ownership, CBS strings/conditionals/arrays, server prompt
variables, generation chat, both typechecks, architecture inventory,
formatting, and diff checks.
