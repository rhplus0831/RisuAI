# MCP OAuth Refresh Contract

Status: ready.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the stored MCP OAuth refresh request and access-token success DTOs into an
explicit schema-first `@risuai/protocol/mcp-oauth-refresh` subpath.

## Source And Destination

- `src/ts/server/mcpOAuthRefreshProtocol.ts` to
  `@risuai/protocol/mcp-oauth-refresh`.
- The browser refresh caller and Fastify refresh executor adopt the package
  exports.
- The current boundary cursor classifies one direct production type-only edge.

## Behavior Contract

- Preserve the exact `{ url }` request and `{ accessToken }` success shapes.
- MCP identity syntax and bounds, stored refresh records and secrets, token URL
  and egress policy, refresh-token rotation, timeouts, body/response limits,
  upstream parsing, cancellation, error codes, and masking remain Fastify- or
  caller-owned as today.
- The protocol package gains no credential resolution or network behavior.
- Rollback restores the old DTO module and both consumer imports together.

## Validation

Focused exact-envelope fixtures, existing browser/Fastify MCP OAuth refresh
tests, protocol import audit, `pnpm check:protocol`, `pnpm check:server`, `pnpm
check`, affected tests, formatting, and `git diff --check`.

## Done When

- Both envelopes are schema-derived at the explicit package subpath.
- Browser and Fastify consumers use the package owner and reject unknown or
  malformed envelope fields at their existing policy boundaries.
- The old application-tree DTO module is removed.
- The architecture baseline records the exact one-edge reduction without moving
  credentials, egress, rotation, bounds, masking, or network authority.

Stop if extraction exposes a stored secret, changes request/response acceptance,
or requires identity, egress, rotation, or error policy to move.
