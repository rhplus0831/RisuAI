# Phase 9 Slice 9J - Final Direct-Write Sweep

Date: 2026-05-27

## Summary

- The final focused direct-bind sweep is clean:
  `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`.
- Bot prompt/manual fields now edit local drafts and dispatch
  `prompt.settings.updated` through `/api/v1/commands/prompt-settings`
  for `mainPrompt`, `jailbreak`, `globalNote`, `formatingOrder`,
  `promptPreprocess`, and `presetRegex`.
- Custom model flags, `enableCustomFlags`, `moduleIntergration`,
  `modelTools`, and `showDeprecatedTriggerV2` now use server-backed
  settings drafts. Client and Fastify settings allowlists now cover the
  custom flag fields.
- Character/chat lore list fallback branches now apply collection
  changes through the lorebook command bridge with trusted optimistic
  projection updates instead of binding nested `DBState.db` entries
  directly.
- Prompt-settings command validation now includes the durable top-level
  prompt fields that the manual BotSettings editor updates.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
pnpm smoke:fastify-browser
pnpm test
pnpm build
```

## Historical Follow-Up

- At this slice closeout, Phase 9 was closed again and Phase 7A became
  the next default pickup. Current follow-up status lives in
  `../status.md`.
