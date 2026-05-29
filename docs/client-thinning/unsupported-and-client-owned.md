# Client-Owned, Legacy, And Unsupported Behavior

Date: 2026-05-30

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
  commands. Non-interactive submit-time input-trigger/`editinput` now belongs to
  the server prompt-assembly path; interactive Lua dialogs stay explicit
  `unsupported`.
- **Plugin runtime execution** — server commands own plugin records and storage,
  not arbitrary plugin code execution.

Acceptable-but-optimizable browser responsibilities (B2) — kept for now, see
[`status/client-owned-unsupported.md`](status/client-owned-unsupported.md):
auto-continue/resend recursion, final-message persistence via command, and
stage-timing metadata. Assembly-time scriptstate persistence is no longer a B2
browser replay; `/generate/chat` owns it.

## Legacy — Remove From The Client (No-Port)

Do not port these to the server, and do not keep them usable in the browser.

- **Group chat** (reclassified 2026-05-29 — fully legacy, not merely
  "unsupported under server assembly"). It must not remain usable from the client.
  - **Why:** the server chat route has no group/member model; group chat is a
    pre-Fastify multi-character flow outside the supported single-character chat
    process. Keeping it as a browser-only path would preserve a durable-state
    path the server cannot own.
  - **Removal item (separate from thinning) — UI branches DONE 2026-05-30:** the
    dead `type === 'group'` UI branches were removed — the `GridCatalog.svelte`
    group icon (the `Users` import and the `formatChars` `type` field went with it)
    and the `ChatList.svelte` new-chat member-seeding block (plus its
    `findCharacterbyId` import). The defense layers stay as before: Fastify data
    loading filters group characters, request dispatch hardcodes
    `isGroupChat: false`, and server prompt assembly explicitly rejects a group
    character; `chatProcessIndex` is reentrancy/preset-chain state, not the group
    surface. Group references still present in unrelated surfaces — the dead
    `removeFromGroup` lang key, the `cbs.ts` `{{char}}` description, and the
    `risuai.d.ts` "and group chats" comment — are **decided 2026-05-30 (decision
    #6) to be removed in the final cleanup pass**, not as a standalone task now.
  - **`Message.saying` — decided 2026-05-30 (decision #3): keep, do not force
    removal.** It is still active for single-character transcript attribution and
    prompt/export/lorebook paths, so it is not synonymous with group-chat UI;
    removal stays gated on a designed speaker-attribution replacement. The
    **load-time group filter is likewise decided kept as-is (decision #4)**.
  - **Proof (landed):** the `A4R-group-chat-removed` audit invariant
    (`util/client-thinning-audit.ts`) holds all four together — negative: neither
    `GridCatalog.svelte` nor `ChatList.svelte` compares a character `type` to
    `'group'`; positive: `setDatabase` keeps the load-time `type !== 'group'`
    filter, `serverPromptAssembly` keeps the `type === 'group'` → `unsupported`
    hard-fail, and `dispatchRequest` keeps `isGroupChat: false`. Behavioral proof
    for the two positive layers also lives in `serverPromptAssembly.test.ts` (group
    rejection) and `dispatchRequest.test.ts` (`isGroupChat` is false). The
    standalone behavioral test for the load-time filter was dropped — importing
    `database.svelte` alone under vitest's per-file module isolation trips a
    circular-import TDZ in the stores `moduleUpdate` `$effect` — so the filter's
    proof is the audit invariant plus its execution in every existing
    `setDatabase`-based test.
- Native/mobile wrapper runtime modes; browser local persistence as the primary
  runtime; Tauri, Hono, Express, service-worker persistence, or alternative
  servers.
- Peer sync, Google Drive sync, Risu Account Sync.
- Legacy memory engines/sync surfaces outside this thinning plan. Some
  compatibility or migration hooks may still exist; inventory them in a dedicated
  removal/migration task rather than porting them here.
- Server-side plugin code execution.
- Per-event surgical projection patching without a separate event contract (the
  current command events are invalidation signals; see
  [`status/server-projection.md`](status/server-projection.md)).

## Unsupported Provider Shapes (Fail Explicitly)

Fastify mode must not silently fall back to browser provider dispatch.
Unsupported provider shapes fail explicitly through `resolveServerCompletionRoute()`
on the completion path (`no-retry`) and through `prompt/chatDispatch.ts` on the
`/generate/chat` path. The current supported and unsupported sets are the resolver
tables in source; do not keep a stale prose list as truth. Provider expansion
needs one named route contract, request shape, credential boundary, response
extraction rule, warning/error behavior, and tests. As of 2026-05-30, `/chat`
still explicitly rejects NovelAI/NovelList, plugin providers, WebLLM, Ooba
OpenAI-compatible chat/reverse-proxy shapes, and unknown OpenAI-compatible models.

The two resolvers' supported sets are not identical today — the known divergence is
`reverse_proxy` + `reverseProxyOobaMode`, which `resolveServerCompletionRoute`
accepts (routes to `openai` with `oobaSystemHoist`) but `chatDispatch.ts` rejects.
**Decided 2026-05-30 (decision #5): unify both resolvers onto a single shared
provider-capability table** (pending implementation; prerequisite for the
`useServerPromptAssembly` default flip, since the flag-on classifier routes via the
completion resolver then dispatches via `/chat`). See
[`phases/phase-5-closeout.md`](phases/phase-5-closeout.md#closeout-decisions-2026-05-30).

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
- **Plugin (V2) scripts (slice 3b, _permanent_)** — any registered pluginV2 edit /
  replacer hook (`editinput`/`editoutput`/`editprocess`/`editdisplay`/
  `replacerbeforeRequest`/`replacerafterRequest`) routes `unsupported` and **never
  graduates**. Server-side plugin code execution is on the no-port list (see
  "Legacy / removed" below and [`plan.md`](plan.md)) and pluginV2 is superseded by
  Plugin V3. The `serverPromptAssembly` classifier detects it via its own
  `hasPluginV2EditSet` predicate (separate from the Lua arm so the Lua sub-classes
  can flip without disturbing this), and the **`A4R-pluginv2 no server-side plugin
  execution`** audit invariant (`util/client-thinning-audit.ts`) keeps a
  server-side execution path — a plugin-runtime import, a `pluginV2` reference, or
  an `eval`/`new Function` sandbox in `server/fastify/src/prompt/**` — from being
  silently added by a later refactor.
- **Lua scripts (slice 3b, _ported except interactive dialogs_)** — a
  `triggerlua` effect on the character or an enabled module routes `server` for
  the ported Lua `editRequest`, `editprocess`, input-trigger, and `editinput`
  path. Scripts using an interactive dialog API
  (`alertInput`/`alertSelect`/`alertConfirm`) stay `unsupported`; the classifier's
  Lua arm is `luaUsesInteractiveApi` (the only surviving Lua `unsupported` case).
- **Image-gen view instruction (slice 3c)** — ported and routes `server`. The
  automatic image-generation call and inlay-screen rendering stay B1 browser
  effects, listed above.

## Deferred / Separate

- Manual legacy local-client verification is separate from Fastify projection
  hardening.
- Additional audit-rule hardening is conditional on first demonstrating a sincere
  defeat of a remaining shallow rule; the four known defeated rules are already
  hardened. See [`status/audit.md`](status/audit.md).
