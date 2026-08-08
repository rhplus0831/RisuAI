<script lang="ts">
  import Chat from './Chat.svelte'

  export interface ParserDependencyRow {
    id: string
    data: string
    generationStage?: number
    isGenerationLoading?: boolean
    name: string
    parserIdx?: number
    role: string
  }

  let { initialRows = [] }: { initialRows?: ParserDependencyRow[] } = $props()
  let rows = $state<ParserDependencyRow[]>([])
  let seeded = false

  $effect(() => {
    if (!seeded) {
      rows = initialRows.map((row) => ({ ...row }))
      seeded = true
    }
  })

  export function updateMessage(index: number, data: string) {
    if (rows[index]) {
      rows[index].data = data
    }
  }

  export function updateRole(index: number, role: string) {
    if (rows[index]) {
      rows[index].role = role
    }
  }

  export function updateName(index: number, name: string) {
    if (rows[index]) {
      rows[index].name = name
    }
  }

  export function updateParserIndex(index: number, parserIdx: number) {
    if (rows[index]) {
      rows[index].parserIdx = parserIdx
    }
  }
</script>

{#each rows as row, index (row.id)}
  <Chat
    message={row.data}
    name={row.name}
    isLastMemory={false}
    idx={row.parserIdx ?? index}
    role={row.role}
    totalLength={rows.length}
    firstMessage={index === 0}
    isGenerationLoading={row.isGenerationLoading}
    generationStage={row.generationStage}
    img=""
    rerollIcon={false}
    disabled={false} />
{/each}
