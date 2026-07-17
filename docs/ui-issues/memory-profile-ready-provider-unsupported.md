# Memory profile is shown as Ready for a provider the server rejects

## Summary

The model-role UI uses generic generation readiness for the `memory` role. A durable Anthropic or other generally routable profile can therefore be persisted and displayed as Ready even though server-side memory summarization supports only OpenAI, OpenRouter, and NanoGPT-compatible capabilities.

## Location

- `src/ts/model/modelRoles.ts:1-10`
- `src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte:36-54,118-121,172-176,250-279,328-375`
- `src/ts/model/modelProfileUiState.ts:51-67,123-139`
- `src/ts/model/modelProfileResolver.ts:1392-1412`
- `src/ts/model/modelProfileMutations.ts:350-375,400-425`
- `src/ts/server/commands.ts:2773-2785`
- `server/fastify/src/routes/commands.ts:2176-2197`
- `server/fastify/src/commands/modelProfiles.ts:254-288`
- `server/fastify/src/memorySummaryModel.ts:16-60`
- `server/fastify/src/memorySummarizeJobHandler.ts:101-130,171-205`

## Trigger

Create a valid durable profile backed by Anthropic, bind it to the Memory role, and click Apply. Then allow Hypa V3 to enqueue a server-side summary job.

## Expected behavior

A role labeled Ready should be executable by the subsystem that owns that role. Otherwise the UI should mark the profile unsupported for Memory and prevent or clearly warn about applying it.

## Actual behavior

The role binding is accepted and persisted, and the status remains Ready. Later, each server summary job fails before provider dispatch with `summarization memory provider is not API-backed OpenAI-compatible: anthropic` (or the corresponding unsupported provider).

## Underlying cause

`resolveModelProfileUiState` copies the generic resolver status for every role. The generic resolver returns `ready` for any routable generation capability and does not apply memory-specific restrictions. UI validation checks only that a referenced profile exists. The server role-binding command likewise validates the binding target, not whether the Memory worker can execute that provider. The restriction is enforced only later by `resolveMemorySummaryModel` inside the job worker.

## Affected data flow

1. **UI:** `ModelProfileRoleList.svelte:328-375` renders the Memory binding and generic status; `:118-121` considers an existing profile valid.
2. **Client state/request:** `:250-279` calls `updateModelRoleProfilesDurably`; `modelProfileMutations.ts:350-375` stages `PUT /model-role-profiles`, sent by `server/commands.ts:2773-2785`.
3. **Server persistence:** `routes/commands.ts:2176-2197` invokes `commands/modelProfiles.ts:254-288`, which persists the binding after profile-ID validation.
4. **Job logic:** `memorySummarizeJobHandler.ts:171-205` later resolves the memory model. `memorySummaryModel.ts:42-60` accepts only `openai`, `openrouter`, or `nanogpt` capabilities.
5. **Acknowledgement/display:** the binding command succeeds, so the role table continues to display the generic Ready status even though the later summary job is retried and eventually failed (`memorySummarizeJobHandler.ts:101-130`).

## Severity and user impact

**High.** A configuration explicitly presented as valid causes all new server-side memory summaries to fail. The binding persists across reloads, so memory generation can remain broken until the user diagnoses and replaces the profile.

## Recommended fix

Make readiness role-aware and share one memory-provider capability check between client status calculation, binding validation, job scheduling, and worker execution. Mark unsupported Memory profiles before Apply, or implement summary adapters for every provider the generic resolver considers routable. Reject invalid summary jobs synchronously instead of consuming retries.

## Test coverage gap

The server has an Anthropic rejection unit test (`server/fastify/__tests__/memorySummaryModel.test.ts:121-133`), but there is no cross-layer test asserting that the Memory role UI does not label that same durable profile Ready. Add UI/resolver and end-to-end binding-to-job tests for supported and unsupported providers.
