# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-23

Status: in-progress (11 slices landed as of 2026-05-23). `variables.ts`,
`staticSections.ts`, `plainSections.ts`, `history.ts` (deterministic
walk + per-message scripts + sendName wrapper + `<Thoughts>` extraction
— see 7-5b notes for the remaining skip list), and `scripts.ts`
(regex chain + five `@@`-action prefixes + `ableFlag` `<order, actions>`
DSL + `cbs` / `no_end_nl` actions + outScript prep + SPA-parity flag
defaults — see 7-6c notes for the remaining skip list) are real. The
remaining assembly modules under `server/fastify/src/prompt/`
(`assemble`, `lorebook`, `templates`, `tokens`, `triggers`) are still
throwing stubs. See [Remaining roadmap](#remaining-roadmap) below for
the tiered slice plan. [`HANDOVER.md`](../../../HANDOVER.md) is the
working entry point for picking up Phase 7.

## Goal

Move Stage 2 (prompt assembly, lorebook activation, persona /
description / author note injection, tokenizer-driven budget
pruning) behind a single Fastify route. The browser stops walking
the preset template; it sends intent and gets back the assembled
OpenAI-shaped payload (or a streamed completion that uses it).

## Preconditions

- Phase 2 closed (server holds presets, lorebooks, personas,
  characters).
- Phase 6 closed (server can dispatch the assembled payload).

## Scope

### Routes

- `POST /api/v1/generate/chat` - high-level intent endpoint.
  Inputs:

  ```jsonc
  {
    "chatId": "...",
    "characterId": "...",
    "presetId": "...",         // optional; defaults to active
    "loadoutId": "...",        // optional
    "mode": "send" | "continue" | "preview" | "preview_prompt"
            | "regenerate",
    "regenerateMessageId": "...",  // when mode === "regenerate"
    "userMessage": "...",          // when mode === "send"
    "resetMessages": true,         // when starting a fresh chat
    "expectedRevision": 1234,
    "inlayAssets": [...],          // browser-uploaded blobs
    "clientCapabilities": {
      "sseEvents": ["stage", "prompt", "info", "token",
                    "message_patch", "side_effect",
                    "warning", "error", "done"]
    }
  }
  ```

  Output: SSE stream with the event types listed above.

- `POST /api/v1/generate/preview-prompt` - shorthand for the
  `preview_prompt` mode. Returns the assembled `messages[]`
  without dispatching to a provider. Useful for DevTools.

### Assembly modules

Under `server/fastify/src/prompt/`:

- `assemble.ts` - walks the preset's `promptTemplate`. Substitutes
  `{{user}}`, `{{char}}`, persona, description, author note,
  example messages, scenario, jailbreak.
- `lorebook.ts` - constant + keyword + recursion. Budget-aware.
  Returns activation metadata (which entries fired, why) for
  `prompt` SSE events.
- `history.ts` - chat history shaping (role mapping, multimodal
  fold-in, ChatML-style assembly).
- `templates.ts` - prompt template cards (chat ranges, cache
  markers, systemized chat, position slots).
- `tokens.ts` - budget pruning. Reuses or ports the existing
  tokenizer dispatcher when the 7-8 token slice lands.
- `variables.ts` - `risuChatParser` port for variable expansion,
  `#when`, conditional cards.
- `triggers.ts` - hooks `editInput` / `editRequest` into the
  server-side trigger/script processor port that lands in this
  phase.

### SSE events

The `chat` route streams:

- `stage` - `{ stage: "validate" | "prompt" | "provider" | "done",
status: "start" | "end" }`.
- `prompt` - the assembled `messages[]`, prompt info, lorebook
  activation report.
- `info` - telemetry (timings, token counts).
- `token` - raw provider tokens (non-authoritative; for UX).
- `message_patch` - the authoritative chat row changes.
- `side_effect` - `{ kind: "tts" | "image" | "inlay_screen" |
"hypav3_progress" | "stable_diff", ... }`.
- `warning` - non-fatal issues.
- `error` - terminal error; includes restoration patches.
- `done` - canonical final message + generation info.

### Browser changes

The browser-side prompt extraction modules from Phase 5 shrink to
thin adapters in server-backed mode. The coordinator posts to
`/api/v1/generate/chat` and iterates the stream. The bridge owns:

- UI lease, abort forwarding.
- Inlay asset collection (still browser-only).
- Side-effect dispatch (TTS playback, image preview).
- Local restoration on `error` / abort.

## Boundaries

- **Do not redesign the preset format.** Server reads what the
  browser already writes. Schema migration is out of scope.
- **Do not move memory yet.** This route reads Hypa V3 summaries
  through whatever adapter exists (browser or server) and ships
  them; Phase 8 wires the server-side adapter.
- **Do not implement plugin code execution.** Plugins that expose
  custom prompt items return their text via the existing browser
  bridge for now. Server-side plugin execution is out of the
  migration scope.
- **Do not change the SSE event shape across phases.** Once Phase
  7 ships an event, Phase 9 must not rename it.

## Exit criteria

- The Phase 4 / 5 fixture set runs against the server route and
  produces identical observable output (with the upstream provider
  faked at the server boundary).
- `pnpm api:test` includes prompt snapshot tests: given a canned
  database + preset + chat state, `assembled === expected`.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Landed slices

| Slice | Commit     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`: locked the 9-event SSE taxonomy in `server/fastify/src/prompt/sseEvents.ts`, stubbed the seven assembly modules under `server/fastify/src/prompt/`, wired auth + validation + a validate→error→done stream that returns `phase-7 prompt assembly not yet implemented`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7-2a  | `9eed5093` | Introduced two DI seams: `src/ts/parser/chatVarBackend.ts` for `getChatVar`/`setChatVar`/`getGlobalChatVar`, and `getCurrentTriggerId` on `CBSRegisterArg`. Removed the direct `CurrentTriggerIdStore` import from `cbs.ts`. The browser bridges via `chatVar.svelte`'s module init.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free `src/ts/parser/risuChatParser.ts` + `risuChatParserHelpers.ts`. `parser.svelte.ts` re-exports. `parserStateBackend.ts` carries the `DBState.db` / `selectedCharID` fallback through DI. The 65-test parser oracle stays green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7-2c  | `7ed156e6` | Server adapter: `promptScope.ts` (single-user module-level scope), `cbsAdapter.ts` (24-field `CBSRegisterArg`), `promptVariablesBoot.ts` (one-time wiring), real `expandVariables` returning `{text, dirty}`. 17-test smoke suite asserts the canonical parser runs server-side against a request-scoped `Database` snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7-3   | `d0a2a7f3` | Static prompt sections: `staticSections.ts` ports `buildDescription`, `buildAuthorNote`, `buildPersona`, `buildCotInstruction` from `src/ts/process/promptAssembly/`. All four normalize to `OpenAIChat[]` (Option B). Deferred: `buildInlayViewInstruction` (image-gen), `additionalInformations` (Phase 8 memory). 15-test suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7-4   | `051a5dcd` | Plain prompt sections: `plainSections.ts` ports `buildPlainPromptSections`. Returns `{main, jailbreak, globalNote}`. Honors `{{original}}` substitution, `jailbreakToggle` gating, `additionalPrompt` gated by `promptPreprocess`, and `@@@?(user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | assistant | system)\n` role splitting. 12-test suite. |
| 7-5a  | `c44e53fc` | Minimal history walk: `history.ts` ports the deterministic part of `buildHistoryWindow` + `exampleMessage`. Returns `{ messages: OpenAIChat[] }` (sync). Covers examples block, `[Start a new chat]` marker gating, first message selection (`firstMessage` vs `alternateGreetings[fmIndex]`), `makeMs` filter (`disabled`/`allBefore`), and per-message role mapping. Defers scripts, `sendName`, `<Thoughts>`, multimodal, `{{asset_prompt::}}`, start trigger, tokenizer accumulation, and depthPrompts to 7-5b/c/d/e. 16-test suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7-6a  | `9a60380d` | Minimal regex script processor: `scripts.ts` exposes a sync `processScript(ctx, char, data, mode, cbsConditions?)`. Walks `db.presetRegex ?? []` then `char.customscript ?? []`, runs entries where `script.type === mode` as a plain `RegExp.replace`, then expands CBS in the result via `expandVariables`. Sanitizes flags to `[dgimsuvy]` (dedupe + default `'u'`), skips empty `in`, and swallows per-script errors so one bad regex does not kill the chain. Defers `@@emo`/`@@move_top`/`@@move_bottom`/`@@inject`/`@@repeat_back` action prefixes, the `ableFlag` `<order, actions>` DSL, script-cache, `runLuaEditTrigger`, `runTrigger('display', …)`, `pluginV2` hooks, and module regex scripts to 7-6b/c/d/e. 14-test suite (api:test 502 → 516). Unblocks 7-5b.                                                                                                                                                                                                                                                                        |
| 7-5b  | `7ad226b9` | Per-message scripts + sendName + `<Thoughts>`: each history message body now flows through `expandVariables` (chara + role) then `processScript('editprocess', {chatRole})`; first message body also runs through `processScript`. Optional `usingPromptTemplate` arg (defaults `false`) gates the sendName wrappers — first message gets `${currentChar.name}: ` + `attr: ['nameAdded']`, per-message gets `<{{char}}'s Message>\n{slot}\n</{{char}}'s Message>` resolved against the active currentChar (the SPA's `chara: msg.saying` override at `formatHistoryMessage.ts:140` is shadowed by `cbs.ts:184`; documented inline). `<Thoughts>` always stripped from content, captured to `chat.thoughts` when `maxThoughtTagDepth === -1 \|\| maxThoughtTagDepth - totalCount <= index`. `memo` defaults to `msg.chatId`; missing chatIds get backfilled with `randomUUID()`. 13 new tests (api:test 516 → 529). Defers multimodal inlays + `{{asset_prompt::}}` (7-5c), start trigger (7-5d), tokenizer accumulation + depth prompts (7-5e).      |
| 7-6b  | `8414d5c7` | Scripts `@@`-action prefixes: `processScript` now branches on `outScript.startsWith('@@')`. Five action paths: `@@emo` no-op (documented server skip), `@@inject` (mutates `currentChat.message[chatID].data` to current pre-strip data and strips the match), `@@move_top`/`@@move_bottom` (matchAll-aware extraction with `$1` / `$&` / `$<…>` substitution, then prepend/append with `\n`), `@@repeat_back` (no-match branch only, walks previous same-role message with firstMessage fallback, four positional modifiers). Public signature grew `chatID = -1` and `currentChat?: Chat` positional args; `history.ts` threads `index` + `currentChat` per-message. Two documented SPA divergences: resets `reg.lastIndex = 0` after the dispatching `reg.test()` so `@@move_top g` finds all matches (SPA loses the first one); adds an r-null guard in `@@repeat_back` (SPA accesses `r[0]` without one). 16 new tests (api:test 529 → 545). Defers `ableFlag` `<order, actions>` DSL (7-6c), script-cache (7-6d), module regex scripts (7-6e). |
| 7-6c  | `5aae492b` | `ableFlag` `<order, actions>` DSL + outScript prep + flag-default fixes: added `parseScripts()` for the `<order N, action…>` meta DSL with stable-sort by `order desc`; plumbed `actions[]` into the dispatcher so `<inject>`/`<move_top>`/`<move_bottom>`/`<repeat_back>` match the `@@`-prefix paths; added `cbs` (pre-expand `script.in`) and `no_end_nl` (suppress trailing-`>` newline) actions; ported the full outScript prep pipeline (`{{data}}` self-substitute no-op + `>`-ending auto-newline gated by `no_end_nl`); corrected two SPA-parity bugs (default flag `'g'` not `'u'`; `script.flag` honored only when `ableFlag === true`; `@@move_top` / `@@move_bottom` strip `g`). 4 existing 7-6a/b assertions updated to SPA-mirror behavior; 12 new 7-6c tests. api:test 545 → 557. Defers script-cache (7-6d), module regex scripts (7-6e).                                                                                                                                                                                           |

## Remaining roadmap

The work splits into five tiers. Slices inside a tier can run in
parallel by different agents; the inter-tier dependencies in the
"Depends on" annotations are real and must hold. **Decide concrete
LOC + test scope at the start of each slice** — the breakdown below
is the planning resolution, not a contract.

### Tier 1 — Fill in the assembly module stubs

Order chosen to minimize cross-stub coupling.

**7-5a … 7-5e — History shaping.** Port `buildHistoryWindow` +
`formatHistoryMessage` from `src/ts/process/promptAssembly/`. The
SPA modules are tightly coupled to Tier 2 infrastructure; split
along the dependency seams:

- **7-5a** — Minimal walk. Examples + `[Start a new chat]` marker
  - first message + `makeMs` filter (`disabled`/`allBefore`) +
    role mapping. ~150 LOC, ~12 tests. Independently shippable.
    **Landed `c44e53fc`** (16 tests, api:test 486 → 502).
- **7-5b** — Per-message script processing + `sendName` wrapper +
  `<Thoughts>` extraction. Depends on Scripts (7-6).
  **Landed `7ad226b9`** (13 tests, api:test 516 → 529).
- **7-5c** — Multimodal inlays + `{{asset_prompt::}}` replacement.
  Depends on the Phase 2 assets API.
- **7-5d** — Start trigger integration. Depends on Triggers (7-9c).
- **7-5e** — Tokenizer accumulation + depthPrompts wiring. Depends
  on Tokens (7-8) and Lorebook (7-7e).

**7-6 — Scripts port.** Port `processScript` + `processScriptFull`
from `src/ts/process/scripts.ts` (431 LOC in the SPA). Now in
progress as sub-slices.

- **7-6a** — Minimal regex chain (preset + character, mode filter,
  flag sanitization, CBS in replacement). **Landed `9a60380d`**
  (14 tests, api:test 502 → 516). Unblocks 7-5b.
- **7-6b** — Special action prefixes: `@@move_top`,
  `@@move_bottom`, `@@inject`, `@@repeat_back` (server-implementable
  deterministic text ops, and a documented `@@emo` no-op since the
  emotion-image side effect is browser-only). **Landed `8414d5c7`**
  (16 tests, api:test 529 → 545). Per-message history walk now
  threads `index` + `currentChat` so these actions fire correctly.
- **7-6c** — `ableFlag` `<order N, actions…>` flag-meta DSL: parse
  `<…>` segments out of `script.flag` into `{order, actions[]}`,
  stable-sort by `order desc`, route `actions.includes('inject' |
'move_top' | 'move_bottom' | 'repeat_back')` to the existing 7-6b
  paths, implement the `'cbs'` action (pre-expand `script.in`) and
  `'no_end_nl'` action (suppress the trailing-`>` newline).
  **Landed `5aae492b`** (12 new + 4 updated tests, api:test 545 →
  557). Also corrected the default-flag-is-`'g'` and
  `ableFlag`-gated-`script.flag` SPA-parity bugs the 7-6a tests
  had silently asserted wrong.
- **7-6d** — Module regex scripts: port `getModules()` +
  `getModuleRegexScripts()` from `src/ts/process/modules.ts`
  (resolve active module ids from `db.enabledModules`,
  `currentChat.modules`, `currentChar.modules`, and
  `db.moduleIntergration`; filter `db.modules` by id/namespace;
  dedupe; concat each module's `regex[]` into the script chain).
  Module triggers, lorebooks, assets, and cjs stay browser-side
  (their consumers ship in 7-5c, 7-7, 7-9). Next pickup.
- **7-6e** — Script-cache (`generateScriptCacheKey` +
  `getScriptCache` + `cacheScript`) and `runTrigger('display', …)`
  for `editdisplay` mode. Both are optional polish: the cache is
  a pure optimization (the server runs each chain fresh per
  assembly), and `editdisplay` is blocked on Triggers (7-9).

Browser-only paths (`runLuaEditTrigger`, `pluginV2[mode]`) are
out-of-scope for the server port; the SPA continues to use them
client-side.

**7-7a … 7-7e — Lorebook activation.** Port
`src/ts/process/lorebook.svelte.ts` + `buildLorebookContext.ts`.
Tentative breakdown:

- **7-7a** — Constant entries (always-on).
- **7-7b** — Keyword matching activation.
- **7-7c** — Recursive activation within depth limit.
- **7-7d** — Budget-aware truncation.
- **7-7e** — Depth-prompt emission for history (consumed by 7-5e).

### Tier 2 — Supporting infrastructure

**7-8a … 7-8c — Tokens / budget.** Port
`src/ts/process/promptBudget/{preflightTemplateTokens,
finalizeRequestBudget}.ts`.

- **7-8a** — Tokenizer integration on the server. The SPA's
  `src/ts/tokenizer.ts` dispatcher is partly environment-agnostic;
  decide reuse vs port at slice start.
- **7-8b** — Token preflight accounting.
- **7-8c** — Budget finalization (pruning order, fallback chains).

**7-9a … 7-9c — Triggers.** Port `src/ts/process/triggers.ts`.

- **7-9a** — Trigger sandbox infrastructure (the
  `processScriptFull` layer for trigger bodies; may reuse 7-6's
  port).
- **7-9b** — `editInput` / `editRequest` hooks.
- **7-9c** — `start` trigger (consumed by 7-5d).

**7-10a … 7-10e — Preset templates.** Port the template-card
logic from `src/ts/process/promptAssembly/{normalizeTemplate,
buildStaticPromptSections, buildPlainPromptSections,
systemizeChat}.ts` (the static sections themselves already
landed in 7-3 / 7-4; this tier is about the card-walking +
preset-structure parser).

- **7-10a** — Card parsing + normalization.
- **7-10b** — Chat range cards.
- **7-10c** — Cache markers.
- **7-10d** — Position slots.
- **7-10e** — Systemized chat hoisting.

### Tier 3 — Root + route wiring

**7-11a … 7-11d — `assemble.ts` + route.** All Tier 1 + 2 modules
must be real before these land.

- **7-11a** — `assemble.ts` root entry stitching static + plain +
  lorebook + history + tokens through templates.
- **7-11b** — Wire `POST /api/v1/generate/chat` (currently emits
  "not yet implemented") to call `assemble.ts` and emit `prompt`
  - `done` SSE events.
- **7-11c** — Add `POST /api/v1/generate/preview-prompt` shortcut.
- **7-11d** — SSE telemetry: `info` event (timings, token counts),
  `message_patch` for chat-row deltas.

### Tier 4 — Browser adapter

After Tier 3 is real. The browser-side prompt extraction modules
from Phase 5 shrink to thin SSE iterators.

- **7-12a** — Client adapter for `/api/v1/generate/chat`.
- **7-12b** — Dual-mode fixture sweep: re-run the 12 server-backed
  sendChat fixtures through the new `/chat` route.
- **7-12c** — Side-effect dispatch (TTS playback, image preview,
  `hypav3_progress` UX) via the SSE `side_effect` event.
- **7-12d** — Restoration on error / abort from the SSE `error`
  event's restoration payload.

### Tier 5 — Closeout

**7-13 — Phase 7 closeout.** Refresh
`phase-7-prompt-assembly.md` with the Closeout section. Flip
[`HANDOVER.md`](../../../HANDOVER.md) and `next-steps.md` to
Phase 8 (memory) as the next phase. The three providers
deferred for server-owned flattening (Ooba OAI-compat, NovelAI
text, NovelList) can now route through `assemble.ts`; that work
may land as a polish slice before closeout or as the first
post-closeout follow-up.

## Reference

- `move-to-fastify` lands a Phase-7 ancestor as
  `/api/v1/generate/completion-with-assembly`. We are skipping
  that indirection; `chat` is the assembled endpoint.
- `risuai-metatron`'s `chat_generation/prompt_builder.py`,
  `prompt_sections.py`, `prompt_history.py`, `prompt_templates.py`,
  `prompt_budget.py`, `context.py`, `lorebook.py` are the closest
  template at full scale. Plan on the assembly modules being
  smaller than that (the Python port absorbed years of drift).
