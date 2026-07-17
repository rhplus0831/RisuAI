# Memory punctuation-removal setting is a persisted no-op

## Summary

The Advanced Settings option **Memory Punctuation Removal** persists `removePunctuationHypa`, but no current Hypa V3 or Fastify memory path reads it. Summary/chunk text retains its punctuation before embedding in both the remaining browser implementation and the server memory worker.

The field was consumed by the retired SupaMemory implementation, so toggling it now changes only stored settings and the checkbox.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:358-366`
- Setting group and client request: `src/ts/server/settingsGroups.ts:262`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify settings persistence: `server/fastify/src/routes/commands.ts:1844-1907`
- Current browser Hypa V3 embedding inputs: `src/ts/process/memory/hypav3.ts:510-607,1169-1207`
- Active memory-window entry: `src/ts/process/promptAssembly/buildMemoryWindow.ts:92-113`
- Fastify embedding inputs: `server/fastify/src/memoryEmbedJobHandler.ts:201-297,323-349,437-492`
- Former punctuation-removal behavior: `/home/codex/Risuai/src/ts/process/memory/supaMemory.ts:129-156`

## Trigger

1. Enable Hypa memory with summaries containing punctuation that materially changes the embedding input, such as `alpha-beta` versus `alpha beta`.
2. Run similarity-memory indexing with **Memory Punctuation Removal** enabled and capture the embedded summary/chunk text.
3. Disable it, rebuild/re-run the same memory operation, and compare.

The exact same punctuated summary chunks are embedded in both runs.

## Expected behavior

Per the setting's help text and former implementation, enabled should strip the configured punctuation characters from accumulated/candidate memory text before it is embedded and compared. Disabled should preserve that text. The former implementation did not normalize the recent-chat query, so query normalization is not part of this historical expected behavior.

## Actual behavior

The current Hypa V3 code trims and splits summaries but passes the resulting memory text directly into `HypaProcessorV2`/`HypaProcesserEx`. Fastify's memory worker sends `chunk.text` unchanged to independent and contextual embedding providers. Neither path reads the setting.

## Underlying cause

`removePunctuationHypa` belonged to the old `supaMemory.ts` algorithm, where it explicitly removed punctuation from accumulated memory and candidate chunks before embedding. That implementation is absent from the current source. Hypa V3 introduced new preset-driven chunking and the migration added server-owned memory jobs, but the legacy top-level toggle, defaults, language strings, setting group, and Fastify allowlist remained.

Because settings validation checks only the field's type and ownership, Fastify accepts a value that no memory planner, repository, embedding handler, or browser Hypa V3 processor consumes.

## Affected data flow

1. **UI:** the data-driven checkbox optimistically updates `database.removePunctuationHypa`.
2. **Request:** the bridge sends `PATCH /api/v1/commands/settings/memory` with the boolean.
3. **Persistence/response:** Fastify stores and acknowledges it; resource projection keeps every client checkbox synchronized.
4. **Browser memory path:** Hypa V3 constructs embedding text from `summary.text` without consulting the accepted value.
5. **Server memory path:** planned chunks are stored and `memoryEmbedJobHandler` passes `chunk.text` directly to provider adapters, also without consulting the value.
6. **Displayed/functional result:** the setting appears saved, while memory selection and generated prompt context are identical for enabled and disabled.

## Severity and user impact

**Medium.** Memory still runs, but users cannot obtain the normalization behavior the setting promises. Existing databases default the field to true, so users may believe punctuation has been removed when embeddings and similarity queries actually retain it. This can change retrieval quality and makes migrated results differ from the old implementation without warning.

## Recommended fix

Decide whether punctuation removal remains part of the supported Hypa V3 contract. If so, normalize memory text in one shared, deterministic function before both storage/digesting and embedding, and include the normalization mode in embedding cache/group identities so toggling it invalidates incompatible vectors. If the new contract also normalizes queries, apply the same function to document chunks and queries explicitly; that would be a consistency improvement beyond the former behavior. Port the chosen contract to any browser compatibility path.

If Hypa V3 intentionally supersedes this heuristic, remove the legacy top-level control and stored field or replace it with a clearly scoped preset option plus migration. Do not change existing embeddings in place without reindexing.

Add end-to-end memory tests that capture provider inputs and cache identities with the option on/off, then verify an authoritative memory-group update causes the correct reindex/retrieval behavior.
