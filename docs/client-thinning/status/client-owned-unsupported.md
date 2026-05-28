# Client-Owned And Unsupported

Date: 2026-05-28

Read this when a candidate task touches browser-only state, legacy runtimes,
plugin execution, provider fallbacks, or sendChat local behavior.

## Client-Owned

- UI rendering and interaction state.
- Browser-only file/media APIs.
- Plugin runtime execution.
- Local draft state and display-only state.
- Event-to-projection refresh behavior.
- Browser display of unsupported errors and active-writer reload prompts.

## Unsupported Or No-Port

- Browser provider fallback in Fastify mode.
- Server-side plugin code execution.
- Native/mobile wrapper runtimes, Tauri, service worker persistence, alternate
  servers, peer sync, Drive sync, Risu Account Sync, group chat, and removed
  memory engines.
- Per-event surgical patches without a new event contract.

## Deferred

- Manual legacy local client verification.
- sendChat prompt assembly defaulting.
- sendChat post-generation thinning.
- Broader provider expansion outside explicit server route contracts.

## Rule Of Thumb

If the behavior changes durable state, it needs a server-owned path and proof.
If it only changes browser display or transient interaction state, keep it
client-owned and document why.
