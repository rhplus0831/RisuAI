# Asset Content-Type Coercion

> Archived completion and decision record. This describes the implementation
> and observed import behavior on 2026-07-20, not the current asset contract.

Status: completed on the `fastify` branch on 2026-07-20 in commit `4f34b46ad`.

## Problem And Rationale

A card import failed for `data/failed.jpeg`: the JPEG-contained character
archive declared `assets/icon/image/main.png`, but that asset contained WebP
bytes. `addAssets` rejected any mismatch between the declared content type and
magic-byte detection. Real-world cards commonly carry incorrect extensions,
and original RisuAI stored such assets as-is.

The settled rule is **coerce, do not reject**. `addAssets` resolves an effective
content type and stores the asset using the detected type and extension. This
keeps the metadata-accuracy goal of earlier commit `1f0242f08` while accepting
existing cards. The browser continues to declare type from the filename, so no
client change was required.

When detection cannot identify a format, the declared type remains in use. The
content-type-conflict guard for already stored corrupt metadata was not changed.

## Operational Gotchas

- `/api/v1/assets/bulk` validates each chunk all-or-nothing. Before this fix,
  one bad asset rejected its entire chunk, which could surface as several asset
  failures even though only one file was problematic.
- The recorded development session used `dev:human`, whose API process runs
  under `tsx watch`; the server-side fix became live without a manual restart.
