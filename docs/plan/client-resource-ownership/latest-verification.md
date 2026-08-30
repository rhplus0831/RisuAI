# Client Resource Ownership Latest Verification

Date: 2026-08-31

Implementation commit under verification: `3b74261c1`.

Phase 2 predecessor: `aaf66b75d`.

Final portfolio gate: `1b1152814`.

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
- The Phase 2 checkpoint carried 9,899 references across 326 groups, six bridges, and
  20 temporary-seam rows.

## Character-Summary Proof

- Workstream 1's versioned summary contract and Workstream 2's singular SQLite
  owner release bound the slice to summary-only data.
- `MobileCharacters.svelte` reads `charactersResourceState` and
  `settingsResourceState`; it no longer reads the aggregate resource database.
- Summary `chatCount` drives the displayed count and `activeChatId` drives
  stable navigation. Legacy/imported shell rows retain bounded chat-array and
  chat-page fallbacks.
- Search, sort, trash filtering, relative time/locale changes, create/open
  actions, and route stability remain covered. Character/chat bridges, lazy
  detail/transcript hydration, drafts, commands, and generation are unchanged.
- The exact inventory is now 9,888 references across 326 groups, six bridges,
  and 20 temporary-seam rows.

## Commands

- Exact focused tests passed for the page owner (13), route loader (15), resource
  invalidation (101), lorepreset (10), Svelte lorebook bridge (99), bridge
  contract (22), lorebook list (21), lorebook setting (8), process guard (11),
  frontend architecture (29), durable selection persistence (4), and Fastify
  settings/plugin command range (15).
- The mobile character component passed 2 focused action/navigation tests; the
  GridCatalog suite passed all 14 list/filter/locale integration tests.
- Character/chat owner release evidence passed all 5 legacy import tests and all
  28 message-store ownership/import-fallback tests.
- `pnpm test -- server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts` —
  passed its production build and all 9 browser scenarios, including one
  focused hydration request, stable-id selection, visible accepted state, and
  reload persistence.
- `pnpm exec tsx util/architecture-inventory.ts` — current portfolio gate passed
  158 cross-runtime edges (90 runtime/mixed), 20 compatibility surfaces/42 probes, 9,888 client
  references across 326 groups, six bridges, 20 seams, and all 56 owner gap
  rows.
- `pnpm check` — passed with zero errors and zero warnings.
- `pnpm check:server` — passed protocol, architecture, declarations, Fastify,
  and browser-smoke typechecks.
- Focused Prettier and `git diff --check` — passed.

## Verdict

Phase 2 remains accepted at `aaf66b75d`. The first Phase 3 summary-only consumer
is accepted at `3b74261c1` without payload widening, chat hydration, or bridge
changes. The next character/chat consumer remains blocked until its matching
Workstream 1 contract and owner API are released.
