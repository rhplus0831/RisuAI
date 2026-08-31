<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import type { Database } from 'src/ts/storage/database.svelte'
  import type { LLMModel } from 'src/ts/model/types'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
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
  let rendererSettings = $derived(
    settingsResourceState.status === 'ready' ? settingsResourceState.value : ({} as typeof settingsResourceState.value),
  )
  let modelCatalog = $derived({
    customModels: rendererSettings.customModels,
    enableCustomFlags: rendererSettings.enableCustomFlags,
    customFlags: rendererSettings.customFlags,
  })

  // Derive modelInfo if not provided
  let effectiveModelInfo = $derived(modelInfo ?? getModelInfo(rendererSettings.aiModel ?? '', modelCatalog))
  let effectiveSubModelInfo = $derived(subModelInfo ?? getModelInfo(rendererSettings.subModel ?? '', modelCatalog))

  // Build context for condition checks
  let ctx: SettingContext = $derived({
    db: rendererSettings as unknown as Database,
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
