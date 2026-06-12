<script lang="ts">
  import { DownloadIcon, HardDriveUploadIcon, PlusIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'

  import { DBState } from 'src/ts/stores.svelte'
  import { exportRegex, importRegex } from 'src/ts/process/scripts'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'

  const globalScriptDraft = createServerBackedSettingDraft('globalscript', DBState.db.globalscript)
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">
  {language.globalRegexScript}
  <Help key="regexScript" />
</h2>
<RegexList bind:value={globalScriptDraft.value} />
<div class="text-textcolor2 mt-2 flex gap-2">
  <button
    class="font-medium cursor-pointer hover:text-green-500"
    onclick={() => {
      globalScriptDraft.value = [
        ...globalScriptDraft.value,
        {
          comment: '',
          in: '',
          out: '',
          type: 'editinput',
        },
      ]
    }}><PlusIcon /></button>
  <button
    class="font-medium cursor-pointer hover:text-green-500"
    onclick={() => {
      exportRegex(globalScriptDraft.value)
    }}><DownloadIcon /></button>
  <button
    class="font-medium cursor-pointer hover:text-green-500"
    onclick={async () => {
      globalScriptDraft.value = await importRegex(globalScriptDraft.value)
    }}><HardDriveUploadIcon /></button>
</div>
