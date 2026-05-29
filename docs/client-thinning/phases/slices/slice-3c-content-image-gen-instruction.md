# Slice 3c: A1 content — image-gen instruction

Date: 2026-05-30

| | |
| --- | --- |
| **Work-order item** | 3 (A1 content classes), batch **c** |
| **Blocker** | A1 (content parity) — class 3 |
| **Depends on** | **slice 1** (the classifier exists to flip) |
| **Reference** | [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md) class 3 + [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md) |
| **Goal** | Port `buildInlayViewInstruction` (the `newGenData`/`viewScreen` system row) to the server assembler so image-gen-instruction sends become server-mandatory. This is the **smallest** content port — static character fields only, no VM, no asset bytes. |
| **Status** | **DONE** in commit `aea3db46`. |

## Outcome

- The server `/generate/chat` assembler appends the same image-gen instruction
  `system` row the browser does, derived from static character config.
- The classifier's **image-gen** detector (slice 1, step 7) flips from
  `→ unsupported` to `→ server`.
- The actual image generation + inlay-screen rendering is untouched — it stays a
  post-gen **browser** effect (B1). Only the *instruction text* moves.

## Historical Preconditions

- [x] Slice 1 landed; before this slice, image-gen-instruction sends routed
      `unsupported`.
- [x] `pnpm api:test` + serverBacked sweep green.

> **Status: DONE (2026-05-30).** `buildInlayViewInstruction` is ported into
> `server/fastify/src/prompt/staticSections.ts` and wired into
> `assemble.ts::fillStaticSlots` (appended to `postEverything` after the
> chain-of-thought row); the classifier's `charHasImageGenInstruction` predicate
> is deleted so `inlayViewScreen` routes `server`. Parity is proven by the
> `image-gen-emotion` / `image-gen-imggen` fixtures (local golden + serverBacked
> byte-parity in `sendChat.fixtures.serverBacked.test.ts` Describe B), the server
> `staticSections.test.ts` unit cases, the `generation.chat.test.ts` row
> assertions, and the flipped classifier case.

## Historical Step-by-step

The checklist below records the route shape and implementation path before
slice 3c landed. Current behavior is summarized in the Outcome.

### Orient

1. Read class 3 in [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md).
   The browser calls `buildInlayViewInstruction(currentChar)`
   (`promptAssembly/buildStaticPromptSections.ts:47`) and pushes the result into
   `unformated.postEverything` at `sendChatPromptAssembly.ts:114`.
2. Note the inputs are **all static character fields** (no bytes, no VM):
   - gated by `currentChar.inlayViewScreen`;
   - `viewScreen === 'emotion'` → `newGenData.emotionInstructions`, with `{{slot}}`
     replaced by the comma-joined `emotionImages` names;
   - `viewScreen === 'imggen'` → `newGenData.instructions`.
3. Historical gap: before slice 3c there was no `buildInlayViewInstruction` /
   `newGenData` reference under `server/fastify/src/prompt/`, so the instruction
   row was absent server-side.

### Implement — server

4. Port the `buildInlayViewInstruction` logic into the server assembler's
   static-section assembly. The natural home is alongside the other plain/static
   builders (`prompt/staticSections.ts` / `prompt/plainSections.ts`); it appends a
   `system` row to the equivalent of `postEverything` in the assemble chain
   (`assemble.ts` `assemblePrompt` slices — the `fillStaticSlots` /
   post-everything stage). Match the browser's gating and `{{slot}}` substitution
   exactly so the rendered row is byte-identical.
5. The character config (`inlayViewScreen`, `viewScreen`, `newGenData.*`,
   `emotionImages`) is already on the server's loaded `Database`/character — no
   new request field is needed (unlike 3a). Read it from the assembled scope.

### Implement — flip the classifier

6. In `resolveServerPromptAssembly` (slice 1), flip the **image-gen** predicate
   from contributing to `unsupported` to allowed. Leave the multimodal/asset
   (3a) and Lua/plugin (3b) predicates as they are.

### Prove

7. Add a **parity fixture** to `sendChat.fixtures.serverBacked.test.ts`
   Describe B for a character with `inlayViewScreen` set (one `emotion`, one
   `imggen`); assert the server-assembled prompt's instruction row matches the
   local golden, including the `{{slot}}` → `emotionImages` substitution.
8. Update the **classifier test** (slice 1): the image-gen case now asserts
   `server`, not `unsupported`.
9. Add/confirm a `generation.chat.test.ts` assertion that the server emits the
   instruction row for an image-gen character.

### Land

10. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
11. Update docs: note the image-gen instruction is now at parity in
    [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    and update class 3 in
    [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md)
    and [`../../status/sendchat-thinning.md`](../../status/sendchat-thinning.md).

## Scope guard

Only the **instruction text**. Do **not** touch the post-gen image generation,
the stable-diffusion call, or inlay-screen rendering — those are B1 browser
effects (`runStage4.ts:112-114`, `src/ts/process/inlayScreen.ts`) and stay
browser-side. Do not port multimodal bytes (3a) or scripts (3b) here.

## When this slice is done

- [x] The server assembler appends the `newGenData`/`viewScreen` instruction row
      with byte-parity to the browser (incl. `{{slot}}` substitution).
- [x] The classifier routes image-gen-instruction sends to `server`.
- [x] A parity fixture is green; the B1 image generation/rendering is untouched.
