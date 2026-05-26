# Leftover Audit Closeout

Date: 2026-05-27

## Scope

Closed the `LEFTOVER.md` findings that reopened Phase 3 request
header filtering, Phase 9 command-owned projection writes, and the
Phase 7 `/chat` coverage note.

## Landed

- Hub passthrough now reuses the shared proxy request-header
  normalization and strips the hub-only `x-risu-node-path` override
  before forwarding.
- Command-owned chat/message, chat-list, character-restore,
  persona-pin, translator-preset, character-import, prompt-diff, and
  NanoGPT subscription paths avoid direct Fastify projection writes.
  Local optimistic mutation is kept behind the non-Fastify gate.
- `promptDiffPrefs` is now a server-backed display setting so the
  prompt diff modal can persist through the command API.
- The sendChat fixture coverage doc now states the actual split:
  provider parity is pinned through `/completion`, while the real
  `/chat` route-backed sweep covers send, continue, regenerate,
  preview, and preview-prompt.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

`pnpm build` and `pnpm smoke:fastify-browser` passed with the existing
CSS pseudo-element, externalized dependency, dynamic-import, plugin
timing, and chunk-size warnings.
