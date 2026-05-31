# Payload Size Budgets

Status: planned.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/save.ts`

## Scope

Define and track payload budgets for bootstrap, targeted projection, import,
export, and bundle flows.

## Protocol Behavior

- Use metrics before setting hard thresholds.
- Keep message-light bootstrap and targeted projection as explicit contracts.
- Treat large import/export payloads differently from ordinary projection
  payloads.

## Done When

- Bootstrap and projection payload sizes can be compared across changes.
- Import/export budget or cap behavior is documented.
- Regressions have an obvious place to update or justify.

## Validation

- Payload metric tests or manual readout.
- `pnpm api:test`
