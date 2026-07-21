# Chat Screen Width

> Archived completion and decision record. This describes the implementation
> and validation state on 2026-07-20, not the current UI contract.

Status: completed on the `fastify` branch on 2026-07-20 in commit `980a404c0`.

## Settled Design

`chatScreenWidth` is a numeric Display setting with a default of 900 pixels.
The Settings > Display > Size and Speed slider spans 500–2,000 in steps of 10.
The width is always fixed; there is no automatic-width sentinel.

The chat screen exposes a reactive `--chat-screen-width`. Shared
`.chat-screen-content-width` styling uses
`width: min(var(--chat-screen-width, 900px), 100%)`, centered inline with no
flex shrink. The class was applied across the transcript, composer, draft,
attachments, stickers, suggestions, progress, load-more, and notice rows, with
the direct greeting-row path covered separately. The `min(..., 100%)` clamp is
the mobile and waifu-theme safeguard.

Message content also became a block with width calculated from the available
row so an inline span's content-hugging and the prose `65ch` rule no longer
determine the chat-column width.

## Existing-Database Hydration Constraint

Adding a scalar settings key does not populate existing server databases.
`normalizeDatabaseDefaults` runs during state initialization and snapshot
import, not on boot of an existing SQLite database. The live client boot builds
its database from resource projections, bypassing the `setDatabase` migrations;
`applyServerResourceDatabase` had no live call sites at the time of this work.

Consequently, a new key remains `undefined` until first written. Every consumer
needs a read-site `?? default` fallback, and a `SettingRenderer` item needs
`getValue: (db) => db.key ?? default` even when `bindKey` owns the write path.
Without both, this slider rendered `undefinedpx` on existing databases.

## Validation Record

- The recorded server lane had 2,630 passing tests and one skip. Frontend tests
  were green apart from the five pre-existing `Chat.customHtml.test.ts`
  failures recorded by Saved Toggles.
- A live browser check confirmed equal fixed widths for long and short message
  rows, reactive slider updates, and server persistence across reload.
- The settings slider is a custom `[role="slider"]` element rather than a native
  range input; keyboard arrows change it. The settings close button is
  `button[aria-label="Close"]`.
- Settings writes require the browser session to hold the active-writer lease.
  Direct `curl` patches without it fail with `active_writer_stale`.
