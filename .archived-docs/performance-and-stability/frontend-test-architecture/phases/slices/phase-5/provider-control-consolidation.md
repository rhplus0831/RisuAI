# Phase 5 Slice: Provider Control Consolidation

Status: Complete

## Scope

Move the Ooba optional-parameter accessibility case into
`ProviderListActions.svelte.test.ts`, which already owns adjacent Ooba and
OpenRouter list controls with the same component graph and target lifecycle.
Keep Ooba and OpenRouter behaviors in explicit describes.

## Ownership And Invariants

- The combined owner mounts a fresh provider component into a fresh target for
  every case and deterministically unmounts/removes it.
- The real `OptionalInput` and `TextInput` components remain in the combined
  graph because their checkbox/value names are behavior under test. Shared
  structural provider controls retain the existing lightweight stubs.
- Ooba still proves 32 unique named optional groups, distinct enable/value
  labels, disabled unset values, and enabled configured values.
- Ooba stop-word and OpenRouter list buttons retain exact add/remove accessible
  names, row identity, and unsupported-state assertions.

## Measurement

| Observation | Files / tests | Vitest | Transform | Setup | Import | Tests | Environment | Wall | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 2 / 4 | 7.32s | 11.36s | 122ms | 13.95s | 126ms | 237ms | 8.03s | 1,142,032 |
| After | 1 / 4 | 7.43s | 5.88s | 84ms | 7.05s | 114ms | 116ms | 8.20s | 846,820 |

Focused Vitest moves +1.5% and wall +2.1%, both inside the established 5% noise
band. Summed import falls 49.5%, environment 51.1%, transform 48.2%, and peak
RSS 25.8%. The slice is retained for the repeated-file reduction and coherent
provider-control ownership, not claimed as a focused wall-time win.

Relative to the AlertComp slice, full discovery changes from 536 to 535 files,
standalone ordinary from 534 to 533, and aggregate ordinary from 528 to 527.
Runtime ownership changes by one D file; all four behavior cases remain.

## Validation

- Focused consolidated owner: 1 file / 4 tests passed.
- Shuffled test-order runs with seeds 101, 202, and 303 passed with isolation
  and retries disabled.
- Frontend inventory regeneration and the three-view completeness proof passed.
- Prettier and `git diff --check` passed.

The first combined run exposed that the former provider-list owner stubbed
`TextInput`; restoring real `OptionalInput` alone could not prove the value-input
label. The final harness deliberately restores both real controls, and the full
four-case owner passes.

## Rollback

Restore `OobaSettings.optionalInput.svelte.test.ts`, remove its describe and
reverse-proxy draft from the provider-list owner, restore the `OptionalInput`
and `TextInput` stubs, restore the settings inventory references, and regenerate
the frontend inventory.
