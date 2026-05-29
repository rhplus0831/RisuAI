# Client-Owned, Legacy, And No-Port

Date: 2026-05-29

Detail shard for what stays in the browser, what is legacy, and what is no-port.
The canonical statement is
[`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md); this
shard adds the chat-process specifics.

## B1 — Permanent Client-Owned (keep)

The server cannot do these; keeping them in the browser does not make the browser
own durable state:

- Rendering, UI/selection/navigation/transient interaction state.
- Notification (Web/OS API) — server may signal "notify".
- TTS playback — server emits the `tts` side-effect, browser plays.
- Automatic image-generation call + inlay-screen rendering (only a persisted
  asset reference must be command-backed).
- Emotion selection → transient `CharEmotion` store (not `DBState.db`).
- HypaV3 progress UI (transient projection of a server job).
- Input plumbing (slash text, file-inlay insertion, say-nothing rows, reroll
  trim, abort). The script parts of input handling belong to blocker A1.
- Plugin runtime execution.

## B2 — Acceptable, Browser Orchestrates Or Requests (optimizable, not a bug)

- **Auto-continue / resend recursion** — control flow; each iteration's durable
  writes go server-side, so the loop is just re-issuing `sendChat`.
- **Final-message persistence via command** — `dispatchPersistGenerationResult`.
  Requesting a validated, guarded, revision-checked write is a thin pattern.
  Optional later win: route-direct final-result persistence closes a small
  durability window (crash between generation and command) and saves a round-trip.
  Assembly-time scriptstate replay is gone; `/generate/chat` owns that write.
- **Stage-timing metadata** — browser-measured wall-clock telemetry, persisted via
  command.

These are not blockers and not violations; they are candidates for later
tightening, not correctness fixes.

## Legacy — Remove From The Client

- **Group chat** — fully legacy as of 2026-05-29. Not "unsupported under server
  assembly": it must not remain usable from the client. Removal is a separate
  task; code surface and rationale are in
  [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).
- The historical no-port list (native/mobile, Tauri/Hono/Express, service workers,
  peer/Drive/Account sync, legacy memory/sync surfaces outside this thinning
  plan, server-side plugin execution, per-event surgical patching without an
  event contract).

## Unsupported (Fail Explicitly)

Unsupported provider shapes fail through `resolveServerCompletionRoute()` with no
browser fallback. This is a support cap (blocker A3), not a thinness leak.

## Rule Of Thumb

If the behavior decides or derives durable state, it needs a server-owned path and
proof. If it only triggers an effect, holds transient state, orchestrates, or
requests a validated write, it may stay in the browser — document why. If it is
legacy, remove it from the client.
