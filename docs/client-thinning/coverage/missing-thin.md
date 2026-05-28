# Missing Or Thin Coverage

Date: 2026-05-28

## Open

- Audit fixtures/tests are missing for most rule families; the reusable
  harness plus `A4R-saveasset filename classification` and
  `A4R-backup data dir inventory` and
  `A4R-bounded process-lifetime accumulators` proofs exist.
- `sendChat` server prompt assembly is not default-thin because
  `useServerPromptAssembly` defaults false.
- Default chat-screen submission still performs browser-side durable transcript
  edits before `sendChat` and dispatches commands afterward.
- Server-backed sendChat still replays some server-detected message/scriptstate
  mutations through the browser command bridge.
- Post-generation thinning remains mixed between server and browser.
- Manual legacy local client verification remains separate/deferred.

## Intentionally Thin

- Command events are invalidation events, not patch contracts.
- Browser plugin runtime remains client-owned.
- Browser UI and transient interaction state remain client-owned.
- Legacy local mode is not the Fastify projection target.

## Do Not Use As Proof

- Archived closeout prose by itself.
- Helper existence without route/helper tests.
- A passing audit rule without fixture/test reproducibility once audit
  reproducibility work begins.
- Local browser fallback behavior in Fastify mode unless the route resolver
  explicitly classifies it as unavailable/non-Fastify.
