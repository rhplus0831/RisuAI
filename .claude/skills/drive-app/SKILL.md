---
name: drive-app
description: Launch the RisuAI fastify app and drive it in a headless browser (Playwright) to verify a change visually or measure the live DOM. Use when asked to run the app, screenshot it, or confirm a UI change works in the real app — covers dev-server launch, deep-link routes, and the driving gotchas learned in past sessions.
---

# drive-app

Launch `pnpm dev:agent` (frontend `http://127.0.0.1:6418`, Fastify on 6419 proxied at `/api`; auth + TOS bypassed) and drive it with headless Playwright. Stop the dev server when done — but only yours: a separate vite on **port 6002** is often the user's own session; never `pkill -f vite` broadly, match your port instead.

`dev:agent` serves a **disposable sandbox** (`data-agent/`, cloned from the human `data/` at launch): create/edit/delete anything without worrying about the user's data, and don't bother cleaning up state you created — the next launch re-clones. If a scenario must survive a dev-server restart, relaunch with `RISU_AGENT_DATA_MODE=keep`. Traces land in `data-agent/trace/agent.jsonl`.

## Playwright script setup

- `@playwright/test` resolves from the **script file's location**, not cwd. A script in the session scratchpad cannot import it — write the script as `scripts/temp-<name>.mjs` inside the repo and **delete it before committing**. Run with plain `node scripts/temp-<name>.mjs`.
- Use `chromium.launch({ headless: true })`, viewport ≥ 1600×900 for desktop layout. Collect `page.on('pageerror')`.
- `scripts/temp-select-first-character.mjs`-style click-walking of the sidebar is fragile and theme-dependent. Prefer deep links (below).

## Deep links (fastest, skip all UI walking)

History-based router on `location.pathname` (`src/ts/router.ts`):

- **Open a chat directly**: `http://127.0.0.1:6418/character/<characterId>/<chatId>` (chat id optional: `/character/<characterId>` opens the character). Get ids from the server: `curl -s http://127.0.0.1:6419/api/v1/characters | jq` (or read `getDatabase().characters[n].chaId` / `.chats[n].id` via the API). Wait for `.default-chat-screen`.
- **Open a settings page directly**: `http://127.0.0.1:6418/settings/<slug>` — slugs include `display`, `model`, `prompt`, `advanced`, `input-hooks`, `agent-presets`, `modules`, `language`, `accessibility` (full table: `settingIndexBySlug` in `src/ts/router.ts`).

## Driving gotchas (learned 2026-07-20, Chat Screen Width session)

- **Fastify-theme sidebar has no "Character" text button** — the left rail lists avatar buttons directly; the old grid-walk helpers time out.
- **The settings overlay covers the sidebar.** To leave settings, click `button[aria-label="Close"]` (the ✕, top-right). Do not use a combined locator with a broad fallback + `.first()` — it clicks the wrong element silently.
- **Sliders are custom `[role="slider"]` divs**, not `<input type="range">`. Drive them by `.focus()` + `ArrowRight`/`ArrowLeft` (one step per press); read state from `aria-valuenow` / `aria-valuetext`.
- **Settings writes need the active-writer lease.** Each new browser session registers itself as active writer (`risu-writer-session`); a bare `curl PATCH /api/v1/commands/settings/<group>` afterwards gets `active_writer_stale`. To change a persisted setting during verification, do it through a browser session (and restore the original value the same way before finishing).
- After UI-visible source edits, a fresh `page.goto` picks up Vite HMR-served code — but *boot-time* state (hydration, migrations) only re-runs on a fresh page load, so always re-navigate rather than reuse a stale page when testing boot behavior.
