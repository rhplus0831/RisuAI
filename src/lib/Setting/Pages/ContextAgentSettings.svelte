<script lang="ts">
  import SettingRenderer from '../SettingRenderer.svelte'
  import { contextAgentSettingsItems } from 'src/ts/setting/contextAgentSettingsData'
</script>

<SettingRenderer items={contextAgentSettingsItems} />
