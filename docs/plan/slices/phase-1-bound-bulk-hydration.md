# Phase 1: Bound Bulk Hydration

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-1-bound-bulk-hydration)

Status: planning slice.

Goal: prevent export/tokenizer/cold-storage flows from opening an unbounded
number of projection requests.

## Implementation Slices

### 1.1 Bounded-Concurrency Helper

- Add a small bounded-concurrency helper in client code near the hydration
  bridge or a shared server-client utility.
- Start with a conservative limit such as 4 or 6 concurrent requests.
- Make the limit a constant, not a setting, unless real usage later shows it
  needs tuning.

Done when callers can fan out work with a fixed maximum number of active
requests.

### 1.2 Chat Hydration Fanout

- Use the helper in `ensureAllChatsHydrated()`.
- Keep current in-flight dedupe behavior inside `hydrateChat()`.
- Keep current stale-revision and reset-generation behavior inside
  `hydrateChat()`.

Done when bulk chat hydration still hydrates every missing chat while honoring
the concurrency cap.

### 1.3 Character Lorebook Hydration Fanout

- Use the helper in `ensureAllCharacterLorebooksHydrated()`.
- Keep current in-flight dedupe behavior inside `hydrateCharacterLorebook()`.
- Keep current stale-revision behavior inside `hydrateCharacterLorebook()`.

Done when bulk lorebook hydration still hydrates every missing lorebook while
honoring the concurrency cap.

### 1.4 Concurrency Tests

- Assert that bulk hydration concurrency is bounded.
- Avoid tests that depend on exact request ordering.
- Preserve tests for duplicate request collapse and stale-response drops.

Done when tests prove the cap without making hydration order part of the
contract.

## Acceptance

- Bulk hydration still hydrates every missing chat/lorebook.
- In-flight dedupe still collapses duplicate requests for the same id.
- Reset generation logic still drops stale hydration responses.
- Tests assert that concurrency is bounded without requiring request ordering.

## Validation

- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
