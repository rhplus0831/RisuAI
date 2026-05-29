# Client-Owned, Legacy, And Unsupported Behavior

Date: 2026-05-29

This file separates three things that are easy to conflate: behavior that stays
in the browser **on purpose** (keep), behavior that is **legacy** (remove from
the client), and provider shapes that are **unsupported** (fail explicitly).

## Client-Owned — Keep In The Browser (B1)

The server cannot or should not do these; leaving them in the browser does not
make the browser own durable state. They are no-port by nature:

- Rendering, layout, local selection, modals, drafts, keyboard shortcuts, and
  other UI-only / transient interaction state.
- Browser route/navigation state.
- **Notification** (Web/OS Notification API) — the server may *signal* "notify";
  the API call is the browser's.
- **TTS playback** — already the correct split: the server emits a `tts`
  side-effect event, the browser plays it via Web Audio.
- **Automatic image-generation call** (`stableDiff`) and **inlay-screen
  rendering** — media/rendering concern. Only the resulting asset *reference*, if
  persisted, must be command-backed.
- **Emotion selection → `CharEmotion` store** — a transient in-memory store, not
  `DBState.db`.
- **HypaV3 progress UI** — a transient projection of a server job's progress.
- **Input plumbing** — slash-command text, file-inlay insertion, say-nothing
  rows, reroll trimming, abort wiring. The resulting message rows persist via
  commands. (The *script* parts of input handling — input triggers, `editinput`
  scripts — belong to blocker A1, not here.)
- **Plugin runtime execution** — server commands own plugin records and storage,
  not arbitrary plugin code execution.

Acceptable-but-optimizable browser responsibilities (B2) — kept for now, see
[`status/client-owned-unsupported.md`](status/client-owned-unsupported.md):
auto-continue/resend recursion, result/scriptstate persistence via command
replay, and stage-timing metadata.

## Legacy — Remove From The Client (No-Port)

Do not port these to the server, and do not keep them usable in the browser.

- **Group chat** (reclassified 2026-05-29 — fully legacy, not merely
  "unsupported under server assembly"). It must not remain usable from the client.
  - **Why:** the server chat route has no group/member model; group chat is a
    pre-Fastify multi-character flow outside the supported single-character chat
    process. Keeping it as a browser-only path would preserve a durable-state
    path the server cannot own.
  - **Removal item (separate from thinning; a code change, not done yet):**
    inventory and remove the group surface — the `chatProcessIndex` group-member
    recursion in `sendChat` (`src/ts/process/index.svelte.ts`, recursion calls
    around the post-generation tail), the `isGroupChat` flag (type in
    `src/ts/process/request/request.ts`, hardcoded `false` in
    `src/ts/process/dispatch/dispatchRequest.ts`), group character/message-type
    handling (`src/ts/util.ts` group/groupEnd/divider rows), and any UI entry
    points for creating/selecting group chats. A dedicated task must map the full
    surface before removal.
- Native/mobile wrapper runtime modes; browser local persistence as the primary
  runtime; Tauri, Hono, Express, service-worker persistence, or alternative
  servers.
- Peer sync, Google Drive sync, Risu Account Sync.
- SupaMemory, Hypa V2, Hanurai, and removed browser-local memory engines.
- Server-side plugin code execution.
- Per-event surgical projection patching without a separate event contract (the
  current command events are invalidation signals; see
  [`status/server-projection.md`](status/server-projection.md)).

## Unsupported Provider Shapes (Fail Explicitly)

Fastify mode must not silently fall back to browser provider dispatch.
Unsupported provider shapes (NovelAI, NovelList, Ooba, Plugin, WebLLM,
reverse-proxy-Ooba, non-vanilla OpenAI-compat, etc.) fail explicitly through
`resolveServerCompletionRoute()` (`no-retry`). Provider expansion needs one named
route contract, request shape, credential boundary, response extraction rule,
warning/error behavior, and tests.

## Unsupported Prompt-Assembly Content (Fail Explicitly)

Content classes the server `/generate/chat` assembler cannot reproduce hard-fail
through `resolveServerPromptAssembly` rather than assemble a silently-wrong
prompt. As content slices land, each class either graduates to `server` or is
documented here.

- **Non-vision image caption (slice 3a, class 2)** — when the model lacks
  `LLMFlags.hasImageInput`, the local assembler replaces an image with a
  `runImageEmbedding` text caption (`transformers.ts`, a browser-only
  WASM/WebGPU ML pipeline). There is no server equivalent, so any image / asset /
  inlay content on a non-vision model routes `unsupported`. The
  captionless-prompt alternative (assemble without the caption as a documented
  behavior difference) was **rejected** — a silently captionless prompt is a
  worse failure mode than an explicit one. Image-input models assemble the
  multimodal bytes server-side at byte-parity (slice 3a, class 1).
- Image-gen view instruction (slice 3c) and Lua / plugin-V2 scripts (slice 3b)
  still route `unsupported` until their slices land.

## Deferred / Separate

- Manual legacy local-client verification is separate from Fastify projection
  hardening.
- Audit-rule hardening (the shallow rules) is tracked in
  [`status/audit.md`](status/audit.md).
