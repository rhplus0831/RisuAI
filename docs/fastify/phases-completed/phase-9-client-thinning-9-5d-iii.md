# Phase 9 Client Thinning - 9-5d-iii

Date: 2026-05-26

## Scope

9-3 character/chat UI tails. This sub-slice audited character profile/
asset helpers, chat folders, selected chat/page state, playground,
realm/grid helpers, and legacy chat import helpers before the read-only
`DBState.db` guard.

## Landed

- Confirmed the remaining 9-3 direct-write hits are optimistic local
  updates followed by existing character, chat, chat-folder, message,
  generation, or scriptstate command helpers, or are local UI-only state.
- Fixed compact chat-list creation so the local selected chat is the
  newly unshifted chat, matching the default `createChatCommand`
  server-backed selection behavior.
- Seeded group-chat first messages onto the new compact chat-list chat
  object before insertion and command dispatch instead of writing through
  the previous tail index.
- Made cold-storage character hydration explicitly unsupported in
  server-backed web mode before reading local cold-storage blobs or
  replacing the projected character object.

## Verification

```bash
pnpm exec vitest run src/ts/compatibilityAdapters.test.ts
pnpm check
```

Results:

- `src/ts/compatibilityAdapters.test.ts` - 9 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## Handoff

Continue with **9-5d-iv - 9-4 extension UI/API tails**. Focus on
lorebooks, module UI/MCP helpers, plugin settings, plugin database
translation, and plugin storage. Do not start the read-only projection
guard until 9-5d-iv and 9-5d-v are closed.
