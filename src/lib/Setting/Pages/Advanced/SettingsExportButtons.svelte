<script lang="ts">
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import { alertError, alertMd, alertNormal } from 'src/ts/alert'
  import { downloadFile, getRequestLog } from 'src/ts/globalApi.svelte'
  import { maskRegisteredProviderSecretsInPlace } from 'src/ts/providerSecretMask'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'

  let bugReportExportBusy = $state(false)

  async function exportSettingsForBugReport() {
    if (bugReportExportBusy) return
    bugReportExportBusy = true

    try {
      const db = safeStructuredClone(settingsResourceState.value) as Record<string, unknown>
      maskRegisteredProviderSecretsInPlace(db)

      const keyToRemove = [
        'characters',
        'loreBook',
        'plugins',
        'account',
        'personas',
        'username',
        'userIcon',
        'userNote',
        'modules',
        'enabledModules',
        'botPresets',
        'characterOrder',
        'webUiUrl',
        'characterOrder',
        'hordeConfig',
        'novelai',
        'koboldURL',
        'ooba',
        'ainconfig',
        'personaPrompt',
        'promptTemplate',
        'deeplOptions',
        'google',
        'customPromptTemplateToggle',
        'globalChatVariables',
        'comfyConfig',
        'comfyUiUrl',
        'translatorPrompt',
        'translatorPresets',
        'translatorPresetId',
        'customModels',
        'mcpURLs',
        'authRefreshes',
      ]
      for (const key in db) {
        if (
          keyToRemove.includes(key) ||
          key.toLowerCase().includes('key') ||
          key.toLowerCase().includes('proxy') ||
          key.toLowerCase().includes('hypa')
        ) {
          delete db[key]
        }
      }

      db.meta = {
        isFastifyServer: true,
        protocol: location.protocol,
      }

      const json = JSON.stringify(db, null, 2)
      await downloadFile('risuai-settings-report.json', new TextEncoder().encode(json))

      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
        await navigator.clipboard.writeText(json)
        alertNormal(language.settingsExported)
      } catch {
        alertNormal(language.settingsExportedWithoutClipboard)
      }
    } catch (error) {
      alertError(error)
    } finally {
      bugReportExportBusy = false
    }
  }
</script>

<Button
  className="mt-4"
  onclick={async () => {
    alertMd(getRequestLog())
  }}>
  {language.ShowLog}
</Button>

<Button className="mt-4" disabled={bugReportExportBusy} onclick={exportSettingsForBugReport}>
  Export Settings for Bug Report
</Button>
