# Force-proxy-OpenAI-format setting is a persisted no-op

## Summary

Advanced Settings exposes **Force Proxy Format as OpenAI** and Fastify persists `forceProxyAsOpenAI`, but no production runtime code reads the field. Reverse-proxy request formatting is selected exclusively from `customAPIFormat` or the resolved model profile.

When the force option is enabled and the configured custom API format is Anthropic, Cohere, Gemini, Responses, or another non-OpenAI format, the application continues using that non-OpenAI adapter.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:227-233`
- Setting group and client command: `src/ts/server/settingsGroups.ts:129`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907`
- Client/server-safe reverse-proxy model resolution: `src/ts/model/modelProfileResolver.ts:709-734,1845-1864`
- Fastify legacy model-info resolution: `server/fastify/src/prompt/chatDispatch.ts:347-365`
- Fastify provider request dispatch: `server/fastify/src/prompt/chatDispatch.ts:581-632,966-1225`
- Original retained setting, also without a runtime reader: `/home/codex/Risuai/src/ts/setting/advancedSettingsData.ts:125`; `/home/codex/Risuai/src/ts/storage/database.svelte.ts:949`

## Trigger

1. Select the reverse-proxy/custom-API model.
2. Configure `customAPIFormat` to a non-OpenAI wire format and an endpoint that can distinguish it.
3. Enable **Force Proxy Format as OpenAI**.
4. Generate through the Fastify completion/chat route and inspect the resolved request.

The request still uses the configured non-OpenAI formatter and endpoint derivation. Disabling the option makes no difference.

## Expected behavior

When enabled, a reverse-proxy request should resolve as `LLMFormat.OpenAICompatible` regardless of the configured proxy format, including OpenAI message/body shape and URL derivation. When disabled, `customAPIFormat` should control the adapter.

## Actual behavior

Both client model-profile resolution and Fastify's legacy resolver use `customAPIFormat` directly. `forceProxyAsOpenAI` has no reader outside storage schema, settings ownership, translations, and server allowlists. The saved boolean cannot influence model info, provider selection, request body, headers, or endpoint.

## Underlying cause

This is an orphaned legacy option rather than a failed acknowledgement. The generic setting pipeline was added for a field that had no implemented runtime branch in the retained upstream code, and the newer model-profile/Fastify dispatch layers likewise never incorporated it.

Because the visible control and server setting are both valid booleans, the command succeeds and every client converges on the inert value. The actual format remains independently owned by `customAPIFormat`/profile metadata.

## Affected data flow

1. **UI:** the checkbox optimistically updates `database.forceProxyAsOpenAI`.
2. **Request:** the settings bridge sends `PATCH /api/v1/commands/settings/advanced`.
3. **Persistence/response:** Fastify validates and stores the value, emits `settings.updated`, and acknowledges it; the UI remains checked.
4. **Model resolution:** the reverse-proxy model is resolved with `format = customAPIFormat` in both profile-aware and legacy Fastify paths.
5. **Provider dispatch:** Fastify chooses/builds the request from that resolved format. The accepted force setting is never consulted.
6. **Displayed/runtime result:** the setting looks saved while wire traffic remains identical in both states.

## Severity and user impact

**Medium.** A format mismatch can make a reverse proxy reject every generation or interpret the body incorrectly. Users may enable the explicit compatibility option as a recovery measure, see it persist, and still receive the same failures with no indication that the field is inert. The working `customAPIFormat` control provides another way to select OpenAI format, and this redundant flag was already inert in the retained upstream implementation, which limits the migration-specific impact.

## Recommended fix

Either implement the override at the single canonical model-info boundary or remove the setting. If retained, resolve reverse-proxy format as OpenAI-compatible when the flag is true before deriving provider, endpoint, body, and profile capabilities. Define precedence clearly against durable profile format so a global legacy checkbox cannot silently override an explicitly configured unrelated profile.

A safer migration is to convert an enabled legacy flag into the reverse proxy's explicit `customAPIFormat = OpenAICompatible` once, then retire the redundant boolean. That leaves one source of truth and avoids cross-client disagreement about precedence.

Add resolver and Fastify wire tests covering the force flag with each supported non-OpenAI configured format, plus a durable-profile precedence case. Assert request URL, headers, and body—not only the stored setting.
