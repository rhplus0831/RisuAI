# Request-data inspector metadata follows the live message index

## Summary

The per-message "request data" inspector captures the message's array index at
open time and derives its metadata tab from the live transcript at that index.
If message indices shift while the modal is open, the metadata tab silently
switches to describing a different message, while the tokens/log tabs keep
describing the original generation — one modal, two messages.

## Location

- `src/ts/alert.ts:701-707` — `alertRequestData(info)` stores
  `AlertGenerationInfoStoreData` (which carries `idx`) and opens the modal.
- `src/lib/Others/AlertComp.svelte:72-79` — `generationMessage` is
  `$derived.by(() => chat?.message?.[info.idx])` against the live chat.
- `src/lib/Others/AlertComp.svelte:685-733` — the metadata tab (`ID`,
  `Saying`, `Size`, `Time`, `Tokens`) renders from that live-index lookup,
  while the token/log tabs render from the captured `genInfo`.

## Trigger

Open a message's request-data inspector, then let background state shift
message indices while it is open: a durable-generation SSE delivering a new
message, another device deleting/inserting messages, or first-message rows
shifting.

## Expected behavior

The inspector keeps describing the message whose info button was clicked (its
generation id is known), or states that the message is no longer present.

## Actual behavior

The metadata tab re-derives from the live array at the stale captured index
and describes a different message; the tokens/log tabs still describe the
original generation.

## Underlying cause

`alertGenerationInfoStore` captures a positional `idx` instead of the
message's stable `chatId`; the derived lookup re-runs against live data with
no identity check.

## Affected data flow

1. Info icon → `alertRequestData({genInfo, idx})`.
2. Background invalidation reorders `chat.message`.
3. `generationMessage` derived re-evaluates by index → wrong row displayed in
   the metadata tab.

## Severity and likely user impact

**Low.** Inspector-only inconsistency (symptom class 5); no persistence is
affected, but it is misleading exactly when a user is debugging generation
behavior.

## Recommended fix

Capture the message's stable `chatId` in the store and locate the row by id
(falling back to a generation-id match), showing a "message no longer
present" state when it is gone.

## Test gap

A test opening the inspector for index N, inserting a message before N, and
asserting the metadata tab still describes the original message.
