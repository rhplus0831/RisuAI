# Request Count Budgets

Status: implemented.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `src/ts/server/projection.ts`
- `src/ts/bootstrap.ts`
- `src/ts/server/chatMessageHydration.test.ts`

## Scope

Add tests or diagnostics that catch request-count regressions in hot workflows
such as bulk hydration, targeted projection, memory jobs, and asset-heavy views.

Implemented scope:

- Added a hydration `requestsStarted` diagnostic counter so request starts can
  be compared separately from bulk workflow attempts.
- Added a maintained all-chat hydration guard: many stubbed chats hydrate
  through one bulk request, no per-chat requests, and a repeated already-hydrated
  call does not start another request.
- Added the matching all-character-lorebook guard for `enableLorebookStubs`:
  many stubbed character lorebooks hydrate through one bulk request, no
  per-character requests, and cached follow-up calls start no new requests.

## Protocol Behavior

- Start with development diagnostics where stable CI thresholds would be
  brittle.
- Promote stable workflows to tests once expected counts are known.
- Record intentional exceptions in the relevant phase or slice.
- The implemented chat and character-lorebook guards treat user-triggered
  all-history hydration as one intentional bulk request and cached
  follow-up/render-loop calls as zero new requests.

## Done When

- At least one hot workflow has a maintained request-count guard.
- The guard distinguishes user-triggered all-history workflows from render-loop
  regressions.

Done.

## Validation

- Budget tests introduced by this slice.
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
