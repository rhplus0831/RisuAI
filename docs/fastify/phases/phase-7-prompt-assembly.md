# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-21

Status: in-progress (1 slice landed as of 2026-05-22). The scaffold for
`POST /api/v1/generate/chat` is in place; the assembly modules under
`server/fastify/src/prompt/` are still stubs that throw
`phase-7 ... not yet implemented`. Slice 7-2 (`variables.ts` /
`risuChatParser` port) is the next planned slice.

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
- `tokens.ts` - budget pruning. Reuses the tokenizer from Phase 6.
- `variables.ts` - `risuChatParser` port for variable expansion,
  `#when`, conditional cards.
- `triggers.ts` - hooks `editInput` / `editRequest` into the
  trigger sandbox from Phase 6.

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

| Slice | Commit       | Summary                                                                                                                                                                                                                            |
| ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4`   | Scaffolded `POST /api/v1/generate/chat`: locked the 9-event SSE taxonomy in `server/fastify/src/prompt/sseEvents.ts`, stubbed the seven assembly modules under `server/fastify/src/prompt/`, wired auth + validation + a validate→error→done stream that returns `phase-7 prompt assembly not yet implemented`. |
| 7-2a  | `9eed5093`   | Introduced two DI seams: `src/ts/parser/chatVarBackend.ts` for `getChatVar`/`setChatVar`/`getGlobalChatVar`, and `getCurrentTriggerId` on `CBSRegisterArg`. Removed the direct `CurrentTriggerIdStore` import from `cbs.ts`. The browser bridges via `chatVar.svelte`'s module init. |
| 7-2b  | `bb2c78b5`   | Lifted `risuChatParser` + helpers into Svelte-free `src/ts/parser/risuChatParser.ts` + `risuChatParserHelpers.ts`. `parser.svelte.ts` re-exports. `parserStateBackend.ts` carries the `DBState.db` / `selectedCharID` fallback through DI. The 65-test parser oracle stays green. |
| 7-2c  | `7ed156e6`   | Server adapter: `promptScope.ts` (single-user module-level scope), `cbsAdapter.ts` (24-field `CBSRegisterArg`), `promptVariablesBoot.ts` (one-time wiring), real `expandVariables` returning `{text, dirty}`. 17-test smoke suite asserts the canonical parser runs server-side against a request-scoped `Database` snapshot. |
| 7-3   | `d0a2a7f3`   | Static prompt sections: `staticSections.ts` ports `buildDescription`, `buildAuthorNote`, `buildPersona`, `buildCotInstruction` from `src/ts/process/promptAssembly/`. All four normalize to `OpenAIChat[]` (Option B). Deferred: `buildInlayViewInstruction` (image-gen), `additionalInformations` (Phase 8 memory). 15-test suite. |
| 7-4   | `051a5dcd`   | Plain prompt sections: `plainSections.ts` ports `buildPlainPromptSections`. Returns `{main, jailbreak, globalNote}`. Honors `{{original}}` substitution, `jailbreakToggle` gating, `additionalPrompt` gated by `promptPreprocess`, and `@@@?(user|assistant|system)\n` role splitting. 12-test suite. |

## Reference

- `move-to-fastify` lands a Phase-7 ancestor as
  `/api/v1/generate/completion-with-assembly`. We are skipping
  that indirection; `chat` is the assembled endpoint.
- `risuai-metatron`'s `chat_generation/prompt_builder.py`,
  `prompt_sections.py`, `prompt_history.py`, `prompt_templates.py`,
  `prompt_budget.py`, `context.py`, `lorebook.py` are the closest
  template at full scale. Plan on the assembly modules being
  smaller than that (the Python port absorbed years of drift).
