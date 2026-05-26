# Phase 9 Slice 9H - Character Lore, Script, Prompt, TTS, and Chat Names

Date: 2026-05-26

## Summary

- Character script editors now draft `customscript` and `triggerscript`
  locally, then apply trusted projection updates for the existing script
  definition watcher to dispatch replacement commands.
- Character prompt and TTS fields in `CharConfig.svelte` now bind through
  the character draft bridge instead of writing directly to
  `DBState.db.characters`.
- Character and chat lore tabs now edit local lore drafts and apply trusted
  projection updates for the existing lorebook watcher to dispatch
  character/chat lore replacement commands.
- Chat-name edits in `ChatList.svelte` now edit local draft names and
  dispatch chat metadata commands in Fastify-web mode.
- Lorebook add/import and local activation helpers now wrap intentional
  optimistic projection mutations with `withTrustedServerProjectionWrite`.

## Verification

```bash
pnpm exec svelte-check --tsconfig ./tsconfig.json
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
```

## Follow-Up

- At this slice closeout, Phase 9 Slice 9I was next: sidebar toggles,
  custom sidebar/loadout helpers, welcome setup, and runtime API write
  classification.
- `LoreBookList.svelte` still contains legacy fallback branches that mention
  direct character/chat lore paths, but the active character/chat lore tab
  now passes drafts through `externalLoreBooks`. Revisit these fallback
  branches during the final 9J broad direct-write sweep.
