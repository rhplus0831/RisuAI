# Phase 2: Effective Generation Config

Status: complete.

Phase 2 landed server-side incomplete-chat gating for prompt assembly, prompt
preview, continue/regenerate, and live send job creation. Configured chats now
assemble through a non-persisted effective database overlay that applies the
chat-owned preset, persona, jailbreak toggle, and sidebar toggle values, and
provider dispatch reads scoped preset fields from that overlay.

Validation covered the focused server/client prompt and dispatch tests plus the
client-lib and strict Fastify TypeScript checks listed below.

Goal: make server prompt assembly and provider dispatch consume only the active
chat's configured generation settings.

## Scope

- Resolve the active chat's generation settings immediately after
  character/chat scope resolution.
- Block send, continue, regenerate, prompt preview, and any other assembly path
  when the chat is incomplete.
- Build an assembly-only effective database snapshot:
  - apply the selected preset referenced by `chat.generationSettings.presetId`;
  - mirror the selected persona into the fields legacy prompt helpers read;
  - overlay `globalChatVariables` with chat sidebar toggle values;
  - overlay `jailbreakToggle` from the chat.
- Ensure CBS, Lua, templates, jailbreak cards, parser conditionals, and
  prompt-info output observe the scoped overlay.
- Stop live send callers from using request-body `presetId` as an override.
  Either remove it from live sends or reject mismatches with the chat config.

## Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/variables.ts`
- `server/fastify/src/prompt/promptScope.ts`
- `server/fastify/src/prompt/luaRuntime.ts`
- `server/fastify/src/prompt/staticSections.ts`
- `server/fastify/src/prompt/plainSections.ts`
- `server/fastify/src/prompt/templates.ts`
- `server/fastify/src/prompt/chatDispatch.ts`
- `server/fastify/src/commands/presets.ts`
- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/process/request/serverChat.ts`

## Target Shape

- Incomplete chats return a structured failure such as
  `409 chat_generation_settings_incomplete`.
- Configured chats produce prompt bytes matching the old global behavior when
  the chat settings match the old global fields.
- Provider dispatch reads effective preset fields from the scoped overlay
  without persisting the overlay.
- `promptInfoInsideChat` records the chat-local persona, preset, and toggle
  values used for that generation.

## Invariants

- Incomplete chats produce no user message, generation row, provider call, or
  finalization side effect.
- `applyPreset` or equivalent preset overlay must run against a clone, not the
  persisted settings object.
- No prompt assembly helper may fall back to global persona, preset, or toggle
  fields when chat settings are incomplete.
- Adding a new displayed toggle makes previously configured chats incomplete
  until that toggle is explicitly confirmed.

## Exit Criteria

- Assembly tests cover configured, incomplete, deleted preset, deleted persona,
  missing toggle, explicit off toggle, and imported incomplete chat cases.
- Dispatch tests prove preset-specific provider settings come from the active
  chat's `presetId`.
- Prompt-scope tests prove two chats can produce different persona/preset/toggle
  prompt output without changing globals.
- Client request tests handle the new structured incomplete-chat error.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/plainSections.test.ts \
  server/fastify/__tests__/staticSections.test.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/promptVariables.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverPromptAssembly.test.ts \
  src/ts/process/request/tests/serverChat.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- `applyPreset` is mutation-oriented today. The overlay must not rewrite global
  settings, prompt-template tables, selected globals, or preset snapshots.
- Durable reattach should not be blocked for an already-running job, but new
  job creation must be gated.
