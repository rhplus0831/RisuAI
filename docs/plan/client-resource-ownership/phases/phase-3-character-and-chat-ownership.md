# Phase 3: Character And Chat Ownership

Status: dependency-blocked.

Depends on: Phase 1 owner APIs and matching Workstream 1/2 contract/owner
releases.

## Objective

Move character summaries/details, selection/order, chat metadata, messages, and
transcript consumers to explicit owners without weakening lazy hydration or
generation fencing.

## Required Work

- Separate character summaries, selected detail, order/selection, chat metadata,
  and transcript/message bodies in consumer APIs.
- Migrate UI, navigation, generation setup, export, drafts, and runtime observers
  by explicit requirement.
- Preserve placeholder/lazy message bodies, chat suffix hydration, generation
  target fences, composer drafts, reroll alternates, selected-target races, and
  stale response rejection.
- Preserve narrow message commands, outbox size limits, optimistic local effects,
  rollback/destructive-refresh fences, and reload/reattach behavior.
- Remove character/chat bridges only after complete browser continuity proof.

## Safety Contract

No aggregate character/chat payload replaces targeted/lazy owners. Transcript
mutation, generation persistence, receipts, revisions/events, and authoritative
recovery remain unchanged.

## Exit Criteria

- Character/chat UI and generation setup use explicit owners end to end.
- No character/chat aggregate consumer or bridge fallback remains.
- Navigation, hydration, drafts, reroll, generation, writer loss, and reload
  smoke pass without payload regression.

## Validation

Character/chat/message owner and command tests, navigation/transcript/generation
frontend lanes, server command/resource/generation lanes, browser smoke for
selection/send/reroll/reload/recovery, measurements, typechecks, formatting, and
diff checks.
