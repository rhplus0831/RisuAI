# Anti-server-overload setting is ignored by Fastify generation

## Summary

**Anti-Server Overload** still persists `antiServerOverloads`, but Fastify-owned generation never uses it. The active server chat retry policy retries all pre-token provider failures according to `requestRetrys`, regardless of this toggle. Server completion failures also lose the old `failByServerError` classification before reaching the remaining browser retry wrapper.

Enabled and disabled therefore have identical overload retry behavior on the ordinary Fastify-owned chat and completion routes even though the checkbox is stored and synchronized normally. A narrow forced-local Ollama Cloud tool compatibility path can still reach the retained browser dispatcher; the defect is the setting's disconnection from the migrated server-owned paths, not complete repository-wide unreachability.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:432-436`
- Setting group: `src/ts/server/settingsGroups.ts:40`
- Client settings request and acknowledgement path: `src/ts/server/commands.ts:2043-2061,2112-2184`; `src/ts/server/resourceState.svelte.ts:771-826`
- Fastify settings persistence: `server/fastify/src/routes/commands.ts:1844-1907`
- Remaining browser retry reader: `src/ts/process/request/request.ts:579-727`
- Remaining provider-specific browser readers: `src/ts/process/request/anthropic.ts:946-987`; `src/ts/process/request/google.ts:624`
- Mandatory completion routing and failure adaptation: `src/ts/process/request/serverCompletion.ts:13-29,172-280`
- Active server chat retry policy: `server/fastify/src/routes/generationChat.ts:223-226,280-412`

## Trigger

1. Set `requestRetrys` to a known value and turn **Anti-Server Overload** off.
2. Generate through Fastify against a provider that returns an overload response before any token.
3. Count attempts, then repeat with the toggle on.

For ordinary chat generation, both runs use the same `requestRetrys + 1` maximum attempt count. For browser callers using `/generate/completion`, provider failures are returned without `failByServerError`, so the old “retry twice as much” branch is not entered in either state.

## Expected behavior

The option should change overload-specific retry policy. Based on the retained implementation, enabled should extend the retry budget for recognized server-overload failures without changing normal validation/authentication failures; disabled should use the ordinary configured retry count.

## Actual behavior

The boolean never affects the ordinary server-owned generation paths. Server chat retries every pre-token error using the same configured count and does not classify overloads. The server-completion adapter returns non-2xx responses with `noRetry: true` and converts buffered/stream failures without the `failByServerError` field expected by the legacy browser wrapper.

## Underlying cause

Overload handling remained in frontend provider code when provider execution and chat retry ownership moved to Fastify. `requestChatData` still checks `db.antiServerOverloads` only after a response contains `failByServerError`, and provider-specific browser dispatchers still create that signal. However, `resolveServerCompletionRoute` prevents those dispatchers from running for normal requests.

Fastify's chat policy independently reads `requestRetrys` and retries pre-token failures, but never reads `antiServerOverloads` or upstream status/reason to vary its budget. The stored runtime setting is therefore disconnected from both ordinary server-owned retry lanes.

## Affected data flow

1. **UI:** the checkbox writes `database.antiServerOverloads` optimistically.
2. **Request/persistence:** the bridge sends `PATCH /api/v1/commands/settings/runtime`; Fastify writes and acknowledges the boolean.
3. **Display:** resource reconciliation keeps the checkbox consistent with SQLite, creating a successful-save signal.
4. **Chat generation:** `/generate/chat` reads the database and calls `dispatchProviderWithPolicies`, which derives retries only from `requestRetrys` and treats the toggle identically in both states.
5. **Completion generation:** `/generate/completion` performs provider work on Fastify. Its browser adapter returns failures without the overload marker needed by the old wrapper's conditional extra retries.
6. **Result:** no response, acknowledgement, or retry schedule on the ordinary server-owned chat/completion routes depends on the persisted setting. The forced-local Ollama Cloud Anthropic compatibility path is different: it can still produce `failByServerError`, which lets the outer browser wrapper read `antiServerOverloads`.

## Severity and user impact

**Medium.** Overload resilience is operational rather than destructive, but users are told they can control it and cannot. Enabling the option does not provide the expected extra recovery, while disabling it also does not reduce Fastify's broad retry behavior. This can affect latency, provider load, and confidence in retry/cost controls.

## Recommended fix

Move the policy to Fastify, where upstream status and error bodies are available. Define a narrow overload classifier (for example provider-specific 429/529/503 statuses and documented overload error types), then apply an explicit additional budget/backoff only when `antiServerOverloads` is true. Do not double every provider failure or retry authentication/validation errors.

Return retry diagnostics in generation tracing so the UI can explain how many attempts were made and why. If the policy is intentionally replaced by the unified retry count, remove this checkbox and migrate the setting rather than storing a no-op.

Add chat and completion tests that simulate the same overload sequence with the toggle on and off, plus non-overload errors to prove that only the intended class receives the extended policy.
