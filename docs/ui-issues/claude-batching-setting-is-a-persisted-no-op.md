# Claude batching setting is a persisted no-op

## Summary

The experimental **Claude Batching** option durably persists `claudeBatching`, but its sole runtime reader is in the browser Anthropic dispatcher. Fastify mode routes normal chat and completion requests to server-owned provider implementations, and the Fastify Anthropic implementation supports only immediate Messages requests.

Enabling batching therefore still sends an ordinary synchronous/streaming Anthropic request. No batch is created, polled, cancelled, or recovered even though the checkbox remains enabled after reload.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:445-451`
- Setting group and client settings request: `src/ts/server/settingsGroups.ts`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify settings persistence: `server/fastify/src/routes/commands.ts:1844-1907`
- Mandatory Fastify completion route: `src/ts/process/request/serverCompletion.ts:13-29`; `src/ts/process/request/request.ts:897-916`
- Mandatory server chat route: `src/ts/process/index.svelte.ts:274-358`
- Unreachable browser batch implementation: `src/ts/process/request/anthropic.ts:672-860`
- Fastify Anthropic implementation: `server/fastify/src/prompt/chatDispatch.ts:1130-1159`; `server/fastify/src/generation/anthropic.ts:14-40,128-235`

## Trigger

1. Turn on **Claude Batching**.
2. Send a normal chat or invoke another Claude-backed completion.
3. Inspect Anthropic traffic and the generation lifecycle.

The request goes to the ordinary Messages endpoint and returns on the normal generation timeline. Repeating with the setting off produces the same route and behavior.

## Expected behavior

Enabling the option should use Anthropic's batch flow: create a batch request, poll its status, retrieve results when complete, and cancel or detach safely on abort according to the product's documented long-running behavior. Disabling it should use immediate Messages generation.

## Actual behavior

Fastify never reads `claudeBatching` and never appends `/batches`. It always calls `runAnthropic` or `runAnthropicStream` for an ordinary request. The complete batch implementation still present in `src/ts/process/request/anthropic.ts` is unreachable because the request router returns the server route before browser provider dispatch.

## Underlying cause

Provider execution moved from the browser to Fastify, but this provider-specific option was migrated only as settings data. The old branch removes `stream`, posts a one-item batch, polls for up to 24 hours, retrieves results, and handles cancellation. None of those semantics exist in the server request type or generation job runner.

The generic settings allowlist accepts the boolean without verifying that the selected provider adapter consumes it, so persistence and acknowledgement mask the missing behavior.

## Affected data flow

1. **UI:** the Advanced Settings checkbox writes `database.claudeBatching`.
2. **Request/persistence:** the providers-group settings command is accepted by Fastify, written to SQLite, and acknowledged.
3. **Displayed state:** the accepted resource projection keeps the checkbox checked across clients and reloads.
4. **Generation request:** chat uses `/api/v1/generate/chat`; auxiliary completion uses `/api/v1/generate/completion`. Both resolve Anthropic on the server.
5. **Server mutation/runtime:** `chatDispatch` builds an `AnthropicRequest` without a batching field, and the generation adapter sends the standard Messages request.
6. **Missing acknowledgement:** no batch ID/status ever exists, so the UI cannot display or reattach to the batch behavior the setting promises.

## Severity and user impact

**Medium-high.** Anthropic batching has materially different price, latency, and cancellation semantics. A user who deliberately enables it can incur immediate-request cost and behavior while believing generation is using the batch API. The normal successful settings acknowledgement gives no warning.

## Recommended fix

Either implement batching as a Fastify-owned durable generation job or remove the option. A port must persist the provider batch ID, survive browser disconnect/server restart, poll with bounded backoff, support cancellation, secure credentials, reconcile the result into the correct chat/owner, and expose pending/failed/expired status. It should not hold a browser stream open for 24 hours as the legacy branch did.

If unsupported, remove the checkbox and migrate the stored field. Also delete or clearly isolate the dead browser implementation so future audits do not mistake it for a live consumer.

Add an integration test with a fake Anthropic upstream asserting that enabled posts to `/batches` and completes through result retrieval, while disabled posts to `/messages`. Cover restart/reattach, cancellation, expiry, and a foreign settings update during a pending job.
