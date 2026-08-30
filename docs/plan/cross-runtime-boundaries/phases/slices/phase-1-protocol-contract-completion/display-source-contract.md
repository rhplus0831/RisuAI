# Display-Source Contract

Status: ready.

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
