# Standalone-Settings Contract

Status: complete at `33d1643aedcf74aecf3f0d8b549b0313a061c6b1`.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: protocol conventions at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the standalone-setting taxonomy, presence state, revisioned payload, and
runtime guards into an explicit schema-first
`@risuai/protocol/standalone-settings` subpath.

## Source And Destination

- `src/ts/server/standaloneSettingsProtocol.ts` to
  `@risuai/protocol/standalone-settings`.
- Browser resource state, reads, manifest, and invalidation consumers plus the
  Fastify resource-read route adopt the package exports.
- The current boundary cursor classifies one direct production mixed edge.

## Behavior Contract

- Preserve all eight setting names and the exact `{ present: false }` or
  `{ present: true, value }` state variants, including unknown present values.
- Preserve non-negative safe-integer revisions and additive outer payload
  handling while keeping state variants exact.
- Storage ownership, value projection, revision authority, repair,
  invalidation, authentication, and active-writer policy remain in their current
  owners.
- Rollback restores the old module and consumer imports together.

## Validation

Focused taxonomy/payload fixtures, existing browser resource and Fastify
resource-read tests, protocol import audit, `pnpm check:protocol`, `pnpm
check:server`, `pnpm check`, affected tests, formatting, and `git diff --check`.

## Done When

- Names, state variants, and payload are schema-derived at the explicit package
  subpath with behavior-preserving guards.
- Browser and Fastify consumers use the package owner and fixtures prove every
  name, state variant, revision boundary, additive outer field, and rejected
  malformed state.
- The old application-tree contract module is removed.
- The architecture baseline records the exact one-edge reduction without moving
  storage, projection, revision, repair, invalidation, or writer authority.

Stop if extraction changes any accepted payload, rejects a currently supported
unknown setting value, or requires resource/server authority to move.
