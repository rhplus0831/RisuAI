# Character Create And Browser Import Audit

Date: 2026-06-16

Status: bad

## Scope

Verified user-input-driven character creation paths: scratch character create,
create-and-select, browser character-card import, and ordinary character profile
edits.

## Result

Scratch create and browser-side card import still send a non-empty
`character.chats` array to Fastify create routes. The server now rejects any
non-empty `character.chats` on create, even if the default chat has no messages.

Normal character profile edits are separately verified as working; see
`docs/normal-character-profile-edits.md`.

## Evidence

- `src/ts/characters.ts:894` builds a blank character with `chats: [{ ... }]`.
- `src/ts/characters.ts:56` and `src/ts/characters.ts:77` dispatch that object
  through create/create-and-select.
- `src/ts/characterCards.ts:496` and `src/ts/characterCards.ts:865` build
  imported browser-card characters with `chats: [{ ... }]`, then dispatch create
  at `src/ts/characterCards.ts:71` and `src/ts/characterCards.ts:941`.
- `src/ts/server/commands.ts:1842` and `src/ts/server/commands.ts:1856` send the
  create body as-is.
- `server/fastify/src/commands/characters.ts:369` rejects
  `record.chats.length > 0`.
- `server/fastify/__tests__/commands.test.ts:3692` and `:3714` assert both
  create endpoints reject embedded chats with HTTP 400.

## Verification

Verification agents confirmed the mismatch by source inspection and targeted
tests. Relevant targeted tests passed, but they do not include an end-to-end
scratch/browser-card create against the real server validator.

Commands run across main and verifier passes included:

- `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts -t "creates characters through trusted optimistic projection writes|creates and selects scratch characters" --reporter=verbose`
- `pnpm exec vitest run src/ts/server/characterBridge.svelte.test.ts -t "local profile edits dispatch|M12" --reporter=verbose`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts`

## Follow-Up

Either strip empty/default `chats` from browser create payloads and create the
default chat with chat commands, or relax the server create validator for empty
chat metadata and keep rejecting embedded transcript/Hypa data.
