# Schema Hot Envelope Validation

Status: planned.

## Source Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/assets.ts`

## Scope

Add Fastify schemas to hot route envelopes where compiled validation or
serialization helps without creating schema drift.

## Protocol Behavior

- Start with stable envelopes, not complex legacy polymorphic payloads.
- Preserve current error codes and response shapes where clients depend on
  them.
- Prefer schemas that also document route ownership and payload limits.

## Done When

- At least one hot route family has schema coverage.
- Invalid payload tests prove compatible error behavior.
- Schema maintenance burden is documented for future routes.

## Validation

- Focused route tests for schemas added.
- `pnpm api:test`
