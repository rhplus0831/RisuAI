# Phase 5: Verification

Status: planned.

Goal: prove the new chat-scoped behavior across server commands, prompt
assembly, frontend guards, imports, and TypeScript checks.

## Scope

- Add or update focused tests for every behavior changed by Phases 1-4.
- Refresh prompt golden fixtures only for intentional chat-scoping changes.
- Run the server TypeScript project-reference workflow from `AGENTS.md`.
- Record any residual test gaps in [`../status.md`](../status.md) before
  closing the workstream.

## Required Coverage

- Server command validation and narrow rollback for chat settings.
- Projection/hydration/reconcile includes chat settings.
- Incomplete chat blocks send, continue, regenerate, prompt preview, and any
  direct generation entry point.
- Blocked client sends do not clear the composer or append a user message.
- Two chats with different persona, preset, and toggle settings produce
  different scoped prompt output while global settings remain unchanged.
- Deleted persona or preset invalidates affected chats.
- New required displayed toggles make existing chats incomplete until confirmed.
- `.risu`, bundle, JSON/chat, character-card, and Realm imports create
  incomplete chats.
- Fork/copy preserves complete and incomplete state exactly.

## Validation Matrix

| Case | Expected |
| --- | --- |
| New configured chat | Send succeeds with chat-local persona, preset, and toggles. |
| Missing `presetId` | Send and preview are blocked. |
| Missing `personaId` | Send and preview are blocked. |
| Missing toggle confirmation | Send and preview are blocked. |
| Explicit off toggle | Chat remains complete when the key is present. |
| Global selected persona/preset changed | Configured chat output is unchanged. |
| Two chats with different toggles | Prompt sections differ only by active chat config. |
| Deleted referenced preset/persona | Affected chats become incomplete. |
| Deleted toggle key | Stale value is ignored; no fallback to global. |
| Imported chat opened | Chat is visible, send is disabled/blocked. |
| Configure imported chat then send | Send succeeds. |
| Fork complete chat | Fork is complete. |
| Fork incomplete chat | Fork remains incomplete. |
| Add new displayed sidebar toggle | Existing chats require confirmation. |

## Validation Commands

Use focused subsets while developing. Before closing the workstream, run:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/plainSections.test.ts \
  server/fastify/__tests__/staticSections.test.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/promptVariables.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts
pnpm exec vitest run src/ts/chatCommands.test.ts \
  src/ts/server/commands.test.ts \
  src/ts/process/request/tests/serverPromptAssembly.test.ts \
  src/ts/process/request/tests/serverChat.test.ts \
  src/ts/process/__tests__/sendChat.*.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

If a listed test file does not exist when implementation starts, replace it
with the nearest focused test or create the missing focused coverage.

## Exit Criteria

- All required coverage has a passing focused test or an explicit tracked gap.
- The server TypeScript workflow passes.
- `status.md` records the workstream as complete or lists remaining open
  phases with owners/next steps.

## Risks

- The server must enforce the contract even if a client test passes. Treat
  frontend-only coverage as UX proof, not correctness proof.
- Dynamic toggle definitions can make tests brittle. Prefer resolver-level
  fixtures plus one integration proof over many UI snapshots.
