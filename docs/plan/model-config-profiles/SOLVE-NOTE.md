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

The plan is open. Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 are complete.
Existing flat database fields remain the compatibility source of truth.
`src/ts/model/modelProfileResolver.ts` derives read-only profiles from the flat
settings shape, `src/ts/presetSplit.ts` centralizes effective model/prompt
preset composition, and Phase 3 dispatch paths consume resolved profiles across
Fastify and retained browser-local provider helpers.

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
Moving or mirroring those panels further is deferred until safer Phase 5/6
boundaries. No durable `modelProfiles` or `profileBindings` storage exists, and
none should be added before Phase 6.

The next implementation phase is Phase 5:
[`phases/phase-5-custom-secrets-and-auxiliary.md`](phases/phase-5-custom-secrets-and-auxiliary.md).
Phase 5 should harden auxiliary/custom/secrets surfaces against the derived
profile contract while preserving flat compatibility fields.

The main coupled surfaces for Phase 5 are:

- `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte` and related
  custom-model catalog flows.
- `server/fastify/src/providerSecrets.ts` and masking/secret projection paths.
- Memory summary and embedding model helpers, including
  `server/fastify/src/memorySummaryModel.ts` and
  `server/fastify/src/memoryEmbeddingModel.ts`.
- Translation, scripts, MCP, playground, fallback, and tool request helpers
  that still read flat provider/model fields directly.
- `src/ts/presetSplit.ts`, `server/fastify/src/commands/splitPresets.ts`, and
  `server/fastify/src/routes/commands.ts` for command compatibility checks.

## Next Manager Loop

1. Start with Phase 5 auxiliary/custom/secrets surface exploration. Verify
   which surfaces still bypass derived profiles or secret-masking compatibility.
2. Keep all writes on existing flat fields unless a Phase 5 slice explicitly
   adds an adapter around them. Do not add persisted profile records, profile
   bindings, database schema, migrations, or durable storage before Phase 6.
3. Keep provider panels global/flat until a targeted Phase 5/6 slice proves a
   safe move or mirror path.
4. Use focused tests for each hardened surface, then update
   `latest-verification.md`, `status.md`, and this note with exact proof.

## Known Corrections

- Paths in older notes that mention `server/fastify/src/generation/chatDispatch.ts`
  should be read as `server/fastify/src/prompt/chatDispatch.ts` in this repo.
- The live Fastify path is server-side prompt assembly; browser provider
  dispatch remains relevant for retained completion and auxiliary request
  helpers but should not become the source of truth for server routing.

## Completed Proof

Latest proof is recorded in [`latest-verification.md`](latest-verification.md).
It covers Phase 4 UI/command adapter slices, browser OpenRouter smoke, the
known repo-wide `pnpm check` caveat, docs Prettier, and `git diff --check`.
