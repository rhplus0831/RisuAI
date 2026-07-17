# Fastify prompt budgeting ignores configured tokenizers

## Summary

Several model/settings surfaces let users choose how the active model is tokenized: the legacy Custom API tokenizer, modern profile custom tokenizer/runtime override, provider/model tokenizer metadata, and experimental Google Cloud tokenization. Those values persist and the browser tokenizer honors them, but Fastify's authoritative prompt assembly uses a separate minimal tokenizer that reads only `db.aiModel` and selects `cl100k_base` or `o200k_base`.

Because normal text sends are server-mandatory, changing these settings does not change the prompt token count, history trimming, memory budget, or preflight result used for actual generation. Browser utilities can still report the configured tokenizer's count, so different UI/runtime paths can disagree about the same prompt.

## Location

- Google tokenization setting: `src/ts/setting/advancedSettingsData.ts:326-335`
- Legacy custom-tokenizer control: `src/lib/Setting/Pages/BotSettings.svelte:214,1570-1576`
- Modern profile tokenizer controls: `src/lib/Setting/Pages/Model/ModelProfileEditorDrawer.svelte:88-92,221-232`; `src/lib/Setting/Pages/Model/ModelProviderPanel.svelte:333-343`; `src/lib/Setting/Pages/Model/ModelRuntimeOptionsEditor.svelte:54-60`
- Settings ownership: `src/ts/server/settingsGroups.ts:90,138`
- Browser tokenizer behavior: `src/ts/tokenizer.ts:21-31,86-99,195-235`
- Mandatory server prompt/generation route: `src/ts/process/index.svelte.ts:274-378`; `src/ts/process/request/serverCompletion.ts:13-29`
- Effective profile projection: `server/fastify/src/prompt/effectiveGenerationConfig.ts:195-225`
- Fastify tokenizer configuration: `server/fastify/src/prompt/tokenizerConfig.ts:1-26`; `server/fastify/src/prompt/tokens.ts:4-46,64-99`
- Authoritative prompt-budget consumers: `server/fastify/src/prompt/preflight.ts:70-110`; `server/fastify/src/prompt/history.ts:418-537`; `server/fastify/src/prompt/memory.ts:45-90`; `server/fastify/src/prompt/budgetFinalize.ts:40-70`
- Server token count returned to the UI: `src/ts/process/serverBackedSendChat.ts:465-475`; `src/ts/process/request/serverChat.ts:400-401`

## Trigger

One concrete path is:

1. Select Custom API/reverse proxy or a modern custom-API model profile.
2. Set its tokenizer to Claude, Gemma, Llama, Mistral, a plugin tokenizer, or another choice whose count differs from `cl100k_base`.
3. Preview/send a long prompt close to `maxContext`, recording the server prompt count and rows retained.
4. Change only the tokenizer and repeat.

The Fastify prompt token count and trimming are unchanged. The same occurs when toggling experimental **Google Cloud Tokenization** for a Google-tokenized model: browser `tokenizer.ts` switches between the Google count API and Gemma tokenizer, but server assembly uses the same tiktoken encoding in both states.

## Expected behavior

The tokenizer selected for the effective model/profile should be the tokenizer used to enforce its context window. Changing it should update token counts and, when near the limit, which history/memory rows survive. All displayed prompt counts should describe the same authoritative budget used for the request.

## Actual behavior

Fastify materializes profile runtime `customTokenizer` into its effective database, but `tokenizerOptionsFromDb` ignores that field, `googleClaudeTokenizing`, model-info tokenizer metadata, and plugin/provider tokenizer hooks. It derives only a tiktoken encoding from the legacy `aiModel` string and a GPT/non-GPT message overhead.

Every server prompt phase consumes that minimal configuration. The returned `info.tokens.prompt` then becomes the browser's generation info, so the active chat reports Fastify's fallback count even when a browser tokenizer tool or compatibility path reports the configured tokenizer's different count.

## Underlying cause

Prompt assembly migrated to Fastify before provider-specific and extensible tokenization did. `server/fastify/src/prompt/tokens.ts` explicitly declares count-token APIs, custom hooks, local GGUF tokenization, provider tokenizers, and multimodal token math out of scope. The frontend controls and profile schema were nevertheless retained without an unsupported-state warning or a server capability fence.

The data flow therefore has two valid projections of tokenizer configuration but only the retired/browser-side tokenization implementation consumes them. Persistence acknowledgement cannot reveal that the authoritative budgeting implementation dropped the option.

## Affected data flow

1. **UI interaction:** a legacy setting draft, modern model-profile editor, or data-driven advanced checkbox changes tokenizer configuration.
2. **Client projection/request:** generic provider/runtime settings or model-profile commands optimistically update the resource and send the value to Fastify.
3. **Server persistence:** Fastify stores and acknowledges the setting/profile. Effective-generation projection can copy a profile runtime `customTokenizer` into the request-scoped database.
4. **Prompt assembly:** `/api/v1/generate/chat` builds history, memory, preset cards, and final context using `tokenizerOptionsFromDb`; all stages receive only cl100k/o200k plus fixed overhead.
5. **Provider request:** the server trims according to that fallback budget and dispatches the resulting prompt. The selected tokenizer is not invoked before the request.
6. **Displayed state:** the settings controls show the accepted choice, while generation info uses the fallback server count. Browser `tokenizer.ts` consumers can show another count, leaving components inconsistent.

## Severity and user impact

**High.** Incorrect token accounting can prematurely discard history/memory, exceed a provider's real context limit, or misstate remaining capacity. The discrepancy is largest for non-OpenAI, local, custom, and plugin models—the exact cases where the tokenizer selectors are most important. Because Fastify returns a plausible numeric count, users receive no indication that their saved configuration was ignored.

## Recommended fix

Create one authoritative tokenizer contract shared by model resolution and prompt budgeting. Fastify should resolve a tokenizer capability/identity from the effective model profile, then use an implementation that supports the configured provider/custom tokenizer. Asynchronous provider `countTokens` APIs may require making budget phases async or pre-tokenizing/caching inputs before synchronous assembly; cache keys must include model, tokenizer identity/version, relevant flags, and plugin/provider owner.

For tokenizers that cannot safely run on the server, mark the profile unsupported for server prompt assembly and block generation with an actionable message, or remove/disable that selector in Fastify mode. Do not silently fall back to tiktoken while displaying the configured value as active.

Add end-to-end tests with two deterministic tokenizers that return materially different counts. Save each through both legacy and modern profile UIs, send the same near-limit transcript, and assert server `info.tokens.prompt`, retained rows, and displayed generation info all change consistently. Add Google flag, plugin tokenizer, foreign profile update, and cache-invalidation cases.
