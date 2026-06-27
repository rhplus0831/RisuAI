<script lang="ts">
  import type { SettingContext, SettingItem } from 'src/ts/setting/types'
  import type { LLMModel } from 'src/ts/model/types'

  interface Props {
    items: SettingItem[]
    modelInfo?: LLMModel
    subModelInfo?: LLMModel
    presetMirrorTarget?: SettingContext['presetMirrorTarget']
  }

  let { items, modelInfo, subModelInfo, presetMirrorTarget = 'auto' }: Props = $props()
</script>

<div
  data-setting-renderer-probe
  data-items={items.length}
  data-model={modelInfo?.id ?? ''}
  data-preset-mirror-target={presetMirrorTarget}
  data-sub-model={subModelInfo?.id ?? ''}>
</div>
