# Server-Tool Contract

Status: ready.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move server-tool definitions, calls, results, rounds, bounds, and compatibility
validators from the browser application tree into an explicit schema-first
`@risuai/protocol/server-tool` subpath.

## Source And Destination

- `src/ts/process/request/serverToolProtocol.ts` to
  `@risuai/protocol/server-tool`.
- Browser completion callers and Fastify generation routes, frames, prompt
  dispatch, provider adapters, and tool helpers adopt the package exports.
- The current boundary cursor classifies eight direct production edges to the
  source: six type-only and two mixed runtime/type consumers.

## Behavior Contract

- Preserve definition, call, result, and round shapes, including opaque JSON
  schema/argument records and optional Gemini thought signatures.
- Preserve every existing count, string, schema, argument, result, signature,
  and aggregate-payload bound plus provider-safe name rules and exact validation
  errors.
- Preserve duplicate definition/call detection, JSON serialization and cloning,
  allowed-tool enforcement, and exact call/result cardinality and identity.
- Tool execution, provider request/response translation, prompt construction,
  authentication, active-writer authority, persistence, and error policy remain
  in their current owners.
- Rollback restores the old contract module and consumer imports together.

## Validation

Focused protocol and existing server-tool fixtures, browser completion and
Fastify generation tests, protocol import audit, `pnpm check:protocol`, `pnpm
check:server`, `pnpm check`, affected tests, formatting, and `git diff --check`.

## Done When

- Tool DTOs, bounds, and compatibility validators are exported from the
  explicit protocol subpath with schema-derived public types.
- Browser and Fastify consumers use the package owner and fixtures prove valid
  round trips plus every bounded, duplicate, unavailable-tool, and mismatched
  result rejection class.
- The old application-tree protocol module is removed.
- The architecture baseline records the exact eight-edge reduction without
  moving tool execution, provider, prompt, authorization, or writer policy.

Stop if extraction changes an accepted payload or error, weakens any size or
identity check, broadens provider-safe names, or requires execution/security
behavior to move into the protocol package.
