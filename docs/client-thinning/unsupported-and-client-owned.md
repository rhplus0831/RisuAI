# Client-Owned, Unsupported, And No-Port Behavior

Date: 2026-05-28

This file records behavior that should not be treated as an automatic
client-thinning target. Detailed positive server coverage lives in `status/`
and `coverage/` shards.

## Client-Owned Behavior

- Rendering, layout, local selection state, modals, drafts, keyboard shortcuts,
  and other UI-only state.
- Browser route/navigation state and transient interaction state.
- Plugin runtime execution. Server commands own plugin records and plugin
  storage, not arbitrary plugin code execution.
- Browser-only media and file picker APIs.
- Browser display of command failures, active-writer reload prompts, and
  projection refresh state.
- Browser-side application of bootstrap projections and event-driven refreshes.
- Local prompt/sendChat behavior until a named server contract and proof remove
  the branch.

## No-Port Or Removed Areas

Do not port these as part of client thinning unless a new plan explicitly
reopens them:

- Native/mobile wrapper runtime modes.
- Browser local persistence as the primary supported runtime.
- Tauri, Hono, Express, service worker persistence, or alternative servers.
- Peer sync, Google Drive sync, and Risu Account Sync.
- Group chat.
- SupaMemory, Hypa V2, Hanurai, and removed browser-local memory engines.
- Server-side plugin code execution.
- Per-event surgical projection patching without a separate event contract.

## Deferred Or Separate Work

- Manual legacy local client verification is separate from Fastify projection
  hardening.
- Prompt assembly defaulting and sendChat post-generation thinning are valid
  client-thinning sub-families, but they need their own scope, contract, and
  proof.
- Legacy storage route naming is historical. `/api/v1/storage/*` remains active
  for current Fastify web behavior and should not be removed by filename alone.

## Unsupported Provider Shapes

Fastify mode should not silently use browser provider dispatch. Unsupported
provider shapes should fail explicitly through
`resolveServerCompletionRoute()` or the relevant server route.

Provider expansion needs one named route contract, request shape, credential
boundary, response extraction rule, warning/error behavior, and tests.
