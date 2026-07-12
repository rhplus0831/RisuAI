<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import type { LLMModel } from 'src/ts/model/types'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { getModelInfo } from 'src/ts/model/modellist'
  import { settingRegistry } from 'src/ts/setting/settingRegistry'
  import { checkCondition } from 'src/ts/setting/utils'

  interface Props {
    items: SettingItem[]
    /** Optional modelInfo, derived automatically if not provided */
    modelInfo?: LLMModel
    /** Optional subModelInfo, derived automatically if not provided */
    subModelInfo?: LLMModel
    presetMirrorTarget?: SettingContext['presetMirrorTarget']
  }

  let { items, modelInfo, subModelInfo, presetMirrorTarget = 'auto' }: Props = $props()

  // Derive modelInfo if not provided
  let effectiveModelInfo = $derived(modelInfo ?? getModelInfo(getDatabase().aiModel))
  let effectiveSubModelInfo = $derived(subModelInfo ?? getModelInfo(getDatabase().subModel))

  // Build context for condition checks
  let ctx: SettingContext = $derived({
    db: getDatabase(),
    modelInfo: effectiveModelInfo,
    subModelInfo: effectiveSubModelInfo,
    presetMirrorTarget,
  })
</script>

{#each items as item (item.id)}
  {#if checkCondition(item, ctx)}
    {@const Component = settingRegistry[item.type]}
    {#if Component}
      <Component {item} {ctx} />
    {:else}
      <div class="text-draculared text-xs mt-2">Unknown setting type: {item.type}</div>
    {/if}
  {/if}
{/each}
