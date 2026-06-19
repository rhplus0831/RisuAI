# Model Config Profiles Solve Note

Date: 2026-06-20

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

The plan is open. Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5 are
complete. Phase 6 persisted profiles is next and is not started.

Existing flat database fields remain the compatibility source of truth.
`src/ts/model/modelProfileResolver.ts` derives read-only profiles from the flat
settings shape, `src/ts/presetSplit.ts` centralizes effective model/prompt
preset composition, and dispatch paths consume resolved profiles across Fastify
and retained browser-local provider helpers.

Phase 4 adapted the settings-facing layer while preserving flat writes:

- `ModelRoleList.svelte` shows resolved profile summaries from flat drafts plus
  `DBState`.
- `BotSettings.svelte` provider visibility consumes `modelProfileUiState`
  resolved profiles instead of only asking whether any effective role model uses
  a provider.
- Split-preset command create/patch/apply paths normalize `modelRoles`,
  `seperateModels`, `fallbackModels`, and `seperateParameters`.
- The model role editor drawer is extracted to `ModelRoleEditor`.

Provider option panels intentionally remain global/flat for compatibility.
Moving or mirroring those panels further is a Phase 6 compatibility decision.

Phase 5 closed the known auxiliary/custom gaps while preserving flat writes:

- Memory summaries now resolve through the derived `memory` profile.
- Memory embeddings remain separate on the Hypa/Voyage/custom embedding
  contract, with regression proof.
- Dynamic OpenRouter and NanoGPT catalog fetches receive explicit keys.
- Fastify and browser OpenAI-family dispatch variants use profile-owned options.
- Suggestions and image prompts route through the auxiliary role; subtitles
  route through the translate role.
- Translation cache entries are scoped to resolved profile identity.
- `xcustom:::` static fallback options, MCP AI access role routing, and
  auxiliary separate-parameter fallback ownership are pinned by tests.

No durable `modelProfiles`, `profileBindings`, database schema changes, or
migrations exist yet. Flat compatibility fields remain the source of truth until
Phase 6. Profile-local secret masking is deferred to Phase 6; current stable-row,
custom-model, and provider masking remains flat and covered by existing tests.

## Next Manager Loop

1. Start Phase 6 persisted profiles from
   [`phases/phase-6-persisted-profiles.md`](phases/phase-6-persisted-profiles.md).
2. Add durable profile records, role bindings, schema, migrations, and
   profile-local secret masking only inside Phase 6.
3. Preserve flat compatibility fields during the Phase 6 rollout until the plan
   explicitly retires or migrates each field.

## Known Corrections

- Paths in older notes that mention `server/fastify/src/generation/chatDispatch.ts`
  should be read as `server/fastify/src/prompt/chatDispatch.ts` in this repo.
- The live Fastify path is server-side prompt assembly; browser provider
  dispatch remains relevant for retained completion and auxiliary request
  helpers but should not become the source of truth for server routing.

## Completed Proof

Latest proof is recorded in [`latest-verification.md`](latest-verification.md).
It covers Phase 5 committed slices, docs closeout, final grouped Vitest
validation, browser smoke, and TypeScript proof. The repo-wide `pnpm check`
caveat remains: do not record it as passing unless it is rerun and verified
separately.
