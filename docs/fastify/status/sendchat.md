# sendChat Status

Date: 2026-05-27

## Current State

- Phase 5 extraction closed. The coordinator remains in
  `src/ts/process/index.svelte.ts` with helpers split into focused
  modules.
- Server-backed send, continue, regenerate, preview, and preview-prompt
  work through `/api/v1/generate/chat` behind
  `db.useServerPromptAssembly`.
- The gate defaults off and is independent of `db.useServerGeneration`.

## References

- Fixture coverage: [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md)
- Phase archive: [`../phases-completed/`](../phases-completed/)
