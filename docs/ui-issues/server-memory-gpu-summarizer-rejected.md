# Server-backed memory exposes GPU summarizers that the server rejects

## Summary

On WebGPU-capable browsers, Hypa V3 settings offer three client-side Qwen summarization models. The migrated app always uses the server memory API, while the Fastify summary worker accepts only `subModel`/`memory`, so selecting any advertised Qwen value persists successfully but makes every server summary job fail.

## Location

- `src/lib/Setting/Pages/OtherBotSettings.svelte:90-91,1478-1489`
- `src/ts/server/settingsBridge.svelte.ts:137-268,451-486`
- `src/ts/server/settingsGroups.ts:151-158`
- `src/ts/server/commands.ts:2043-2062`
- `server/fastify/src/routes/commands.ts:1844-1905`
- `src/ts/process/request/serverMemory.ts:72-74`
- `server/fastify/src/memoryChunkPlanner.ts:55-65,90-103`
- `server/fastify/src/prompt/assemble.ts:1699-1708`
- `server/fastify/src/memorySummaryModel.ts:16-21`
- `server/fastify/src/memorySummarizeJobHandler.ts:171-205`

## Trigger

On a browser where `navigator.gpu` exists, choose `Qwen3-1.7B-q4f32_1-MLC`, `Qwen3-4B-q4f32_1-MLC`, or `Qwen3-8B-q4f32_1-MLC` as the Super Memory model, then generate enough chat history for server memory summarization.

## Expected behavior

Every model offered by the settings UI should have a working execution path in the active memory architecture, or the option should be unavailable with a clear compatibility explanation.

## Actual behavior

The selected Qwen value is accepted and persisted in `hypaV3Presets`. The server creates summary chunks/jobs carrying that model string, then rejects each job because it is neither `subModel` nor `memory`. The chunk is marked failed and no summary is produced.

## Underlying cause

The model selector retained frontend-era WebGPU choices and gates them only on browser GPU availability. `canUseServerMemoryApi()` now always returns true, so those client-executed model paths are not used. No validation at settings persistence or job planning checks the server worker's narrower supported-model contract.

## Affected data flow

1. **UI:** `OtherBotSettings.svelte:1478-1489` writes a Qwen model string into the selected Hypa preset draft.
2. **Client state/request:** the draft bridge (`settingsBridge.svelte.ts:137-268,451-486`) optimistically updates and queues the memory settings patch. `settingsGroups.ts:151-158` maps `hypaV3Presets` to `memory`; `server/commands.ts:2043-2062` sends `PATCH /api/v1/commands/settings/memory`.
3. **Server persistence:** `routes/commands.ts:1844-1905` accepts and writes `hypaV3Presets` without validating summary-model executability.
4. **Job creation:** `memoryChunkPlanner.ts:55-65,90-103` and prompt follow-ups in `prompt/assemble.ts:1699-1708` copy the persisted model into summarize jobs.
5. **Job response/display:** `memorySummaryModel.ts:16-21` rejects the value; `memorySummarizeJobHandler.ts:200-205` marks the chunk failed and throws for retry/failure.

## Severity and user impact

**High.** A visible, persistable option deterministically disables new memory summaries on WebGPU-capable clients. The bad setting survives reload and continues to generate failing jobs.

## Recommended fix

In server-backed mode, expose only `subModel` unless the server gains a real implementation for additional models. Prefer a capability list supplied by the server rather than testing `navigator.gpu`. Validate `summarizationModel` both when saving Hypa settings and before enqueueing jobs, and report an actionable configuration error without retrying a deterministic incompatibility.

## Test coverage gap

Add a WebGPU-present UI test that verifies unsupported model options are absent or disabled in server-backed mode. Add server validation tests for settings and planner inputs so an unsupported model cannot be persisted and converted into retrying jobs.
