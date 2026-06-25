# Deferred Features And TODO Inventory

Last audited: 2026-06-25.

This inventory was built from three read-only exploration agents plus a follow-up
source sweep. The scan covered maintained source and current docs first
(`STRUCTURE.md`, `src/`, `server/fastify/`, `docs/`, `src/docs/`, `util/`,
and `README.md`) and excluded generated/runtime folders such as
`node_modules`, `dist`, `data`, `coverage`, and `test-results`.

The codebase has very few literal `TODO`/`FIXME` markers. Most unfinished work is
encoded as explicit guards, "unsupported in Fastify mode" messages, or structure
docs that name a missing server-backed route/command.

## Status Legend

| Status | Meaning |
| --- | --- |
| Actionable | A current feature gap a future implementation could close. |
| Conditional | Current behavior is deliberate, but there is a plausible future feature or optimization if product needs or metrics justify it. |
| Compatibility | Legacy/local/browser-only behavior is blocked in the Fastify variation; implement only if that compatibility surface returns. |
| No-port | Documented as removed, obsolete, or intentionally browser-only. |
| Docs cleanup | The source/docs contain stale or conflicting wording rather than a runtime feature gap. |

## Current Actionable Items

| Area | Deferred or TODO item | Evidence | Notes |
| --- | --- | --- | --- |
| Playground | Playground still has an unnamed "Coming soon" tile. | `src/lib/Playground/PlaygroundMenu.svelte:134` | The UI stub does not name the future feature, so this needs product clarification before implementation. |
| MCP modules | MCP module import/update is blocked in Fastify server-backed mode. | `src/ts/process/modules.ts:64`, `src/ts/process/mcp/mcp.ts:441`, `docs/structure/plugins-and-mcp.md:115` | Current docs say ordinary non-MCP `.risum` import works; only modules containing MCP metadata need a dedicated command-backed route. |
| MCP Google Search | Internal Google Search MCP exists in the UI list, but credential initialization throws in server-backed web mode. | `src/ts/process/mcp/mcp.ts:413`, `src/ts/process/mcp/googlesearchclient.ts:153`, `docs/structure/plugins-and-mcp.md:126` | Needs a server-backed credential model before the internal Google Search MCP can work. |
| MCP risuaccess | Risu-access MCP cannot edit/delete character asset references in server-backed mode. | `src/ts/process/mcp/risuaccess/characters.ts:997` | The missing piece is likely command-backed asset reference mutation. |
| MCP result persistence | Remote MCP tool results may include text, image/audio base64, or resources, but those payloads are not server-persisted. | `docs/structure/plugins-and-mcp.md:127` | Needs a later command if tool results should become durable project data. |
| Plugin V3 secrets | `saveSecretHeader`/server-secret storage logs "not implemented yet" until write-only plugin secret storage exists. | `src/ts/plugins/apiV3/v3.svelte.ts:1737` | This is a security/storage feature, not just a missing UI. |
| Slash/STScript commands | `/setinput` is marked not implemented; `/sendas` exists but ignores the requested sender name. | `src/ts/process/command.ts:92`, `src/ts/process/command.ts:111` | Actionable command parity work. |
| Provider preview bodies | Provider preview bodies are unsupported in Fastify mode because browser-side provider dispatch is disabled. | `src/ts/process/request/serverCompletion.ts:20` | Implement only if preview-body inspection remains a supported workflow in server mode. |
| Completion provider coverage | `/api/v1/generate/completion` supports only the fixed provider set in `SUPPORTED_PROVIDERS`; unknown providers return `501 provider not implemented yet`. | `server/fastify/src/routes/generation.ts:42`, `server/fastify/src/routes/generation.ts:1291` | Actionable when adding a new server provider adapter. |
| Completion streaming | Direct completion streaming is rejected for buffered providers: Cohere, legacy instruct, Responses, Kobold, Ooba legacy, Bedrock, and Horde. | `server/fastify/src/routes/generation.ts:1344`, `server/fastify/src/routes/generation.ts:1368`, `server/fastify/src/routes/generation.ts:1385`, `server/fastify/src/routes/generation.ts:1397`, `server/fastify/src/routes/generation.ts:1410`, `server/fastify/src/routes/generation.ts:1431`, `server/fastify/src/routes/generation.ts:1444`, `src/ts/process/request/anthropic.ts:471` | Some providers may stay buffered by design; Bedrock also has a literal `// todo?` stream marker in the browser request path. |
| Provider request-shape parity | Implemented server provider adapters drop or omit richer request shapes such as tools/functions, multimodal parts, Gemini thinking config, and response schema. | `server/fastify/src/generation/gemini.ts:72`, `server/fastify/src/generation/openaiResponses.ts:73`, `server/fastify/src/generation/ollama.ts:43`, `server/fastify/src/generation/cohere.ts:131` | Actionable if server dispatch should match those browser/provider request features. |
| Hosted model tools | `modelTools` are copied into the effective DB, but Fastify OpenAI Responses dispatch sends no hosted tool list. | `docs/structure/providers-and-models.md:193` | Related to provider request-shape parity. |
| Logit bias | Server chat prompt assembly intentionally does not compute or emit provider-level logit-bias rows. | `server/fastify/src/prompt/assemble.ts:1268`, `docs/structure/providers-and-models.md:175` | Actionable if server dispatch must match browser logit-bias behavior. |
| Token and budget accuracy | Server token/preflight budgeting is text-only and omits provider tokenizers, count-token APIs, GGUF tokenization, multimodal image-token math, and some preflight chains. | `server/fastify/src/prompt/preflight.ts:28`, `server/fastify/src/prompt/tokens.ts:5`, `server/fastify/src/prompt/budgetFinalize.ts:21` | Accuracy/parity work for large prompts, multimodal, or provider-specific token accounting. |
| CBS server adapter | Server-side CBS leaves browser-only callbacks unsafe to invoke, returns empty module/lorebook callback results, and uses placeholder model metadata. | `server/fastify/src/prompt/cbsAdapter.ts:16`, `server/fastify/src/prompt/cbsAdapter.ts:116`, `src/ts/cbs.ts:8` | Prompt assembly paths avoid these today; close only if server CBS expansion needs them. |
| Trigger/Lua parity | Server trigger/Lua support is partial: browser UI and persistent-resource effects no-op, interactive Lua APIs fail, and multimodal Lua LLM input is unsupported. | `server/fastify/src/prompt/triggers.ts:53`, `server/fastify/src/prompt/triggerDataEffects.ts:67`, `server/fastify/src/prompt/luaRuntime.ts:707`, `server/fastify/src/prompt/luaRuntime.ts:771` | Some items are browser-only by nature; server-side LLM/similarity/image/lorebook functions are the likely actionable subset. |
| Cold storage | Cold-storage creation is a stub, and cold-storage chat/character hydration is unsupported in server-backed web mode. | `src/ts/process/coldstorage.svelte.ts:195`, `src/ts/characters.ts:1287` | Compatibility work for legacy cold-storage data. |
| Lorebook stubs | "Enable lorebook stubs" is experimental; the settings warning says the full reader surface has not been validated and entries may not appear or save correctly. | `src/ts/setting/advancedSettingsData.ts:203` | Needs real-app validation and likely UI/bridge tests before enabling broadly. |
| Preset export parity | Presets with images or regexes warn that they cannot be exported yet. | `src/lib/Others/AlertComp.svelte:864` | Actionable export format/parity work. |
| Popup CBS mode | Popup editor exposes a CBS option but disables it. | `src/lib/Others/PopupEditor.svelte:57` | Parked UI affordance; implement only if CBS preview/editing is desired. |

## Conditional Or Metric-Gated Deferrals

| Area | Deferred item | Evidence | Trigger to revisit |
| --- | --- | --- | --- |
| Durable generation restart survival | In-flight generation jobs are held in process memory. Browser reload/reattach works while the server stays alive, but jobs do not survive server restart. | `server/fastify/src/generationJobs.ts:4`, `server/fastify/src/generationJobs.ts:17`, `server/fastify/src/routes/bootstrap.ts:54` | Persist job state/result to disk if restart survival becomes a release requirement. |
| Projection narrowing | Sprawling resources such as `settings`, `state`, `pluginStorage`, and `prompt` intentionally return full bootstrap payloads instead of targeted projections. | `server/fastify/src/routes/projection.ts:155`, `server/fastify/src/routes/projection.ts:568`, `util/analyze-database.ts:377` | Add targeted resource contracts only after diagnostics show frequent costly fallback for a named resource family. |
| Backup/export memory profile | Bundle export streams asset entries but still materializes the embedded `.risu` bytes before asset streaming; browser download still saves a Blob through an object URL. | `server/fastify/src/routes/save.ts:225`, `src/ts/server/backups.ts:229`, `src/ts/storage/backup.ts:44`, `src/ts/storage/backup.ts:129` | Consider a streaming `.risu` writer or File System Access API path if large exports create real memory pressure. |
| `.risu` remote/cache references | Remote and cache-only `.risu` block references are reported as unsupported and skipped. | `server/fastify/src/risuSave/blockCodec.ts:126`, `server/fastify/src/risuSave/blockCodec.ts:166`, `server/fastify/src/risuSave/importSnapshot.ts:108`, `src/ts/storage/risuSave.ts:473`, `src/ts/storage/risuSave.ts:523`, `src/ts/storage/risuSave.ts:550` | Implement only if remote/cache reference hydration is a supported import target. |
| Local GGUF tokenization | The local GGUF tokenizer path exists but always throws. | `src/ts/process/models/local.ts:1`, `src/ts/tokenizer.ts:215` | Mostly relevant only if local model support returns to the Fastify-backed web flow. |

## Compatibility And No-Port Items

| Area | Item | Evidence | Classification |
| --- | --- | --- | --- |
| Fastify-only runtime | Native/mobile wrappers, browser-local persistence, service workers, peer sync, Drive sync, and non-Fastify modes are not live. | `STRUCTURE.md:81` | No-port for the Fastify variation. |
| Server prompt assembly gates | Server assembly hard-fails shapes it cannot safely represent: group chat, Plugin/WebLLM/non-server-routable providers, non-vision image-caption fallback, interactive Lua dialogs, and Plugin V2 edit/replacer hooks. | `src/ts/process/request/serverPromptAssembly.ts:128`, `docs/structure/providers-and-models.md:253` | Mixed: non-vision caption and some Lua work are actionable parity; group chat and Plugin V2 are no-port/obsolete. |
| Browser/local providers | Server chat dispatch refuses unknown OpenAI-compatible models and local/browser-only providers such as NovelAI, NovelList, Ooba OpenAI-compatible, plugin providers, and WebLLM. | `server/fastify/src/prompt/chatDispatch.ts:304`, `server/fastify/src/prompt/chatDispatch.ts:453` | Compatibility-only unless server ownership expands to those providers. |
| Plugin execution | Fastify stores plugin records/storage but does not execute browser plugin code; Plugin V2 edit/replacer hooks make server prompt assembly unsupported. | `docs/structure/plugins-and-mcp.md:24`, `docs/structure/plugins-and-mcp.md:31`, `server/fastify/src/prompt/scripts.ts:82`, `server/fastify/src/prompt/assemble.ts:1858`, `util/client-thinning-audit.ts:2875` | Plugin V2 is a permanent no-port. Plugin V3 runs in the browser iframe runtime. |
| Legacy plugin storage APIs | Legacy plugin DB/device-local storage APIs are blocked or require compatibility mode in Fastify. | `src/ts/plugins/plugins.svelte.ts:682`, `src/ts/plugins/pluginSafeClass.ts:10` | Intentional compatibility guard, not a primary feature TODO. |
| Popup/default CBS primitives | Default CBS callbacks throw until a real adapter injects them. | `src/ts/cbs.ts:8`, `src/ts/cbs.ts:11` | Mostly infrastructure guard; server adapter gaps are listed above. |
| Generic internal MCP fallback | Unknown internal MCP tool calls return "not implemented". | `src/ts/process/mcp/internalmcp.ts:65` | Fallback behavior, not a named feature by itself. |

## Docs Cleanup And Stale Markers

| Marker | Evidence | Disposition |
| --- | --- | --- |
| `.risum` import wording conflict | `src/docs/client-runtime.md:231` says module `.risum` import is unsupported, while `docs/structure/plugins-and-mcp.md:116` clarifies ordinary non-MCP `.risum` import is not blocked. | Docs cleanup: narrow the client-runtime note to MCP-bearing `.risum` modules. |
| UI stale-state audit findings | `docs/ui-flow-stale-state-audit.md:68` lists current-code issues, but `docs/ui-flow-stale-state-audit-progress.md:18` through `docs/ui-flow-stale-state-audit-progress.md:50` mark all confirmed issues and risks fixed. | Historical audit record, not a current deferred-feature list. |
| Prompt-template phase TODOs | Phase docs contain contract TODOs and risks, but `docs/prompt-template-ownership-cleanup/status.md:13` and `docs/prompt-template-ownership-cleanup/status.md:80` say phases 1-6 are complete with no known blockers. | Historical plan notes. The remaining current caveat is the optional compatibility mirror cleanup below. |
| Prompt-template compatibility mirror | Server prompt-preset select/update/delete paths may still write `prompt_templates` as a compatibility mirror until a later phase removes or permanently documents it. | `docs/prompt-template-ownership-cleanup/status.md:134`, `docs/prompt-template-ownership-cleanup/SOLVE-NOTE.md:126` | Optional cleanup/documentation slice. |
| Model runtime-defaults placeholder | `src/lang/en.ts:1864` still says the full runtime-defaults field editor lands later, but `src/lib/Setting/Pages/Model/ModelRuntimeDefaultsEditor.svelte:19` exists and tests cover opening it. | Stale language string if unused; not a live feature gap. |
| External wiki WIP | `README.md:39` marks the external wiki as work in progress. | Docs-only, not a project feature TODO. |

## Archived Notes

`.archived-docs/leftover.md` and related archived plans contain older deferred
workstream notes. `STRUCTURE.md` says archived records explain past decisions and
are not the source of current behavior, so this inventory only lifts archived
items when current source or current structure docs still confirm them.
