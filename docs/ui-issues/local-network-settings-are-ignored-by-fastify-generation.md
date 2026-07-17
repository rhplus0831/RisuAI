# Local-network routing and timeout settings are ignored by Fastify generation

## Summary

Advanced Settings exposes **Local Network Mode (Experimental)** and, when enabled, **Local Network Timeout (sec)**. The help text says that enabling the mode detects private/LAN OpenAI-compatible URLs, routes streaming through `/api/v1/proxy/stream-jobs` or buffered calls through `/api/v1/proxy/fetch`, and applies a longer first-token timeout.

Both values persist and synchronize, but normal generation is already unconditionally routed to Fastify before the retained browser OpenAI dispatcher can calculate those options. Fastify's provider adapters do not read either setting: they fetch the resolved provider URL directly with the generation abort signal and no configured local-network timeout. Toggling the mode or changing the timeout therefore does not change the active chat/completion route, upstream request, or deadline.

## Location

- Setting definitions and conditional timeout UI: `src/ts/setting/advancedSettingsData.ts:250-266`
- User-facing routing contract: `src/lang/en.ts:235-247`
- Settings group: `src/ts/server/settingsGroups.ts:180-181`
- Fastify allowlist/type validation: `server/fastify/src/routes/commands.ts:1151-1185,1480,1566`
- Fastify settings persistence and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907`
- Retained browser-only option calculation: `src/ts/process/request/openAI/requests.ts:28-30,159-174`
- Browser OpenAI calls that would forward the options: `src/ts/process/request/openAI/requests.ts:458-490,765-790,1383-1394`
- Mandatory Fastify completion routing: `src/ts/process/request/request.ts:897-906`; `src/ts/process/request/serverCompletion.ts:13-28`
- Mandatory Fastify chat routing: `src/ts/process/serverBackedSendChat.ts:313-316`; `src/ts/process/request/serverChat.ts:232-270`
- Representative Fastify direct upstream fetches: `server/fastify/src/generation/openai.ts:303-318,483-496`

## Trigger

1. Configure an OpenAI-compatible model profile with a private URL such as `http://192.168.1.20:8080/v1`.
2. Leave **Local Network Mode** off and generate through normal chat or completion.
3. Enable the mode, set **Local Network Timeout** to a distinctive value, and repeat.
4. Compare Fastify request traces, upstream requests, and failure timing.

Both runs use the same `/api/v1/generate/chat` or `/api/v1/generate/completion` server-owned route and the same direct Fastify-to-provider fetch. The advertised proxy endpoints are not selected, and the configured timeout is not attached to the provider request.

## Expected behavior

If the controls remain exposed with their current description, disabled should preserve the non-local route/policy, while enabled local/private targets should take the explicit local-network path. Streaming requests should be cancelled at the configured timeout, and the UI should receive a recognizable timeout failure rather than wait indefinitely for the upstream first token.

Alternatively, if all provider calls are intentionally Fastify-owned now, the UI should accurately present that invariant and expose only a timeout control that Fastify actually enforces.

## Actual behavior

For ordinary completions, `resolveServerCompletionRoute` returns `server` for every non-preview request before the provider-format switch that calls `requestOpenAI`. Normal chat takes the server-backed generation path directly. Consequently `getLocalNetworkRequestOptions` is not reached by these user flows.

On Fastify, the OpenAI adapter builds the configured endpoint and calls `fetch` with only the job/request abort signal. Neither `localNetworkMode` nor `localNetworkTimeoutSec` is part of the adapter request type or dispatch policy. The same is true across the server generation layer: the only Fastify references to these fields are defaults, settings validation/persistence, and preset/loadout data plumbing—not provider routing or timeout enforcement.

The mode can thus be off while Fastify still contacts the configured LAN URL, and turning it on does not introduce the documented relay behavior. The timeout number is purely stored data.

## Underlying cause

Local-network handling was implemented in the former browser provider dispatcher as `networkRoute` and `requestTimeoutMs` hints to `fetchNative`. Provider execution later moved ahead of that dispatcher and into Fastify. The settings schema and detailed frontend help were migrated, but the route classification and timeout policy were not moved into the server provider dispatcher.

The migration also made part of the original switch redundant: ordinary provider requests no longer need a browser-to-Fastify relay because they already originate in Fastify. That architectural change was not reconciled with the toggle's meaning or its UI copy.

## Affected data flow

1. **UI interaction:** checking the mode updates `database.localNetworkMode` and reveals the timeout input; editing the number updates `database.localNetworkTimeoutSec`.
2. **Client request:** the settings bridge sends `PATCH /api/v1/commands/settings/runtime` for each accepted value.
3. **Server persistence:** Fastify validates the boolean/number, writes both to SQLite, emits `settings.updated`, and acknowledges the keys.
4. **Displayed state:** resource reconciliation keeps the checkbox and number synchronized, providing a successful-save signal.
5. **Generation:** chat posts `/generate/chat`; auxiliary requests select `/generate/completion`. Both dispatch providers inside Fastify before the browser helper that consumes these fields.
6. **Upstream request:** the server provider adapter fetches the resolved URL directly. It receives no local-network mode and derives no timeout from `localNetworkTimeoutSec`.
7. **Result display:** the UI shows the normal provider result or eventual network failure, with no indication that the selected route/timeout controls were ignored.

## Severity and user impact

**Medium-high.** The timeout control gives false operational assurance for slow or hung local inference, which can leave a generation occupied far beyond the configured deadline. The toggle also implies an access-policy boundary that does not exist in the active path: disabled and enabled do not distinguish LAN dispatch. Users troubleshooting CORS, private-network reachability, or first-token hangs can repeatedly change settings that have no effect.

## Recommended fix

Choose and document one Fastify-native contract:

- If the toggle remains meaningful, classify the resolved upstream URL on Fastify, reject or use the ordinary policy while disabled, and enable the explicitly permitted local/private route while enabled. Combine the generation cancellation signal with an `AbortSignal.timeout(localNetworkTimeoutSec * 1000)` (or an equivalent timer) and return a stable timeout code.
- If server-owned provider dispatch makes the routing toggle obsolete, remove **Local Network Mode**, update the help text, and retain/rename the timeout only after implementing it in the server adapters. Consider applying it specifically to detected local endpoints so public-provider behavior does not change unexpectedly.

Apply the policy consistently to both `/generate/chat` and `/generate/completion`, including buffered and streaming OpenAI-compatible adapters. Validate redirects and resolved addresses so a URL cannot switch policy after classification, and expose route/timeout decisions in trace metadata.

Add integration tests with a fake private-address upstream for mode on/off, buffered and streaming calls, a delayed first byte, redirects, cancellation, and durable job reattachment. Assert the observed deadline rather than only that SQLite stored the number.
