# Slice 3a: A1 content — multimodal / asset inlining

Date: 2026-05-29

| | |
| --- | --- |
| **Work-order item** | 3 (A1 content classes), batch **a** |
| **Blocker** | A1 (content parity) — class 1 (+ the class-2 caption decision) |
| **Depends on** | **slice 1** (the classifier exists to flip) |
| **Reference** | [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md) §`history.ts` + [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md) classes 1–2 |
| **Goal** | Port image/asset inlining to the server assembler (populate the `AssetLookup` seam, retire the hardcoded `NO_ASSETS`) so asset-bearing sends become server-mandatory instead of `unsupported`. |

## Outcome

- The server `/generate/chat` assembler resolves inlay ids and asset names to
  `MultiModal` bytes — image/asset prompts keep their bytes instead of being
  stripped.
- The classifier's **multimodal/asset** detector (slice 1, step 7) flips from
  `→ unsupported` to `→ server`. Asset sends now assemble on the server with
  byte-parity to the browser; they never fall back to local.
- The **non-vision caption** sub-case (class 2) is handled explicitly: either
  `unsupported` or a documented captionless behavior difference — never silent.

## Preconditions

- [ ] Slice 1 landed: `resolveServerPromptAssembly` exists and currently routes
      asset content to `unsupported`.
- [ ] `pnpm api:test` and the serverBacked sweep are green.

## Step-by-step

### Orient

1. Read the server gap: [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
   §`prompt/history.ts`. `NO_ASSETS` (`history.ts:118`) is an empty `AssetLookup`;
   it is the default 5th arg of `buildHistoryWindow` (`history.ts:392`) and the
   **only** caller passes it hardcoded (`assemble.ts:736`). The seam
   (`history.ts:109-116`) has three resolvers: `getInlay(id)`, `getAsset(name)`,
   `getCharIcon()`. `processInlays` (`history.ts:218-247`) and
   `processAssetPrompts` (`:249-269`) call them but get `undefined`, so bytes drop.
2. Read the browser side: [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md)
   class 1 — `formatHistoryMessage.ts:73-193` does the inlining: inlay bytes via
   `getInlayAsset` ← localForage `inlayStorage` (`inlays.ts:163`, already
   base64); asset bytes via `readImage` over `additionalAssets` + module assets;
   the `icon` special case reads `currentChar.image`. Marker tokens:
   `{{inlay::}}`/`{{inlayed::}}`/`{{inlayeddata::}}` and
   `{{asset_prompt::…}}`/`{{assetprompt::…}}`.
3. Note the request seam already half-exists but is dead: `ServerChatInput.inlayAssets`
   (`serverChat.ts`) and `ChatRequestBody.inlayAssets` (`generationChat.ts:35`,
   validated `:105-107`, mapped `:163`) are **accepted but dropped** — the
   assembler never reads `state.input.inlayAssets`.

### Decide — where the bytes come from

4. Resolve the byte-source split before coding (this is the crux of the slice):
   - **Inlay bytes** live in the browser's localForage `inlayStorage` (IndexedDB);
     the **server has no copy**. → the **client must send them** in
     `inlayAssets` (finally populating that field), and the server `getInlay`
     resolves from the request payload.
   - **Asset bytes** (`additionalAssets`, module assets, char `icon`) live in the
     **server assets store** (`data/assets/`). → the server `getAsset`/`getCharIcon`
     resolve from its own store; the client need not send these.
   Write this split down; it decides which resolver reads the request vs the
   store.

### Implement — server

5. Build a non-empty `AssetLookup` in the route layer
   (`generationChat.ts` — `RouteAssembleDeps`, `:174-176`): `getInlay(id)` reads
   the validated request `inlayAssets`; `getAsset(name)` / `getCharIcon()` read
   the server assets store. Thread it to the assembler.
6. Pass the lookup as the 5th arg to `buildHistoryWindow` **instead of**
   `NO_ASSETS` (replace at `assemble.ts:736`). Wire it through `AssembleDeps` /
   the route deps seam rather than a module global.
7. Keep parity with the browser's marker handling: `processInlays` strips
   `{{inlay…}}` and pushes a `MultiModal`; `processAssetPrompts` handles
   `{{asset_prompt::…}}` + the `icon` case. The shapes already exist server-side;
   they were just starved of data.

### Implement — client

8. Populate `ServerChatInput.inlayAssets` in `serverBackedSendChat.ts` (built at
   `:147-157`) from the send's inlay markers / `message[].multimodals`: resolve
   the inlay bytes browser-side (the same `getInlayAsset` / `inlayStorage` path)
   and attach them so the server `getInlay` can return them. **This is net-new
   plumbing** — today nothing populates `inlayAssets`.

### Implement — flip the classifier

9. In `resolveServerPromptAssembly` (slice 1), flip the **multimodal/asset**
   predicate from contributing to `unsupported` to allowed — i.e. an asset send
   is now in the `server` subset. Leave the image-gen and Lua/plugin predicates
   untouched (slices 3c/3b).

### Decide & implement — class 2 (non-vision caption)

10. `runImageEmbedding` (`transformers.ts:111`) is a **browser-only** ML pipeline
    (`@huggingface/transformers`, model fetched at runtime). There is no server
    equivalent. When the model lacks `LLMFlags.hasImageInput` **and** the send has
    images, choose one and document it:
    - **Recommended:** classify that specific send `unsupported` (no silent
      captionless prompt). Add it as a predicate in the classifier.
    - Alternative: accept a captionless prompt as a documented behavior
      difference. If chosen, it must be written down in
      [`../../unsupported-and-client-owned.md`](../../unsupported-and-client-owned.md).

### Prove

11. Add a **parity fixture** with multimodal/asset content to
    `sendChat.fixtures.serverBacked.test.ts` Describe B's `ROUTE_BACKED_CHAT_FIXTURES`
    (`:165`); assert the server-assembled prompt matches the local golden
    (byte-parity, including the inlay `MultiModal` parts), and `providerCalls`
    on the browser side stays `[]`.
12. Update the **classifier test** (slice 1): the asset case now asserts `server`,
    not `unsupported`; add the class-2 non-vision case asserting whatever step 10
    decided.
13. Update **`generation.chat.test.ts`** so the server assembler with a bound
    `AssetLookup` emits the inlay/asset bytes (a new server-side assertion that
    `processInlays`/`processAssetPrompts` actually pushed `multimodals`).

### Land

14. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
15. Update docs: flip the **Multimodal / inlay asset bytes** row in the
    [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    parity matrix from GAP to AT PARITY; update class 1 in
    [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md);
    update [`../../status/sendchat-thinning.md`](../../status/sendchat-thinning.md).

## Scope guard

Only multimodal/asset inlining (+ the class-2 caption decision). Do **not** port
the image-gen instruction (slice 3c) or Lua/plugin scripts (slice 3b) here — they
keep routing `unsupported`. Do not touch persistence (slice 2/4).

## When this slice is done

- [ ] A non-empty `AssetLookup` is bound in the route and passed to
      `buildHistoryWindow`; `NO_ASSETS` is no longer the live path for real sends.
- [ ] The client populates `inlayAssets` with the inlay bytes the server lacks.
- [ ] The classifier routes asset sends to `server`; the non-vision caption case
      has an explicit, documented disposition.
- [ ] A byte-parity asset fixture is green; the parity matrix row is flipped.
