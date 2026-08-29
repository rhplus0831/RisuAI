# Phase 6 — Prompting, Generation, And Streaming

Status: Pending  
Depends on: Phases 1-5

## Objective

Verify model-visible prompt assembly, transcript mutation, generation actions,
stream display, cancellation, failure, retry, reconnect/reattach, and final side
effects end to end.

## Audit Questions

- Do templates, system/user/assistant roles, history, lore, memory, CBS variables,
  scripts, biases, stop data, and provider-ready messages preserve content and
  order?
- Do send, continue, regenerate/reroll, multi-result, and edit-then-generate
  mutate the same logical transcript and metadata?
- Are buffered and streamed paths equivalent at terminal success?
- What persists and renders after cancel, pre-output failure, partial failure,
  reconnect, response loss, restart, stale completion, or target deletion?
- Do finalization effects run exactly once and against the correct message/chat?

## Required Outputs

- Shared semantic fixtures for prompt rows, request-ready messages, transcript
  mutations, stream events, and terminal state.
- Lifecycle state table covering every action and failure/recovery variant.
- Deterministic fault seams for cancel, partial output, stale completion,
  response loss, restart, and reattach.
- Browser journeys proving partial/final display and post-reload state.
- Structural ownership for prompt contributors and finalization effects.

## Exit Criteria

- Model-visible inputs and durable/user-visible outputs match the governing
  obligation for all retained generation actions.
- Buffered/streamed terminal results agree; exception cases are signed.
- Cancellation/failure/recovery cannot mis-target, duplicate, or silently lose
  transcript state or side effects.
- Focused generation, state, browser, provider-contract, and compatibility lanes
  pass.

## Validation

Run deterministic prompt/transcript differential fixtures, in-process stream and
fault tests, built-browser lifecycle journeys, affected and compatibility lanes,
formatting, and `git diff --check`.
