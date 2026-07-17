# Translation input changes leave completed and partial results stale

## Summary

The translation playground snapshots its inputs when a run starts and rejects a late response after those inputs change, but it does not invalidate output when the user changes source text or configuration after a run has completed. Bulk output and failure messages can therefore remain visible under a different source language, destination language, source document, or bulk/context mode. During a bulk run, already-published partial output also remains until the next asynchronous checkpoint rather than clearing when the edit occurs.

## Location

- `src/lib/Playground/PlaygroundTranslation.svelte:14-57,92-167,171-207`
- `src/ts/translator/translator.ts:710-870,1160-1234`
- `src/ts/server/providerOperations.ts:11-64`
- `server/fastify/src/routes/providerOperations.ts:45-83`
- `server/fastify/src/providerOperations.ts:202-236,418-425`
- `src/ts/process/request/request.ts:579-652,832-907`
- `src/ts/process/request/serverCompletion.ts:172-250`
- `server/fastify/src/routes/generation.ts:1264-1297,1300-1318`

## Trigger

1. Translate source text successfully, or complete a bulk run with one or more failed chunks.
2. Change the source text, source language, destination language, Bulk toggle, or Keep Context toggle without starting another run.
3. Observe the output and any failure list.

A second variant is to change one of those inputs after a bulk run has published its first chunk but while a later provider request is still pending.

## Expected behavior

Output, progress, and failures should belong to the exact input/configuration signature that produced them. Changing a request-defining input should immediately clear or mark the prior result stale. An active run should be invalidated or cancelled at the same time.

## Actual behavior

After a completed run, the old output and old failure messages remain indefinitely beneath the new controls. There is no indication that they were produced from different source text or languages.

For an active bulk run, changing an input does not itself execute `abandonStaleRun()`. Already-published chunks remain visible until the pending tokenization or translation promise reaches a later guard. If that request is slow or never settles, stale partial output can remain beside the new input for the same duration.

## Underlying cause

`translate()` builds an `isCurrentRun()` closure from five snapshots and calls `abandonStaleRun()` only after awaited work and at loop boundaries. That protects the final assignment from a response that arrives after an edit, but it is not a reactive invalidation mechanism.

The source and configuration controls write directly to `r`, `sourceLang`, `outputLang`, `bulk`, and `keepContext`. None of their setters clears `output`, `failureMessages`, or `bulkProgressText`, increments a result epoch, or aborts a run. Once `translate()` has returned, no code remains that can compare the displayed result with the changed inputs. This also contradicts the `PLAY-07` reference behavior in `docs/data-driven-ui.md`, which specifies that input/config changes clear stale output.

## Affected data flow

1. **UI interaction:** The user edits the source textarea or language/bulk controls (`PlaygroundTranslation.svelte:171-207`).
2. **Client request state:** Starting a run snapshots all five request-defining values, clears prior state, and calls `runTranslator()` (`PlaygroundTranslation.svelte:29-57`). Bulk mode publishes `formattedOutput()` after each chunk (`PlaygroundTranslation.svelte:110-159`).
3. **Request:** `runTranslator()` splits the submitted text and dispatches according to the configured translator (`translator.ts:710-870`). DeepL and DeepLX use `POST /api/v1/provider-operations`; LLM translation normally reaches `POST /api/v1/generate/completion` through `requestChatData()` and `requestServerCompletion()`. Bergamot and Google branches may run locally or call an upstream service directly.
4. **Server processing:** Fastify validates and proxies DeepL/DeepLX operations, or builds the selected server completion profile and returns the buffered LLM result. The server only knows the submitted snapshot; it cannot observe later browser edits.
5. **Client reconciliation:** While the run is active, late results are checked only when control returns to one of the explicit `abandonStaleRun()` calls. After completion, there is no owner/signature attached to `output` and no reconciliation path at all.
6. **Display:** The output textarea and failure panel render from the unconditionally retained local `output` and `failureMessages`, while the controls render the new live values (`PlaygroundTranslation.svelte:171-207`).

No playground result is durably persisted; this is a request-to-view synchronization defect.

## Severity and user impact

**Medium.** A user can copy a translation or diagnose chunk failures while the screen presents it as belonging to different text or languages. Bulk and LLM requests can be long-running and costly, making delayed invalidation especially confusing and increasing the chance of using the wrong result.

## Recommended fix

- Define a single reactive input signature from source text, both languages, Bulk, and Keep Context.
- Store the signature with every displayed result and clear `output`, `failureMessages`, and progress immediately whenever the live signature changes.
- Give each run an epoch or owner token and check it before every output/failure/progress assignment.
- Add an `AbortController` path through `runTranslator()` and provider requests where supported so an invalidated run does not continue consuming provider work.
- Alternatively disable request-defining controls while a run is active, but still clear a completed result when they later change.

## Test coverage gap

`src/lib/Playground/PlaygroundTranslation.svelte.test.ts` verifies that a response is discarded after an in-flight source/language edit, but it does not change inputs after a successful or partially failed run. Add tests that complete a run, edit each request-defining control, and assert immediate result/failure invalidation. Add a deferred second bulk chunk test that verifies already-published output clears before the deferred promise settles.
