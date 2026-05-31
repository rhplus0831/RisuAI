# Svelte Frontend Audit

Last audited: 2026-05-31.

This audit targets recurring Svelte UI-related runtime failures in the
server-backed frontend. `pnpm check` was clean at audit time, so the findings
focus on bugs that can pass static diagnostics: direct writes into read-only
server projections, stale async UI state, manual component mounting, event
bubbling inside nested controls, and non-reactive `window` reads.

The audit used parallel subagents for chat surfaces, sidebars/settings, shared
widgets, and projection/state integration. The chat and sidebars/settings
subagent reports are folded into these notes; the main thread independently
checked the high-risk line references and added the projection/rendering
sections.

## Files

- [chat-ui.md](chat-ui.md) - chat screen, generation controls, suggestions, and
  message rendering.
- [server-projection-state.md](server-projection-state.md) - server-backed
  `DBState` mutation risks and stale optimistic UI paths.
- [settings-sidebar.md](settings-sidebar.md) - settings, sidebar navigation,
  plugin controls, and config editors.
- [rendering-lifecycle.md](rendering-lifecycle.md) - manual Svelte mounting,
  DOM lifecycle, contenteditable, portals, and resize/reactivity hazards.

## Baseline

- `pnpm check` completed with `0 errors and 0 warnings`.
- The absence of Svelte diagnostics does not clear the runtime risks below,
  because many of them happen through DOM APIs, manually mounted components,
  async callbacks, or server-projection proxy traps.
