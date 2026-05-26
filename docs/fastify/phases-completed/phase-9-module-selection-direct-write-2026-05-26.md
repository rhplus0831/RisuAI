# Phase 9 Slice - Module Selection Direct Writes

Date: 2026-05-26

## Landed

- Removed the direct `modules ??= []` initialization when opening the
  chat module menu from `DefaultChatScreen.svelte`.
- Replaced module-menu chat module mutations with
  `toggleSelectedChatModule`, which performs the optimistic projection
  update inside `withTrustedServerProjectionWrite` and dispatches the
  existing chat update command.
- Replaced module-menu character module mutations with
  `toggleSelectedCharacterModule`, which performs the optimistic
  projection update inside `withTrustedServerProjectionWrite` and
  dispatches the existing character-module reorder command.
- Added `src/ts/moduleCommands.test.ts` coverage proving both helpers
  work while the Fastify projection guard rejects direct writes.

## Verification

```bash
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/server/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

## Remaining Phase 9 Pickup

Continue the broader direct-write audit. The next high-yield surface is
direct Svelte bindings to `DBState.db`, especially Bot/OtherBot/Prompt
settings and `CharConfig`.
