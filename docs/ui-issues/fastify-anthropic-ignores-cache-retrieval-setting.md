# Fastify Anthropic ignores the cache-retrieval setting

## Summary

The experimental **Claude Caching Retrieval** option is still exposed and durably persists `claudeRetrivalCaching`, but its only behavioral reader is in the browser Anthropic dispatcher. Ordinary Anthropic chat and completion generation routes through Fastify-owned provider dispatch, so those requests do not register the periodic Claude cache observer. A forced-local Ollama Cloud tool compatibility path can still enter the browser dispatcher; this report is scoped to the normal Fastify Anthropic paths.

Fastify's Anthropic implementation supports ordinary and one-hour cache-control headers, but it never reads `claudeRetrivalCaching` and has no equivalent four-minute refresh lifecycle. The checkbox therefore remains checked across reloads while ordinary Fastify Anthropic requests schedule no cache keepalive.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:549-569`
- Setting group: `src/ts/server/settingsGroups.ts:65`
- Generic client request: `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907`
- Mandatory Fastify completion routing: `src/ts/process/request/serverCompletion.ts:13-29`; `src/ts/process/request/request.ts:897-916`
- Mandatory server chat routing: `src/ts/process/index.svelte.ts:274-358`
- Browser-side reader bypassed by ordinary Fastify Anthropic requests: `src/ts/process/request/anthropic.ts:868-876`
- Browser observer behavior: `src/ts/observer.svelte.ts:259-307`
- Fastify Anthropic request construction: `server/fastify/src/prompt/chatDispatch.ts:1130-1159`; `server/fastify/src/generation/anthropic.ts:14-40,128-197`

## Trigger

1. Enable experimental settings.
2. Turn on **Claude Caching Retrieval**.
3. Generate with an Anthropic model through the ordinary Fastify chat/completion route whose request uses prompt caching.
4. Leave the client/server running beyond the observer's advertised four-minute refresh interval and inspect provider traffic.

The setting persists and is still checked after reload, but that Fastify Anthropic request produces no periodic low-token cache refresh.

## Expected behavior

As described by the locale help text, enabling the option should retain the last eligible Claude cached prompt by issuing a small refresh request approximately every four minutes. Disabling it should stop that lifecycle.

## Actual behavior

Enabled and disabled produce the same ordinary Fastify Anthropic traffic. Only the real generation request is sent. That route does not call `registerClaudeObserver`, so the browser observer receives no URL, body, or headers from it to refresh.

## Underlying cause

Before provider dispatch moved to Fastify, `requestClaude` called `registerClaudeObserver` when `db.claudeRetrivalCaching` was true. That code remains in the repository, which makes a text-reference audit look healthy.

The routing contract makes it dead for ordinary Anthropic application requests: `resolveServerCompletionRoute` returns `server` for every non-preview completion, and supported text sends use `/api/v1/generate/chat`. The forced-local Ollama Cloud tool compatibility path can still enter the browser Anthropic dispatcher, but that is not the normal Fastify Anthropic route and does not restore this option for Claude-backed chat/completion. Fastify resolves Anthropic credentials and options from its unmasked database, but `chatDispatch` passes only the separate `claude1HourCaching` value to `resolveAnthropicRequest`. The server request type has no retrieval/keepalive option and no observer service.

## Affected data flow

1. **UI:** the data-driven checkbox optimistically updates `database.claudeRetrivalCaching`.
2. **Request:** the settings bridge sends `PATCH /api/v1/commands/settings/providers` with the boolean.
3. **Persistence:** Fastify validates and writes the providers setting, emits `settings.updated`, and returns an acknowledgement.
4. **Displayed state:** the acknowledgement/resource projection leaves the checkbox checked, accurately showing the stored value.
5. **Generation:** browser chat and completion adapters send server intent to Fastify. Server `chatDispatch` builds an Anthropic request without reading the stored flag.
6. **Missing effect:** the only call to `registerClaudeObserver` sits in the browser provider dispatcher that ordinary Anthropic chat/completion bypasses, so neither side schedules the advertised refresh for those requests.

## Severity and user impact

**Medium.** The option is experimental, but users may rely on it to reduce Claude prompt-cache misses and cost. The UI reports durable success while ordinary Fastify Anthropic generation never provides the promised behavior, and there is no status or traffic indication explaining that the cache keepalive was not registered for those requests.

## Recommended fix

Either port cache retrieval to a server-owned lifecycle or remove the option. A server implementation should associate the refresh with a safe cache identity, use unmasked credentials without returning them to the browser, cancel on setting/model/database-lineage changes, avoid duplicate refresh loops across clients, and expose failure/cost diagnostics. It should not simply replay arbitrary stale request bodies indefinitely.

If this behavior is no longer supported, remove the setting from the UI and migrate/ignore the stored field explicitly. Do not leave a browser-only compatibility reader as apparent evidence that ordinary Fastify Anthropic requests support it.

Add a fake-clock integration test that enables the setting, performs an Anthropic request through `/generate/chat` and `/generate/completion`, advances past the refresh interval, and asserts exactly one bounded refresh. Add the disabled counterpart and cancellation tests.
