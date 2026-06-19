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
6. Close every sub-agent after its work is complete.

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

The plan is open and implementation has not started. The current codebase still
uses flat database fields for model role selection, provider credentials,
request models, and runtime options. The initial planning pass identified the
main coupled surfaces:

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

1. Start Phase 0 by adding parity fixtures for the current role, provider,
   `staticModel`, fallback, preset, masking, and memory behavior.
2. Use an explorer to validate fallback and preset semantics before expanding
   the resolver contract.
3. Do not begin Phase 3 dispatch work until Phase 1 resolver tests prove the
   compatibility adapter can reproduce current behavior for `aiModel`,
   `subModel`, optional roles, `reverse_proxy`, `xcustom:::`, OpenRouter,
   NanoGPT, Ollama, and provider key identifiers.
4. Keep Phase 2 preset composition ahead of dispatch so the resolver receives
   the same effective settings on client and server paths.
5. Do not add durable profile storage until Phase 6. Earlier phases should use
   a derived profile object built from the existing settings shape.

## Known Corrections

- Paths in older notes that mention `server/fastify/src/generation/chatDispatch.ts`
  should be read as `server/fastify/src/prompt/chatDispatch.ts` in this repo.
- The live Fastify path is server-side prompt assembly; browser provider
  dispatch remains relevant for retained completion and auxiliary request
  helpers but should not become the source of truth for server routing.

## Completed Proof

No implementation proof exists yet. Documentation formatting proof should be
recorded in `latest-verification.md` after this folder is created.
