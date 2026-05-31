# Phase 8: Explicit Route Rate Limits

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-8-explicit-route-rate-limits)

Status: planning slice.

Goal: add operational protection without breaking long-lived protocol streams.

## Implementation Slices

### 8.1 Route Risk Inventory

- Keep the plugin registration compatible with current behavior.
- Inventory abuse-prone routes before applying limits.
- Candidate routes include auth setup/login/crypto, proxy fetch and proxy
  stream job creation, generation and preview-prompt submission, Realm import
  and `.risu` import, asset upload, and bulk asset upload.

Done when selected routes have documented reasons for route-level limits.

### 8.2 Route-Level Limits

- Add explicit route-level limits where useful.
- Keep limits narrow enough for normal app workflows.
- Document at least one route-level limit in tests.

Done when abuse-prone routes have explicit limits without introducing a generic
global throttle.

### 8.3 Streaming Exclusions

- Do not apply ordinary request-per-minute limits to long-lived SSE routes.
- Do not apply ordinary request-per-minute limits to WebSocket attachment
  routes without a separate design.
- Preserve normal generation streams, event streams, and WebSocket attach flows.

Done when streaming routes are intentionally excluded or covered by a separate
stream-safe design.

### 8.4 Smoke Validation

- Smoke login, events, generation, and proxy stream job attach.
- Confirm route limits protect selected endpoints without cutting off long-lived
  protocol streams.

Done when both route-level protection and streaming exclusions are validated.

## Acceptance

- Abuse-prone routes have explicit limits.
- Normal generation streams, event streams, and WebSocket attach flows do not
  get cut off by generic request throttles.
- Tests document at least one route-level limit and intentional streaming
  exclusions.

## Validation

- `pnpm api:test`
- Manual smoke for login, events, generation, and proxy stream job attach.
