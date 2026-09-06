# Chat Load-Page Normalization

Status: complete at `c12e807a5`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core foundation at `d798740f7` and historical parity proof
at `d78c67a3a`.

## Objective

Move the browser/Node-neutral chat-load page defaults and normalizer from the
browser tree into the audited shared-core owner without changing persisted
settings or hydration behavior.

## Source And Destination

- Source: `src/ts/chatLoadPages.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: Fastify database defaulting plus browser storage normalization,
  route loading, chat hydration, and chat rendering helpers.

## Behavior Contract

- Preserve initial/additional defaults `30` and `15`.
- Preserve numeric and string coercion, flooring, non-finite/less-than-one
  fallback, and fallback normalization exactly.
- Keep narrow `{ chatLoadInitialPages?: number }` and
  `{ chatLoadAdditionalPages?: number }` inputs; do not accept `Database`.
- Do not change payloads, settings keys, persistence, revisions, events,
  invalidation, route loading, rendering windows, or UI behavior.

## Validation

Shared-core import audit and typecheck, existing normalization fixtures,
storage/defaulting/hydration/route/render owning tests, affected frontend and
server lanes, both typechecks, architecture inventory, formatting, and
`git diff --check`.

## Done When

- All production consumers use the shared subpath.
- The browser-tree implementation is deleted and the cross-runtime edge count
  drops without a new exception.
- Focused parity and owning tests pass with no settings, payload, or rendering
  behavior change.

Stop if the helper needs browser reactivity, aggregate state, route policy,
persistence, or a host-specific dependency.

## Result

- Moved both defaults, the value normalizer, and narrow settings getters to
  `@risuai/shared-core/chat-load-pages` without changing their inputs or
  results.
- Migrated Fastify defaulting plus every browser storage, hydration, route, and
  render consumer, then removed the browser-tree module.
- Added a closed-world production-consumer probe and extended the shared-core
  import audit. The reviewed boundary fell from 336 to 335 edges, with
  production edges falling from 233 to 232.
- Focused tests, complete frontend/server lanes, current compatibility, both
  typecheck families, architecture inventory, formatting, and diff checks
  passed. The final aggregate remains owned by portfolio closeout.
