# Client Resource Ownership Latest Verification

Date: 2026-08-31

Implementation commit under verification: `aaf66b75d`.

Final portfolio gate: `7e03538ea`.

Environment: Node.js `v24.19.0`, pnpm `11.23.0`.

## Consumer Migration Proof

- Route and invalidation reads hydrate `lorebookPageOwner` without a duplicate
  request. Normal page consumers read the shared owner view, and observer
  projection teardown resets it.
- Explicit UI selection resolves a unique stable lorebook id and uses the
  owner's accepted/queued/failed contract. Pending and queued states are
  visible; replay settlement retries an authoritative read; current failures
  retain owner rollback semantics.
- Structural collection repair projects into the owner, but collection and body
  ownership stays on the existing lorebook bridge. The obsolete
  `selectGlobalLorebook` and `dispatchSelectGlobalLorebook` path is gone.
- The legacy plugin key, database replica, and cold process fallback are the
  closed-world `client-lorebook-page-compatibility` surface.
- Compatibility is exactly 9,889 references across 326 groups, six bridges, and
  20 temporary-seam rows.

## Commands

- Exact focused tests passed for the page owner (13), route loader (15), resource
  invalidation (101), lorepreset (10), Svelte lorebook bridge (99), bridge
  contract (22), lorebook list (21), lorebook setting (8), process guard (11),
  frontend architecture (29), durable selection persistence (4), and Fastify
  settings/plugin command range (15).
- `pnpm test -- server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts` —
  passed its production build and all 9 browser scenarios, including one
  focused hydration request, stable-id selection, visible accepted state, and
  reload persistence.
- `pnpm exec tsx util/architecture-inventory.ts` — passed 315 cross-runtime
  edges (153 runtime/mixed), 20 compatibility surfaces/42 probes, 9,889 client
  references across 326 groups, six bridges, 20 seams, and all 56 owner gap
  rows.
- `pnpm check` — passed with zero errors and zero warnings.
- `pnpm check:server` — passed protocol, architecture, declarations, Fastify,
  and browser-smoke typechecks.
- Focused Prettier and `git diff --check` — passed.

## Verdict

Phase 2 is accepted at `aaf66b75d`. Normal lorebook-page consumers and explicit
selection now use the owner without payload or request widening. Phase 3 remains
blocked until the matching Workstream 1 contracts and Workstream 2 canonical
owners are released.
