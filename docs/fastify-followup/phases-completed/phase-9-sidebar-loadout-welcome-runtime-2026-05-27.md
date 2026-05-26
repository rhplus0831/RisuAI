# Phase 9 Slice 9I - Sidebar, Loadout, Welcome, and Runtime API Writes

Date: 2026-05-27

Commit: `c1966217`

## Summary

- Sidebar prompt toggles now edit `globalChatVariables` through a
  server-backed settings draft, and the jailbreak toggle uses the same
  command-backed draft path.
- Custom sidebar configuration now edits a `customSidebarItems` draft
  instead of mutating the projected database array directly.
- The custom sidebar model shortcut now binds `aiModel` through a
  server-backed draft.
- Loadout favorite/delete/save/apply helpers now wrap optimistic loadout
  projection mutations with `withTrustedServerProjectionWrite`; applying
  loadout global variables goes through grouped settings commands.
- Welcome setup now routes language, username, provider keys, first-run
  model/runtime/language flags, and `didFirstSetup` through grouped
  settings commands. The prebuilt preset application is wrapped as an
  intentional trusted projection update.
- Runtime plugin API setters for color/text themes and character/chat
  replacement now wrap their optimistic projection mutations. The plugin
  database bridge now classifies `globalChatVariables`,
  `jailbreakToggle`, and `customSidebarItems` as settings-backed keys.
- Client and Fastify settings command allowlists now cover
  `globalChatVariables`, `jailbreakToggle`, and `customSidebarItems`.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

## Follow-Up

- Continue with Phase 9 Slice 9J: final direct-write sweep, allowlist
  gaps, browser smoke, and Phase 9 closeout.
- The current focused grep still reports remaining direct bindings in
  BotSettings prompt/manual settings, LoreBookList global lore fallback,
  and TriggerV2 deprecated-toggle controls:
  `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`.
