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
browser request helper role/static/fallback resolver adoption slice is complete:
`requestChatData()` now builds fallback attempts from
`resolveModelProfile(...).fallbacks`, `requestChatDataMain()` resolves the role
or static model once through the profile resolver, and server-intent completion
payloads remain thin. The browser-local Gemini/Vertex provider-options slice is
also complete: `requestChatDataMain()` attaches the resolved profile to the
retained local request argument, and `requestGoogleCloudVertex()` uses
profile-owned Google AI Studio API keys, Vertex project/region/service-account
credentials, and profile request models when a resolved profile is present.
Conflicting flat Google/Vertex fields and cached flat `vertexAccessToken` no
longer override profile-backed browser-local Gemini/Vertex requests. The
browser-local OpenAI-compatible chat-completions provider-options slice is also
complete: `requestOpenAI()` now uses profile-owned request models, base URLs,
API keys, extra headers, OpenRouter route/transforms/provider filters, NanoGPT
provider/subscription options, reverse-proxy Ooba options, `xcustom:::`
additional params, key-identifier credentials/base URLs, `ollama-cloud`
OpenAI-compatible options, and runtime `genTime` when a resolved profile is
present. No-resolved-profile callers keep the legacy flat fallbacks. The
browser-local OpenAI Responses and legacy instruct provider-options slice is
also complete: `requestOpenAIResponseAPI()` now uses profile-owned request
models, base URLs or exact endpoints, API keys, extra headers, and
reverse-proxy/`xcustom:::` additional params when a resolved profile is present,
while `requestOpenAILegacyInstruct()` now exposes a preview payload and uses
profile-owned request models, base URLs or exact endpoints, API keys, extra
headers, and profile additional params for reverse-proxy/`xcustom:::` callers.
No-resolved-profile Responses and legacy instruct callers keep their legacy
flat fallbacks, including the hard-coded legacy instruct model. The
browser-local Anthropic-family provider-options slice is also complete:
`requestClaude()` now uses profile-owned request models, base URLs or exact
endpoints, API keys, extra headers, and profile additional params when a
resolved profile is present. Covered profile-backed variants include
reverse-proxy Anthropic, Bedrock Claude, and `ollama-cloud` Anthropic; callers
without a resolved profile keep their legacy URL/key/model/additional-parameter
fallbacks. The browser-local Mistral provider-options slice is also complete:
the `requestOpenAI()` Mistral branch now uses profile-owned request models,
chat-completions URL resolution, API keys, extra headers, and profile
additional params for profile-backed native, reverse-proxy, and `xcustom:::`
Mistral requests. Callers without a resolved profile keep legacy
`arg.customURL`, `arg.key ?? db.mistralKey`, body model `aiModel`, and no
additional-parameter fallback.

The current codebase still uses flat database fields as the compatibility
source of truth. Durable reusable profile storage has not been introduced, and
retained browser-local provider helper branches other than Gemini/Vertex and
OpenAI-compatible chat completions plus OpenAI Responses/legacy instruct and
Anthropic-family plus Mistral still reconstruct many provider credentials,
URLs, request models, and additional params from flat fields. The
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
   gaps after Gemini/Vertex, OpenAI-compatible chat completions, and OpenAI
   Responses/legacy instruct, Anthropic-family, and Mistral. The remaining
   named gaps are Cohere, native Ollama, Kobold, Horde, and Ooba legacy: adopt
   resolver-derived provider options where equivalent without changing
   server-intent payload shape or reshaping provider secrets/storage.
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
It covers this browser-local Mistral provider-options slice, focused browser
request/provider tests, Prettier, client-lib TypeScript, strict server
TypeScript, and `git diff --check`.
