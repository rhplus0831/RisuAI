# MCP Identifier Ownership

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: Phase 3 shared-core conventions.

## Objective

Move the dependency-free MCP importability predicate from the browser tree to a
neutral shared owner used by browser import and Fastify command validation.

## Boundary

- Non-whitespace `internal:`, `stdio:`, and `plugin:` identifiers.
- HTTPS URLs.
- HTTP URLs limited to localhost, IPv6 loopback, and `127.*` hosts.
- Expected delta: one production runtime root-`src` edge; 211 total edges become
  210.

## Behavior Contract

Preserve accepted and rejected strings exactly, including URL parsing behavior.
This leaf classifies import syntax only; DNS resolution, OAuth, credentials,
runtime MCP clients, command writes, and network egress policy remain in their
current owners.

## Validation

Run the shared behavior/ownership suite, browser module import tests, Phase 10
compatibility structure, both typechecks, architecture inventory, formatting,
and diff checks.
