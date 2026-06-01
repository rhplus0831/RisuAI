# Payload Size Budgets

Status: implemented.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/save.ts`

## Scope

Define and track payload budgets for bootstrap, targeted projection, import,
export, and bundle flows.

Active slice scope:

- Bootstrap projection payload metrics.
- Targeted projection payload metrics.
- Message-light contracts for bootstrap and targeted projection responses.
- Chat message hydration documented as the intentional message-bearing
  projection exception.
- Import/export and bundle export remain documented large-payload flows; no hard
  thresholds are introduced for them in this slice.

Implemented scope:

- Added a focused API regression test for bootstrap and targeted projection
  `payloadBytes` metrics.
- Kept bootstrap and targeted projection message-light by asserting chat
  histories remain stubbed out of both responses.
- Compared bootstrap and targeted projection payloads against the explicit
  `chatMessages` hydration payload for a message-heavy history instead of
  freezing brittle absolute byte limits.
- Left `.risu` export and bundle export as explicitly large-payload flows; this
  slice does not set ordinary projection-style thresholds for them.

## Protocol Behavior

- Use metrics before setting hard thresholds.
- Keep message-light bootstrap and targeted projection as explicit contracts.
- Treat large import/export payloads differently from ordinary projection
  payloads.
- Use relative/readout guards before byte ceilings: bootstrap and targeted
  projection must stay far smaller than the explicit chat-message hydration
  payload for message-heavy histories.

## Done When

- Bootstrap and projection payload sizes can be compared across changes. Done.
- Import/export budget or cap behavior is documented. Done.
- Regressions have an obvious place to update or justify. Done.

## Validation

- Payload metric tests or manual readout.
- `pnpm api:test __tests__/payloadBudgets.test.ts __tests__/bootstrap.test.ts __tests__/projection.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
