# Display-Source Contract

Status: complete at `07abd8aa562c6486b41935b016ca30a4b40bd33f`.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: client-context contract at
`e729dabe489ce4974cf0f669a74e47ba69927008`.

## Objective

Move the display-source versions, limits, layer taxonomy, request/response DTOs,
context normalization, and namespace canonicalization into an explicit
schema-first `@risuai/protocol/display-source` subpath.

## Source And Destination

- `src/ts/process/displaySourceProtocol.ts` to
  `@risuai/protocol/display-source`.
- Browser parser/display-source callers and Fastify bootstrap, display-source
  route, and service consumers adopt the package exports.
- The current boundary cursor classifies three direct production edges: one
  runtime and two mixed runtime/type consumers.

## Behavior Contract

- Preserve protocol version `1`, transform version
  `editdisplay-v2-ephemeral-state`, all five layers, limits, optional target
  fields, response statuses, and request/response field shapes.
- Preserve page-session trimming/bounds, reported-context normalization,
  recursive array/object dependency normalization, undefined/function omission,
  sorted object keys, and stable namespace serialization.
- Display rendering, parser/CBS execution, cache admission/eviction, service
  batching, persistence, authentication, revision checks, and active-writer
  policy remain in their current owners.
- Rollback restores the application-tree module and consumer imports together.

## Validation

Focused protocol normalization/serialization fixtures, existing browser and
Fastify display-source/bootstrap tests, protocol import audit, `pnpm
check:protocol`, `pnpm check:server`, `pnpm check`, affected tests, formatting,
and `git diff --check`.

## Done When

- All DTOs and taxonomies are schema-derived at the explicit package subpath and
  every compatibility helper preserves exact output.
- Browser and Fastify consumers use the package owner and the old
  application-tree protocol module is removed.
- Fixtures prove context, dependency, namespace, layer, target, and response
  compatibility.
- The architecture baseline records the exact three-edge reduction without
  moving rendering, cache, persistence, authorization, revision, or writer
  policy.

Stop if extraction changes any accepted request/response or canonical string,
weakens a limit, or requires display execution/server authority to move.

## Result

- `@risuai/protocol/display-source` now owns TypeBox schemas and derived types
  for versions, layers, contexts, targets, requests, response variants, and
  namespace inputs plus the existing limits and canonicalization helpers.
- Protocol fixtures prove taxonomies and limits, context normalization, nested
  dependency normalization, stable namespace serialization, every layer and
  fallback status, exact success responses, and rejected cross-pairings.
- Browser parser/display consumers and Fastify bootstrap, route, and service
  consumers use the explicit package subpath; the old application-tree module
  and test owner are removed.
- Rendering, parser/CBS execution, cache behavior, batching, persistence,
  authorization, revisions, and writer policy did not move.
- The boundary cursor fell by exactly three production runtime/mixed edges, from
  341 to 338.
