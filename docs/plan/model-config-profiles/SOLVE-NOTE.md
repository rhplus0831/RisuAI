# Model Config Profiles Solve Note

Date: 2026-06-19

## Manager Instruction

The current agent is acting as manager for this workstream. Keep this role even
if context is compressed.

Required process:

1. Read `README.md`, `status.md`, and the phase router before choosing work.
2. Spawn an explorer agent to verify the next slice's source anchors and risk.
3. For implementation phases, spawn or use a worker only after the phase scope
   has a disjoint write set.
4. After implementation, spawn a verification agent to audit the changed slice.
5. Run Prettier and the relevant focused validation commands before closing a
   phase.
6. Close agents when moving to next task.

Repository reminders:

- Use `pnpm`.
- Start by reading `STRUCTURE.md` when a new agent needs repo grounding.
- Use `pnpm dev:agent` only when browser/full-stack validation is needed, and
  stop it before finishing.
- Before committing, run Prettier.
- Server type checking requires:

```bash
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Current State

The plan is open. Phase 0, Phase 1, Phase 2, and Phase 3a-3i are complete. The
current worker slice is browser request helper role/static/fallback resolver
adoption: `requestChatData()` now builds fallback attempts from
`resolveModelProfile(...).fallbacks`, `requestChatDataMain()` resolves the role
or static model once through the profile resolver, and server-intent completion
payloads remain thin.

The current codebase still uses flat database fields as the compatibility
source of truth. Durable reusable profile storage has not been introduced, and
retained browser-local provider helper branches still reconstruct many provider
credentials, URLs, request models, and additional params from flat fields. The
main coupled surfaces remain:

- `src/ts/model/modelRoles.ts` resolves roles to model ids only.
- `src/lib/Setting/Pages/Model/ModelRoleList.svelte` edits role model ids,
  fallbacks, and separate parameters.
- `src/lib/Setting/Pages/BotSettings.svelte` owns the global provider/options
  panels and derives their visibility from all effective role models.
- `src/ts/process/request/request.ts`, `server/fastify/src/routes/generation.ts`,
  and `server/fastify/src/prompt/chatDispatch.ts` reconstruct provider runtime
  configuration from flat database fields.
- `src/ts/presetSplit.ts`, `server/fastify/src/routes/commands.ts`, and
  `server/fastify/src/providerSecrets.ts` need explicit profile support before
  nested settings can be persisted safely.

## Next Manager Loop

1. Continue Phase 3 only on the remaining browser-local provider helper parity
   gaps: adopt resolver-derived provider options where equivalent without
   changing server-intent payload shape or reshaping provider secrets/storage.
2. Keep UI writes targeting existing flat fields until the Phase 4 adapter work.
3. Do not add durable profile storage until Phase 6. Earlier phases should use
   a derived profile object built from the existing settings shape.
4. Record each slice's proof in `latest-verification.md` before updating this
   note again.

## Known Corrections

- Paths in older notes that mention `server/fastify/src/generation/chatDispatch.ts`
  should be read as `server/fastify/src/prompt/chatDispatch.ts` in this repo.
- The live Fastify path is server-side prompt assembly; browser provider
  dispatch remains relevant for retained completion and auxiliary request
  helpers but should not become the source of truth for server routing.

## Completed Proof

Latest proof is recorded in [`latest-verification.md`](latest-verification.md).
It covers this browser request helper role/static/fallback resolver adoption
slice, focused browser and Fastify generation tests, Prettier, client-lib
TypeScript, strict server TypeScript, and `git diff --check`.
