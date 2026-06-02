# Schema Hot Envelope Validation

Status: implemented.

## Source Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/assets.ts`

## Scope

Add Fastify schemas to hot route envelopes where compiled validation or
serialization helps without creating schema drift.

Active slice scope:

- `POST /api/v1/assets/exists`
- `POST /api/v1/projection/chatMessages/bulk`

These are read-only POST envelopes with stable `{ ids: string[] }` request
shapes. They do not mutate durable state, bump revisions, persist command
events, require rollback behavior, or change resync behavior.

Implemented scope:

- Added Fastify request-body schemas for the two read-only POST envelopes.
- Preserved route-local `400` response envelopes with attached validation and
  pre-validation checks that avoid AJV scalar-to-array coercion changing
  protocol behavior.
- Kept protected bulk chat hydration authenticated before schema/pre-validation
  errors by adding an `onRequest` auth gate.
- Deferred command, generation, and broader asset bulk schemas because their
  payloads are polymorphic or wider than this slice.

## Protocol Behavior

- Start with stable envelopes, not complex legacy polymorphic payloads.
- Preserve current error codes and response shapes where clients depend on
  them.
- Prefer schemas that also document route ownership and payload limits.
- Use attached validation when needed so route-local handlers can preserve
  existing protocol error envelopes instead of leaking Fastify's default
  validation response shape.
- Account for Fastify/AJV coercion when preserving route contracts; add
  route-local pre-validation if a schema would otherwise turn invalid scalars
  into accepted arrays.

## Done When

- At least one hot route family has schema coverage. Done.
- Invalid payload tests prove compatible error behavior. Done.
- Schema maintenance burden is documented for future routes. Done.

## Validation

- Focused route tests for schemas added.
- `pnpm api:test __tests__/assets.test.ts __tests__/projection.test.ts __tests__/routeProtection.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
