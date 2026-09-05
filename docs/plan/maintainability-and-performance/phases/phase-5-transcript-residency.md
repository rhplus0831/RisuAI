# Phase 5: Transcript Residency Decision

Finding: F08. Dependency: Phase 4 accepted. Remeasure after Phase 2 browser
changes; progress and the decision belong in [status.md](../status.md).

## Objective and Owners

Determine whether accumulated mounted rows violate the agreed supported chat
envelope, then implement bounded residency if the benefit warrants it.

Read [chat UI](../../../../src/docs/svelte-chat-ui.md). Owners:
`src/lib/ChatScreens/DefaultChatScreen.loadPages.ts`,
`src/lib/ChatScreens/DefaultChatScreen.svelte`,
`src/lib/ChatScreens/Chats.svelte`, `src/lib/ChatScreens/ChatBody.svelte`, and
`src/ts/server/chatMessageHydration.svelte.ts`.

## 5a: Decision Gate

- Repeat Phase 1's short/long transcript measurements, including repeated older
  page loads, jump-to-message, variable-height images/Markdown, streaming, and
  mobile layout. Separate data hydration, parser work, and mounted DOM cost.
- Classify explicit full-transcript workflows. Screenshot mode currently calls
  `hydrateActiveChatFully` and sets `loadPages = Infinity` in
  `src/lib/ChatScreens/DefaultChatScreen.svelte`; data export/tokenization may
  also require full hydration without requiring all rows to stay mounted. Decide
  which workflows are inside the interactive residency envelope before setting
  a transcript-length-independent bound.
- Compare measured mounted rows, heap, and scrolling/layout against the budgets
  agreed before implementation. Initial paging already limits first render;
  evaluate the accumulated session cost rather than claiming paging is absent.
- Record one decision: implement viewport-based residency, implement an explicit
  resident-page bound, or retain current paging with measured justification.
  Include the supported fixture envelope and a precise revisit trigger.

Retention is a resolved design decision, not a claim that mounted rows are now
bounded. If evidence is insufficient to decide, keep F08 open.

## 5b: Implementation If Justified

- Bound mounted rows with stable message IDs and measured height/spacer state.
  Preserve scroll anchors while loading older messages and while media changes
  height. Keep hydration and display-residency ownership separate.
- Protect active editors, selection/focus, reroll targets, translations, and
  streaming rows from eviction. Bound any row exceptions and height/parser caches.
- Preserve jump/navigation behavior, new-message indicators, scroll-to-bottom,
  keyboard and screen-reader navigation, mobile touch, and folded history.
- Document browser text-find, copying, search, and export behavior before choosing
  virtualization. If required interactions cannot be preserved, choose a different
  resident-bound strategy or retain paging; do not silently remove user behavior.
- Preserve full-chat screenshots. If capture still requires full materialization,
  declare it as a user-triggered temporary mode with a separate measured cost and
  restore ordinary residency on success, failure, or cancellation. Do not let a
  completed screenshot leave the interactive transcript permanently unbounded.

## Acceptance and Verification

For an implementation, ordinary interactive history traversal must respect the
recorded mounted-row bound independent of transcript length, apart from explicit
bounded interaction exceptions. Temporary full-capture modes are measured and
reported separately; this bound must not be claimed for those modes. Anchor
stability and user interactions must pass real-browser checks; Happy-DOM does
not establish layout/scroll correctness.

Existing owners include `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`,
`src/ts/__tests__/renderCostHarness.test.ts`,
`server/fastify/browser-smoke/chatStartupRendering.spec.ts`, and
`server/fastify/browser-smoke/debugEchoLayoutStability.spec.ts`. Extend or add a
focused browser case for accumulated history if the existing cases do not cover
it. Run exact tests through the focused runner; separately run the required cost
probe and browser case, then `pnpm test:agent` for a completed implementation.

For retention, preserve the measurement and decision evidence, update the
finding disposition accurately, and do not add implementation-shaped tests.

Keep the current paging behavior as a bounded rollback option during a residency
cutover. Do not change persisted chats or outbox semantics in this phase.
