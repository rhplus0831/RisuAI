# NovelAI + NovelList stringlize/unstringlize - Deferred Phase 6 Design Memo

Date: 2026-05-23
Status: decision recorded; still local while Phase 7 prompt
assembly is incomplete. Revisit when server-owned prompt
flattening reaches provider-specific stringlize / unstringlize.
Sibling memo: [`ooba-oai-compat.md`](./ooba-oai-compat.md)

## The question

Should the NovelAI and NovelList slices port the SPA's `stringlize`
/ `unstringlize` helpers to the server, or defer them to Phase 7
like Ooba? This memo predates the later Phase 6-19 / 6-20 commits,
which landed Anthropic-format proxy routing and Vertex AI Gemini
instead; NovelAI / NovelList remain deferred by design.

These two providers come up together because they share the
same shape: a flat `{input: <flattened prompt string>}` wire
plus a bespoke sampler block on the request side, and a
`{output|data: <continuation string>}` response that needs to
be reverse-extracted into a clean assistant turn.

## What the local code does

NovelAI: `requestNovelAI` at `src/ts/process/request/request.ts:582-697`
calls:

- `stringlizeNAIChat(formated, currentChar?.name ?? '', arg.continue)`
  from `src/ts/process/models/nai.ts:5` to flatten the chat into
  a single string with `db.NAIsettings.seperator` between turns,
  `db.NAIsettings.starter` for new-chat markers, `db.NAIappendName`
  controlling `${name}: ` prefixes, and `db.NAIadventure`
  prepending `> ` to user turns.
- `unstringlizeChat(da.data.output, formated, currentChar?.name ?? '')`
  from `src/ts/process/stringlize.ts:128` to trim the model's
  continuation back to just the assistant turn. The unstringlizer
  uses `getUnstringlizerChunks(formated, char)` which scans the
  full `formated` array plus `getUserName()` to assemble the cut
  markers (`${char}:`, `${userName}:`, every per-message `name`
  field, plus a literal `'system note:'` etc.).

NovelList: `requestNovelList` (similar pattern, with
`stringlizeAINChat` from `stringlize.ts:204` and `unstringlizeAIN`
from `stringlize.ts:285`).

Sampler / parameter blocks are large in both cases (NovelAI alone
ships ~25 fields including `repetition_penalty_whitelist`,
`bad_words_ids`, `order`, mirostat, cfg, etc.) but those are
straightforward pass-throughs once the prompt is in hand.

## Why this isn't a free port

The local browser context owns three things the server doesn't:

1. **Per-character state.** `getCurrentCharacter()` returns the
   currently-selected character's name, which feeds both
   `stringlizeNAIChat` (prefix) and `getUnstringlizerChunks`
   (cut markers).
2. **Per-user state.** `getUserName()` (from
   `db.username`) is used by the unstringlizer to build the
   user-side cut markers.
3. **Per-message metadata.** `formated[i].name` and
   `formated[i].memo` carry per-row context (the memo is used by
   `stringlizeNAIChat` to detect new-chat markers like
   `'NewChatExample'` or `'NewChat'` and substitute the
   `db.NAIsettings.starter` symbol).

If we port the helpers server-side, every one of these has to be
plumbed through `options.novelai` / `options.novellist` because
the server doesn't (yet) own the SPA's character/user/message
state. That's exactly the same plumbing-detour concern from the
Ooba memo, and it's the signal that this work belongs in Phase 7
(server-owned prompt assembly).

## The options

### A — Don't ship NovelAI/NovelList server-routed

Cheapest. Local Novel{AI,List} already works. Leave
`LLMFormat.NovelAI` and `LLMFormat.NovelList` on
`formatToServerProvider() → null` and revisit when one of
B/C/D becomes worth the cost.

- **Cost:** ~0 LOC.
- **Benefit:** none — Phase 6 stays incomplete for two providers.
- **Risk:** none.

### B — Pre-stringlize on the client, ship a `prompt` string

The client calls `stringlizeNAIChat` / `stringlizeAINChat` locally
and sends `{input: <flattened>}` plus the sampler block as
`options.novelai = {...}` / `options.novellist = {...}`. The
server is a thin proxy that POSTs the body to the upstream
NovelAI / NovelList endpoint, handles auth, and relays the
response. The unstringlize step happens on the client after the
response returns (using the local `formated` and character/user
state that's already in hand).

- **Cost:** ~250 LOC dispatcher (URL branch + sampler types +
  auth + buffered fetch) + ~150 LOC tests per provider. No new
  server-side helpers; the asymmetry is contained to one field.
- **Benefit:** Avoids the plumbing detour. NovelAI/NovelList
  don't have an alternative messages-shaped wire that B would
  break — their native wire _is_ a flat `prompt` string, so the
  contract asymmetry is much weaker than for Ooba.
- **Catch:** Other server-side concerns (Phase 7 prompt assembly,
  Phase 9 client thinning) still have to either accept a
  `prompt`-string fast path for these two providers or generalize
  back to messages later. Doing B now and Phase 7 later means we
  retire the `prompt`-string contract for these providers when
  the server gains character/user context, which is mild churn
  but not zero.

### C — Port stringlize/unstringlize to the server

Move both `stringlizeNAIChat` + `stringlizeAINChat` server-side
into something like `server/fastify/src/generation/novelai.ts` +
`novellist.ts`. Plumb every dependency through `options`:

- `db.NAIsettings.seperator`, `.starter`, `.NAIappendName`,
  `.NAIadventure`, `.topK`, `.topP`, …
- `userName` (from `db.username`)
- `characterName` (from `db.characters[db.currentChar].name`)
- The per-message `name` and `memo` fields (extend the
  `ChatMessage` wire type to carry them through)
- For NovelAI: `logit_bias_exp` parsing (deferred per HANDOVER —
  needs the NovelAI tokenizer port).

The unstringlize step also moves server-side; it needs the same
character/user context plus the full `formated` array (which the
server already receives) and produces the trimmed assistant turn
before returning `{result}`.

- **Cost:** ~600 LOC across two dispatchers + the shared helpers
  - tests. New `ChatMessage` wire fields (`name`, `memo`). Two
    new options bags (`options.novelai`, `options.novellist`) with
    ~15 fields each.
- **Benefit:** Server-routed contract stays consistent: messages
  go in, result comes out, all wire shapes use `messages:
ChatMessage[]` (with optional `name`/`memo`).
- **Catch:** The character/user/sampler plumbing is exactly the
  Phase 7 work that the Ooba memo identified as out of scope for
  Phase 6. Doing it for these two providers now means inventing
  the plumbing once and then re-generalizing it in Phase 7. The
  cost is also higher than the Ooba C option (~250 LOC) because
  Novel\* needs the unstringlize step in addition to the
  stringlize.

### D — Ship A now, do C as part of Phase 7

Same shape as the Ooba memo's recommendation. Keep
NovelAI/NovelList on local dispatch through Phase 6; Phase 7's
"server-owned prompt assembly" naturally absorbs the
stringlize/unstringlize work once character context becomes a
first-class server concept.

- **Cost:** 0 LOC in Phase 6; the work happens in Phase 7.
- **Benefit:** Avoids inventing per-provider character/user
  plumbing that gets ripped out later.
- **Catch:** Phase 6's "all providers server-routed" status
  stays incomplete for two more providers. Already incomplete
  for Ooba, so this isn't a new gap shape.

## What I'd pick

**D, consistent with the Ooba memo.** The
character/user/per-message-metadata plumbing is the same Phase 7
problem; doing it case-by-case in Phase 6 is throwaway work.

The closest call against D is B — and it's closer for NovelAI
than it was for Ooba. NovelAI/NovelList's native wire is already
a flat `prompt` string, so the messages-vs-prompt asymmetry
introduced by B is contained to two providers whose wires are
_already_ asymmetric to the messages-shaped majority. If these
need server-routing before Phase 7 reaches provider flattening, B
is the right answer — the cost is one `prompt`-string fast path in
the server contract that gets retired when Phase 7 generalizes
character/user context.

C is the wrong shape for the same reason as in Ooba: it pulls
Phase 7 plumbing forward into Phase 6 without earning much.

## How D differs from the Ooba D

- **Ooba D**: defers because Phase 7 will absorb the
  `applyChatTemplate` Jinja rendering naturally — _or_ because
  someone could land B as a stopgap (rendered `prompt` string)
  and accept the asymmetry against the rest of the OpenAI-shaped
  wire family.
- **NovelAI/NovelList D**: defers because Phase 7 will absorb
  `stringlize{NAI,AIN}Chat` + `unstringlize{Chat,AIN}` naturally
  — but B has a stronger case here because the upstream wire is
  _already_ a `prompt` string, so the asymmetry argument against
  B applies less.

If we end up taking B for Ooba (e.g., to ship OAI-compat
reverse-proxy parity sooner than Phase 7), it would be natural
to take B for Novel\* too. They're a coherent pair.

## Triggers to revisit

- Phase 7's provider-specific flattening work slips behind the
  core chat route **and** the "all providers server-routed" goal
  becomes load-bearing for a Phase 9 client-thinning slice.
- A user reports NovelAI / NovelList output quality drops on
  some unusual `db.NAIsettings` configuration that suggests the
  local stringlize and the upstream tokenizer have diverged. (At
  that point we'd want server-side control regardless.)
- We take option B for the Ooba memo. NovelAI/NovelList should
  then take B as a matched pair, not D.

## What these slices would have looked like (for reference)

For NovelAI (under option C):

```ts
// server/fastify/src/generation/novelai.ts

interface NovelAIRequest {
  input: string // pre-stringlized OR built server-side
  model: 'kayra-v1' | 'clio-v1' // routed from aiModel
  parameters: NAIParameters // ~25 sampler fields
  apiKey: string // db.novelai.token
  signal: AbortSignal
}

// URL branch:
//   kayra → https://text.novelai.net/ai/generate
//   clio  → https://api.novelai.net/ai/generate
// Auth: Bearer ${apiKey}
// Response: {output: string} → unstringlize → {type: 'success', result}
```

Under option B, the request body is the same but the SPA
provides `input` already stringlized; the server skips the
flatten step. Under option D, this dispatcher lands as part of
Phase 7 when the character/user context becomes a server-owned
concept.

For NovelList (under option B or C):

```ts
// URL: https://api.tringpt.com/api
// Auth: Bearer ${db.novellistAPI}
// Model: 'damsel' (aiModel === 'novellist_damsel') | 'supertrin'
// Response: {data: [string]} → unstringlize → {type: 'success', result}
```

Both share the auth-and-sampler boilerplate; the
stringlize/unstringlize is where they diverge from the rest of
Phase 6.
