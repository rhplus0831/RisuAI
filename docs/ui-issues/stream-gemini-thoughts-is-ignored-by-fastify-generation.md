# Stream Gemini Thoughts is ignored by Fastify generation

## Summary

Bot Settings displays **Stream Gemini Thoughts** when streaming is enabled for a Gemini thinking model. Its server-backed draft persists `streamGeminiThoughts` and stays synchronized, but normal Gemini generation never reads the setting.

The only conditional thought-stream shaping remains in the browser Google provider implementation. Chat and completion requests now dispatch Gemini through Fastify, whose request type has no corresponding field and whose stream extractor emits every thought part immediately inside `<Thoughts>` markers. Checked and unchecked therefore produce the same Fastify stream.

## Location

- Server-backed draft and conditional control: `src/lib/Setting/Pages/BotSettings.svelte:201-202,1600-1606`
- Settings group: `src/ts/server/settingsGroups.ts:300`
- Fastify allowlist/type validation and persistence: `server/fastify/src/routes/commands.ts:1151-1154,1526,1844-1907`
- Remaining browser consumer: `src/ts/process/request/google.ts:1331-1348`
- Mandatory Fastify completion route: `src/ts/process/request/request.ts:897-906`; `src/ts/process/request/serverCompletion.ts:13-28`
- Server-owned chat route: `src/ts/process/serverBackedSendChat.ts:313-316`; `src/ts/process/request/serverChat.ts:232-270`
- Gemini server dispatch without the setting: `server/fastify/src/prompt/chatDispatch.ts:1206-1227`
- Gemini request type and payload: `server/fastify/src/generation/gemini.ts:28-53,66-82,235-254`
- Unconditional Fastify thought extraction/streaming: `server/fastify/src/generation/gemini.ts:362-395,585-657`
- Pre-migration live consumer: `/home/codex/Risuai/src/ts/process/request/google.ts:1303-1318`

## Trigger

1. Select a Gemini thinking model and enable response streaming.
2. Send a prompt that produces thought parts with **Stream Gemini Thoughts** off.
3. Turn the option on and send an equivalent prompt.
4. Compare token frames and the in-progress chat display.

Both requests stream thought parts using the same Fastify extraction logic. The only code that formats the in-progress value differently based on the boolean is never reached by normal production dispatch.

## Expected behavior

The option should change how Gemini thought content appears during an active stream, matching the retained behavior: enabled exposes the current thought incrementally in the streaming projection, while disabled keeps thought content in the normal `<Thoughts>`-wrapped representation. The final persisted response should remain valid and consistent in either mode.

## Actual behavior

Fastify's `chatDispatch` creates a `GeminiRequest` from model, messages, sampling/thinking parameters, tools, and the abort signal. It does not pass `streamGeminiThoughts`; the request and resolver types cannot carry it.

`runGeminiStream` calls `extractText` for every SSE event. When it sees a `thought: true` part it opens a `<Thoughts>` marker, appends the text, and immediately yields the resulting token frame. This fixed policy runs regardless of the stored boolean. The legacy browser branch that checks the setting sits behind provider dispatch that normal chat/completion routing no longer reaches.

## Underlying cause

Gemini provider execution and stream parsing moved from `src/ts/process/request/google.ts` to `server/fastify/src/generation/gemini.ts`, but this display-affecting provider option moved only through the generic settings persistence schema. No field was added to the server dispatch configuration and no server/client post-processing step observes it.

Because the checkbox itself uses a normal server-backed setting draft, successful persistence and authoritative projection make the missing runtime behavior look like an intermittent display problem rather than a disconnected feature.

## Affected data flow

1. **UI interaction:** `BotSettings` binds the checkbox to `createServerBackedSettingDraft('streamGeminiThoughts')`.
2. **Client state and request:** the draft changes the local settings projection and sends a runtime-group settings PATCH.
3. **Server persistence:** Fastify validates and stores the boolean in SQLite, emits `settings.updated`, and acknowledges it.
4. **Displayed setting:** reconciliation keeps the checkbox correct after reload and across clients.
5. **Generation request:** normal chat uses `/api/v1/generate/chat`; auxiliary completion uses `/api/v1/generate/completion`. Both select the Fastify Gemini adapter.
6. **Server response:** Gemini SSE thought parts are converted to token frames by a fixed extractor with no setting input.
7. **Chat display:** the client renders the received stream; since both checkbox states receive the same token sequence, the visible in-progress thought behavior does not change.

## Severity and user impact

**Medium.** The generated final text is not necessarily lost, but users cannot control whether sensitive, noisy, or distracting reasoning text is exposed incrementally as promised. Long thinking responses can significantly affect the live transcript experience, and the stored checkbox falsely indicates the choice was honored.

## Recommended fix

Define the option's semantics at the server/client stream boundary and implement them in one owner. One approach is to pass an authoritative `streamGeminiThoughts` flag from the server database into `dispatchChatProvider`/`GeminiRequest`, then make `runGeminiStream` buffer or shape thought frames according to that flag while still returning a canonical final response. Another is to emit typed `thought_delta` and `text_delta` frames and let the client decide what to reveal live, which cleanly separates provider parsing from presentation.

Whichever approach is chosen, do not trust a request-body boolean in place of the authoritative setting, and ensure durable job reattachment replays the same accepted policy. Add Gemini SSE tests containing multiple partial thought frames, transitions from thought to answer text, tool rounds, aborts, and reattachment with the setting on and off. If the fixed Fastify behavior is intentional, remove the checkbox and migrate the stored flag.
