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

The plan is closed. Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5,
Phase 6, and Phase 7 are complete.

Durable model profile records now live in `Database.modelProfiles`, and durable
role bindings live in `Database.modelRoleProfiles`. Client and server defaults
normalize those fields, settings commands validate them, provider secret masking
handles profile-local `apiKey` values by stable profile id, preset/split-preset
and loadout paths preserve them, and `src/ts/model/modelProfileResolver.ts`
prefers durable profiles before falling back to legacy flat fields.

Phase 6 landed in these committed slices:

- `fea509ef6` `feat: scaffold durable model profiles`
- `b7e21fdac` `feat: resolve durable model profile bindings`
- `a16e5b9f4` `feat: preserve model profiles in presets`
- `559553b21` `feat: support profile request models`
- `b42a3cb14` `feat: support profile provider options`
- `534b1918f` `feat: support profile api keys`
- `9235e5850` `feat: support profile runtime options`
- `a7cee559f` `feat: support profile fallback refs`
- `64acf9ab2` `feat: support inherited model profile roles`

Phase 4 adapted the settings-facing layer while preserving flat writes:

- `ModelRoleList.svelte` shows resolved profile summaries from flat drafts plus
  `DBState`. After Phase 6, it can also show durable profile role summaries and
  inherited role state.
- `BotSettings.svelte` provider visibility consumes `modelProfileUiState`
  resolved profiles instead of only asking whether any effective role model uses
  a provider.
- Split-preset command create/patch/apply paths normalize `modelRoles`,
  `seperateModels`, `fallbackModels`, and `seperateParameters`.
- The model role editor drawer is extracted to `ModelRoleEditor`.

Provider option panels intentionally remain global/flat for compatibility.
Moving or mirroring those panels further is deferred to a future visible profile
authoring UI.

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

Durable profile authoring UI is not implemented. Current role settings UI shows
resolved profile summaries and edits legacy flat compatibility fields. Durable
profile records can be created or updated through settings commands, import,
preset, and loadout paths, but not through a full visible profile editor yet.

Flat compatibility fields remain active fallbacks for legacy imports, copied
data, static model bypasses, legacy fallback model ids, and settings surfaces
that have not moved to profile authoring. Memory summaries use profile
resolution; memory embeddings remain separate on Hypa/Voyage/custom embedding
fields.

## Closeout Loop

1. Treat the model-config-profiles workstream as closed after Phase 7 proof.
2. Start a new plan for visible durable profile authoring UI if that work
   resumes.
3. Preserve flat compatibility fields until a future plan retires each field
   deliberately.

## Known Corrections

- Paths in older notes that mention `server/fastify/src/generation/chatDispatch.ts`
  should be read as `server/fastify/src/prompt/chatDispatch.ts` in this repo.
- The live Fastify path is server-side prompt assembly; browser provider
  dispatch remains relevant for retained completion and auxiliary request
  helpers but should not become the source of truth for server routing.

## Completed Proof

Latest proof is recorded in [`latest-verification.md`](latest-verification.md).
It covers Phase 6 committed slices, Phase 7 docs closeout, final grouped Vitest
validation, Fastify browser smoke, and TypeScript proof. Browser smoke validates
Fastify browser boot and basic settings/projection flows; it does not prove
durable profile creation/editing through a visible profile authoring UI. The
repo-wide `pnpm check` caveat remains: do not record it as passing unless it is
rerun and verified separately.
