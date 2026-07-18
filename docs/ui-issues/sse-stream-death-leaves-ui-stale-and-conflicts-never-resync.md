# SSE stream death leaves the UI stale, and conflicts never trigger a resync

## Summary

The invalidation stream reconnects only when the reader errors or closes
cleanly. A TCP stream silently killed by laptop sleep, mobile background-kill,
or NAT timeout produces neither, so the client believes it is subscribed while
foreign writes (other devices/tabs, server-side translation/memory/durable
generation jobs) accumulate unseen. The server's 25-second heartbeat comments
are parsed and discarded without being timestamped, so there is no liveness
watchdog, and neither visibility-resume nor a revision-conflict response —
direct evidence of a gap — triggers a refresh or resubscription.

## Location

- `src/ts/server/events.ts:118-152` — the frame pump; reconnect only via
  reader error or clean `done`.
- `src/ts/bootstrap.ts:367-435` — `startServerResourceEvents` /
  `scheduleServerResourceReconnect`; all triggers are error/close-driven.
- `server/fastify/src/routes/events.ts:144-158` — the server emits 25 s
  heartbeat comments; the client parses and discards them (no `lastFrame`
  tracking anywhere — verified by grep).
- `src/ts/server/commands.ts:5498-5504` — a 409 conflict stores
  `currentRevision` in the cached command-revision cursor and returns
  `conflict`; it triggers no refresh or reconnect.
- `src/ts/server/bridgeFlush.ts:23-50` — the only `visibilitychange` handler
  is the hidden-flush; there is no visible-resume health check and no
  `online` listener (verified by grep).

## Trigger

Sleep the laptop / background the mobile tab / sit behind an aggressive NAT
until the SSE TCP stream dies without an error. Have another device, tab, or a
server-side job (message translation, memory job, durable generation
persistence — all delivered via SSE frames only) write revisions R+1..R+n.
Then interact.

## Expected behavior

The client notices missed heartbeats (or checks on visibility resume) and
resubscribes/refreshes from `appliedRevision`; at minimum, a 409 whose
`currentRevision` exceeds the applied cursor while no events are arriving
forces a refresh.

## Actual behavior

The UI stays stale indefinitely. The user's next command 409s; the handler
records the revision and rolls the edit back with an error — and a retry then
*succeeds* against a base revision the client never applied, blind-writing over
unseen foreign state. Nothing ever prompts `forceServerResourceRefresh` or an
SSE resubscription.

## Underlying cause

No client-side inter-frame watchdog (heartbeats are consumed as no-op frames
and never timestamped); no visibility/online recovery hooks; the conflict path
treats a 409 purely as a cursor update rather than gap evidence.

## Affected data flow

1. **Network:** stream dies silently → no `onError`/`onClose` → no reconnect.
2. **Server:** foreign writes advance revisions; events go nowhere.
3. **UI:** renders stale data indefinitely.
4. **User edit:** 409 → rollback with error (or blind-success retry).
5. **Displayed state:** still stale; foreign changes and job results never
   appear.

## Severity and likely user impact

**Medium** (high for multi-device users and server-side job results;
single-tab own-command reconciliation is response-driven and unaffected).
Matches the reported symptom "the underlying data is updated successfully, but
the UI continues to display stale data."

## Recommended fix

Record the last-frame time in the pump (including heartbeat comment frames —
surface them from `iterateSseEvents`) and arm a ~60 s watchdog that tears down
the reader and calls `scheduleServerResourceReconnect`. On
`visibilitychange → visible` and `online`, ping/resubscribe. On a 409 whose
`currentRevision > peekAppliedServerResourceRevision()` while no events are
flowing, enqueue `forceServerResourceRefresh('conflict-gap')`.

## Test gap

Pump test: feed heartbeat frames then stop the stream without closing it;
assert the watchdog reconnects. Command test: return a 409 with
`currentRevision` ahead of the applied cursor and assert a refresh is
scheduled.
