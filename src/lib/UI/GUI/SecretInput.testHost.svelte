<script lang="ts">
  import { MASKED_PROVIDER_SECRET } from 'src/ts/providerSecretMask'
  import SecretInput from './SecretInput.svelte'

  let topLevel = $state(MASKED_PROVIDER_SECRET)
  let nested = $state({ key: MASKED_PROVIDER_SECRET })
  let rows = $state([
    { id: 'row-a', key: MASKED_PROVIDER_SECRET },
    { id: 'row-b', key: MASKED_PROVIDER_SECRET },
  ])
  let selectedRow = $state(0)

  export function values(): { topLevel: string; nested: string; rows: string[] } {
    return {
      topLevel,
      nested: nested.key,
      rows: rows.map((row) => row.key),
    }
  }

  export function acknowledgeTopLevel(): void {
    topLevel = MASKED_PROVIDER_SECRET
  }

  export function selectRow(index: number): void {
    selectedRow = index
  }
</script>

<SecretInput ariaLabel="Top-level secret" ownerKey="top-level" bind:value={topLevel} />
<SecretInput ariaLabel="Nested secret" ownerKey="nested.key" bind:value={nested.key} />
<SecretInput ariaLabel="Row secret" ownerKey={rows[selectedRow].id} bind:value={rows[selectedRow].key} />
