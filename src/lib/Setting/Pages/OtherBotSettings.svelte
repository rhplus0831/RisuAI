<script lang="ts">
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import { DBState, selectedCharID } from 'src/ts/stores.svelte'
  import { saveAsset, downloadFile, globalFetch } from 'src/ts/globalApi.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte'
  import { getCharImage } from 'src/ts/characters'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { untrack } from 'svelte'
  import { tokenizePreset } from 'src/ts/process/prompt'
  import { getCharToken } from 'src/ts/tokenizer'
  import { PlusIcon, PencilIcon, TrashIcon, DownloadIcon, HardDriveUploadIcon } from '@lucide/svelte'
  import { alertError, alertInput, alertConfirm, alertNormal } from 'src/ts/alert'
  import { createHypaV3Preset } from 'src/ts/process/memory/hypav3'
  import { onDestroy } from 'svelte'
  import { createServerBackedSettingDraft, watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'
  import { ensurePromptTemplateHydrated } from 'src/ts/server/promptTemplateHydration'
  import {
    applyFreshSettingsMediaAssetUpload,
    beginSettingsMediaAssetUpload,
    captureSettingsMediaAssetUploadTarget,
    clearSettingsMediaAssetUpload,
    isFreshSettingsMediaAssetUpload,
    type SettingsMediaAssetUploadFieldKeys,
    type SettingsMediaAssetUploadFreshness,
    type SettingsMediaAssetUploadOperation,
    type SettingsMediaAssetUploadTarget,
  } from 'src/ts/server/settingsMediaAssetUpload'

  const stopServerSettingsWatch = watchServerBackedSettings(['useLegacyGUI'])
  onDestroy(stopServerSettingsWatch)

  const sdProviderDraft = createServerBackedSettingDraft<string>('sdProvider', '')
  const webUiUrlDraft = createServerBackedSettingDraft<string>('webUiUrl', '')
  const sdStepsDraft = createServerBackedSettingDraft<number>('sdSteps', 20)
  const sdCFGDraft = createServerBackedSettingDraft<number>('sdCFG', 7)
  const sdConfigDraft = createServerBackedSettingDraft<Record<string, any>>('sdConfig', {})
  const NAIImgUrlDraft = createServerBackedSettingDraft<string>('NAIImgUrl', '')
  const NAIApiKeyDraft = createServerBackedSettingDraft<string>('NAIApiKey', '')
  const NAIImgModelDraft = createServerBackedSettingDraft<string>('NAIImgModel', '')
  const NAII2IDraft = createServerBackedSettingDraft<boolean>('NAII2I', false)
  const NAIImgConfigDraft = createServerBackedSettingDraft<Record<string, any>>('NAIImgConfig', {})
  const openAIKeyDraft = createServerBackedSettingDraft<string>('openAIKey', '')
  const dallEQualityDraft = createServerBackedSettingDraft<string>('dallEQuality', 'standard')
  const stabilityKeyDraft = createServerBackedSettingDraft<string>('stabilityKey', '')
  const stabilityModelDraft = createServerBackedSettingDraft<string>('stabilityModel', '')
  const stabllityStyleDraft = createServerBackedSettingDraft<string>('stabllityStyle', '')
  const comfyConfigDraft = createServerBackedSettingDraft<Record<string, any>>('comfyConfig', {})
  const comfyUiUrlDraft = createServerBackedSettingDraft<string>('comfyUiUrl', '')
  const falTokenDraft = createServerBackedSettingDraft<string>('falToken', '')
  const falModelDraft = createServerBackedSettingDraft<string>('falModel', '')
  const falLoraDraft = createServerBackedSettingDraft<string>('falLora', '')
  const falLoraScaleDraft = createServerBackedSettingDraft<number>('falLoraScale', 1)
  const googleDraft = createServerBackedSettingDraft<Record<string, any>>('google', {})
  const ImagenModelDraft = createServerBackedSettingDraft<string>('ImagenModel', '')
  const ImagenImageSizeDraft = createServerBackedSettingDraft<string>('ImagenImageSize', '1K')
  const ImagenAspectRatioDraft = createServerBackedSettingDraft<string>('ImagenAspectRatio', '1:1')
  const ImagenPersonGenerationDraft = createServerBackedSettingDraft<string>('ImagenPersonGeneration', 'allow_all')
  const openaiCompatImageDraft = createServerBackedSettingDraft<Record<string, any>>('openaiCompatImage', {})
  const wavespeedImageDraft = createServerBackedSettingDraft<Record<string, any>>('wavespeedImage', {})
  const ttsAutoSpeechDraft = createServerBackedSettingDraft<boolean>('ttsAutoSpeech', false)
  const elevenLabKeyDraft = createServerBackedSettingDraft<string>('elevenLabKey', '')
  const voicevoxUrlDraft = createServerBackedSettingDraft<string>('voicevoxUrl', '')
  const huggingfaceKeyDraft = createServerBackedSettingDraft<string>('huggingfaceKey', '')
  const fishSpeechKeyDraft = createServerBackedSettingDraft<string>('fishSpeechKey', '')
  const emotionProcesserDraft = createServerBackedSettingDraft<string>('emotionProcesser', 'submodel')
  const hypaV3Draft = createServerBackedSettingDraft<boolean>('hypaV3', false)
  const hypaV3PresetsDraft = createServerBackedSettingDraft<any[]>('hypaV3Presets', [])
  const hypaV3PresetIdDraft = createServerBackedSettingDraft<number>('hypaV3PresetId', 0)
  const hypaModelDraft = createServerBackedSettingDraft<string>('hypaModel', 'MiniLM')
  const hypaV3KeyDraft = createServerBackedSettingDraft<string>('hypaV3Key', '')
  const hypaCustomSettingsDraft = createServerBackedSettingDraft<Record<string, any>>('hypaCustomSettings', {
    url: '',
    key: '',
    model: '',
  })
  const voyageApiKeyDraft = createServerBackedSettingDraft<string>('voyageApiKey', '')

  const NAI_CHARACTER_REFERENCE_UPLOAD_FIELDS = {
    image: 'character_image',
    base64image: 'character_base64image',
  } satisfies SettingsMediaAssetUploadFieldKeys
  const NAI_I2I_BASE_UPLOAD_FIELDS = {
    image: 'image',
    base64image: 'base64image',
  } satisfies SettingsMediaAssetUploadFieldKeys
  const WAVESPEED_REFERENCE_UPLOAD_FIELDS = {
    image: 'reference_image',
    base64image: 'reference_base64image',
  } satisfies SettingsMediaAssetUploadFieldKeys

  let submenu = $state(DBState.db.useLegacyGUI ? -1 : 0)

  // HypaV3
  $effect(() => {
    const settings = hypaV3PresetsDraft.value?.[hypaV3PresetIdDraft.value]?.settings
    const currentValue = settings?.similarMemoryRatio

    if (!currentValue) return

    untrack(() => {
      const newValue = Math.min(currentValue, 1)

      settings.similarMemoryRatio = newValue

      if (newValue + settings.recentMemoryRatio > 1) {
        settings.recentMemoryRatio = 1 - newValue
      }
    })
  })

  $effect(() => {
    const settings = hypaV3PresetsDraft.value?.[hypaV3PresetIdDraft.value]?.settings
    const currentValue = settings?.recentMemoryRatio

    if (!currentValue) return

    untrack(() => {
      const newValue = Math.min(currentValue, 1)

      settings.recentMemoryRatio = newValue

      if (newValue + settings.similarMemoryRatio > 1) {
        settings.similarMemoryRatio = 1 - newValue
      }
    })
  })

  async function getMaxMemoryRatio(): Promise<number> {
    await ensurePromptTemplateHydrated()
    const promptTemplateToken = await tokenizePreset(DBState.db.promptTemplate)
    const char = DBState.db.characters[$selectedCharID]
    const charToken = await getCharToken(char)
    const maxLoreToken = char.loreSettings?.tokenBudget ?? DBState.db.loreBookToken
    const maxResponse = DBState.db.maxResponse
    const requiredToken =
      promptTemplateToken + charToken.persistant + Math.min(charToken.dynamic, maxLoreToken) + maxResponse * 3
    const maxContext = DBState.db.maxContext

    if (maxContext === 0) {
      return 0
    }

    const maxMemoryRatio = Math.max((maxContext - requiredToken) / maxContext, 0)

    return parseFloat(maxMemoryRatio.toFixed(2))
  }
  // End HypaV3

  // wavespeed
  interface WavespeedModel {
    model_id: string
    name: string
    base_price: number
    supportsImageInput: boolean
    supportsLoras: boolean
  }
  interface LoraItem {
    path: string
    scale: number
  }
  let wavespeedModels = $state<WavespeedModel[]>([])
  let isWavespeedLoading = $state(false)
  let wavespeedSearchQuery = $state('')
  let wavespeedLoras = $state<LoraItem[]>([
    { path: '', scale: 1.0 },
    { path: '', scale: 1.0 },
    { path: '', scale: 1.0 },
  ])

  /**
   * Fetch models from WaveSpeed API dynamically
   * https://wavespeed.ai/docs/docs-common-api/models
   */
  async function fetchWavespeedModels() {
    if (!wavespeedImageDraft.value.key || wavespeedImageDraft.value.key.trim() === '') {
      alertError('WaveSpeed API Key not set')
      return []
    }

    isWavespeedLoading = true
    try {
      const result = await globalFetch('https://api.wavespeed.ai/api/v3/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${wavespeedImageDraft.value.key}`,
        },
      })

      if (!result.ok || !result.data) {
        alertError('Failed to fetch WaveSpeed models')
        return
      }

      let responseData
      try {
        responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
      } catch (e) {
        alertError('Failed to parse WaveSpeed response')
        return
      }

      if (responseData.code !== 200 || !Array.isArray(responseData.data)) {
        alertError('Invalid WaveSpeed API response')
        return
      }

      // Filter, transform, and sort models by name
      const filteredModels: WavespeedModel[] = responseData.data
        .filter((model: any) => model.type === 'text-to-image' || model.type === 'image-to-image')
        .map((model: any) => {
          // Check if model supports LoRAs
          const supportsLoras =
            model.api_schema?.api_schemas?.some(
              (schema: any) => schema.request_schema?.properties?.loras !== undefined,
            ) ?? false

          return {
            model_id: model.model_id,
            name: model.name,
            base_price: model.base_price,
            type: model.type,
            supportsImageInput: model.type === 'image-to-image',
            supportsLoras: supportsLoras,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.model_id))

      wavespeedModels = filteredModels
      alertNormal(`Successfully loaded ${filteredModels.length} models`)
    } catch (error) {
      alertError(`Failed to fetch models: ${error}`)
    } finally {
      isWavespeedLoading = false
    }
  }

  /**
   * Handle model selection change
   */
  function getSelectedWavespeedModel(): WavespeedModel | undefined {
    return wavespeedModels.find((m) => m.model_id === wavespeedImageDraft.value.model)
  }

  function handleModelChange() {
    const selectedModel = getSelectedWavespeedModel()

    // Reset reference_mode for text-to-image models
    if (!selectedModel?.supportsImageInput) {
      wavespeedImageDraft.value.reference_mode = ''
      wavespeedImageDraft.value.reference_image = undefined
      wavespeedImageDraft.value.reference_base64image = undefined
    }

    // Reset loras if model doesn't support them
    if (!selectedModel?.supportsLoras) {
      wavespeedImageDraft.value.loras = undefined
    }
  }

  /**
   * Get display name for a WaveSpeed model
   * @param model - The model to get display name for
   */
  function getModelDisplayName(model: WavespeedModel): string {
    const imageInputIcon = model.supportsImageInput ? '✓' : '✗'
    const loraIcon = model.supportsLoras ? '✓' : '✗'
    return `${model.name} (price: ${model.base_price}) [${imageInputIcon} Image] [${loraIcon} LoRA]`
  }

  /**
   * Filter and sort models based on search query
   */
  function getFilteredModels(): WavespeedModel[] {
    if (wavespeedSearchQuery === '') return wavespeedModels

    const searchTerms = wavespeedSearchQuery.toLowerCase().trim().split(/\s+/)
    return wavespeedModels.filter((model) => {
      const modelText = (model.name + ' ' + model.model_id).toLowerCase()
      return searchTerms.every((term) => modelText.includes(term))
    })
  }

  function getVibeEncodingEntries(): Array<[string, { params: { information_extracted: number } }]> {
    const config = NAIImgConfigDraft.value
    const selection = config.vibe_model_selection
    const encodings = selection ? config.vibe_data?.encodings?.[selection] : undefined
    return Object.entries(encodings ?? {}) as Array<[string, { params: { information_extracted: number } }]>
  }

  function naiCharacterReferenceUploadContext() {
    return {
      provider: sdProviderDraft.value,
      model: NAIImgModelDraft.value,
      reference_mode: NAIImgConfigDraft.value.reference_mode,
    }
  }

  function naiI2IBaseUploadContext() {
    return {
      provider: sdProviderDraft.value,
      model: NAIImgModelDraft.value,
      i2i: NAII2IDraft.value,
    }
  }

  function wavespeedReferenceUploadContext() {
    return {
      provider: sdProviderDraft.value,
      model: wavespeedImageDraft.value.model,
      reference_mode: wavespeedImageDraft.value.reference_mode,
      supportsImageInput: getSelectedWavespeedModel()?.supportsImageInput ?? false,
    }
  }

  function currentNaiCharacterReferenceUploadTarget(): SettingsMediaAssetUploadTarget {
    return captureSettingsMediaAssetUploadTarget({
      targetId: 'nai-character-reference',
      fieldKeys: NAI_CHARACTER_REFERENCE_UPLOAD_FIELDS,
      config: NAIImgConfigDraft.value,
      context: naiCharacterReferenceUploadContext(),
    })
  }

  function currentNaiI2IBaseUploadTarget(): SettingsMediaAssetUploadTarget {
    return captureSettingsMediaAssetUploadTarget({
      targetId: 'nai-i2i-base',
      fieldKeys: NAI_I2I_BASE_UPLOAD_FIELDS,
      config: NAIImgConfigDraft.value,
      context: naiI2IBaseUploadContext(),
    })
  }

  function currentWavespeedReferenceUploadTarget(): SettingsMediaAssetUploadTarget {
    return captureSettingsMediaAssetUploadTarget({
      targetId: 'wavespeed-reference',
      fieldKeys: WAVESPEED_REFERENCE_UPLOAD_FIELDS,
      config: wavespeedImageDraft.value,
      context: wavespeedReferenceUploadContext(),
    })
  }

  function settingsMediaAssetUploadFreshness(
    operation: SettingsMediaAssetUploadOperation,
  ): SettingsMediaAssetUploadFreshness {
    switch (operation.targetId) {
      case 'nai-character-reference':
        return {
          config: NAIImgConfigDraft.value,
          context: naiCharacterReferenceUploadContext(),
        }
      case 'nai-i2i-base':
        return {
          config: NAIImgConfigDraft.value,
          context: naiI2IBaseUploadContext(),
        }
      case 'wavespeed-reference':
        return {
          config: wavespeedImageDraft.value,
          context: wavespeedReferenceUploadContext(),
        }
    }
  }

  function isCurrentSettingsMediaAssetUpload(operation: SettingsMediaAssetUploadOperation): boolean {
    return isFreshSettingsMediaAssetUpload(operation, settingsMediaAssetUploadFreshness(operation))
  }

  function writeSettingsMediaAssetUploadConfig(
    operation: SettingsMediaAssetUploadOperation,
    config: Record<string, unknown>,
  ): void {
    switch (operation.targetId) {
      case 'nai-character-reference':
        NAIImgConfigDraft.value = config
        console.log('Character image set:', NAIImgConfigDraft.value.character_image)
        return
      case 'nai-i2i-base':
        NAIImgConfigDraft.value = config
        return
      case 'wavespeed-reference':
        wavespeedImageDraft.value = config
        console.log('WaveSpeed reference image set:', wavespeedImageDraft.value.reference_image)
    }
  }

  async function uploadSettingsMediaAsset(target: SettingsMediaAssetUploadTarget): Promise<void> {
    const img = await selectSingleFile(['jpg', 'jpeg', 'png', 'webp'])
    if (!img) {
      return
    }

    const operation = beginSettingsMediaAssetUpload(target)
    try {
      if (!isCurrentSettingsMediaAssetUpload(operation)) return

      const imageData = img.data
      const base64Image = Buffer.from(imageData).toString('base64')
      const saveId = await saveAsset(imageData)
      if (!isCurrentSettingsMediaAssetUpload(operation)) return

      const nextConfig = applyFreshSettingsMediaAssetUpload({
        operation,
        freshness: settingsMediaAssetUploadFreshness(operation),
        image: saveId,
        base64Image,
      })
      if (!nextConfig) return

      writeSettingsMediaAssetUploadConfig(operation, nextConfig)
    } finally {
      clearSettingsMediaAssetUpload(operation)
    }
  }

  async function uploadNaiCharacterReferenceImage(): Promise<void> {
    const target = currentNaiCharacterReferenceUploadTarget()
    await uploadSettingsMediaAsset(target)
  }

  async function uploadNaiI2IBaseImage(): Promise<void> {
    const target = currentNaiI2IBaseUploadTarget()
    await uploadSettingsMediaAsset(target)
  }

  async function uploadWavespeedReferenceImage(): Promise<void> {
    const target = currentWavespeedReferenceUploadTarget()
    await uploadSettingsMediaAsset(target)
  }

  $effect(() => {
    // Sync loras to DB, filtering out empty URLs
    if (wavespeedImageDraft.value) {
      wavespeedImageDraft.value.loras = wavespeedLoras
        .filter((item) => item.path && item.path.trim() !== '')
        .map((item) => ({
          path: item.path,
          scale: item.scale,
        }))
    }
  })
  // End wavespeed
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.otherBots}</h2>

{#if submenu !== -1}
  <div class="flex w-full rounded-md border border-darkborderc mb-4">
    <button
      onclick={() => {
        submenu = 0
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 0}>
      <span>{language.longTermMemory}</span>
    </button>
    <button
      onclick={() => {
        submenu = 1
      }}
      class="p2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 1}>
      <span>TTS</span>
    </button>
    <button
      onclick={() => {
        submenu = 2
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 2}>
      <span>{language.emotionImage}</span>
    </button>
    <button
      onclick={() => {
        submenu = 3
      }}
      class="p-2 flex-1"
      class:bg-darkbutton={submenu === 3}>
      <span>{language.imageGeneration}</span>
    </button>
  </div>
{/if}

{#if submenu === 3 || submenu === -1}
  <Accordion name={language.imageGeneration} styled disabled={submenu !== -1}>
    <span class="text-textcolor mt-2">{language.imageGeneration} {language.provider} <Help key="sdProvider" /></span>
    <SelectInput className="mt-2 mb-4" bind:value={sdProviderDraft.value}>
      <OptionInput value="">None</OptionInput>
      <OptionInput value="webui">Stable Diffusion WebUI</OptionInput>
      <OptionInput value="novelai">Novel AI</OptionInput>
      <OptionInput value="dalle">Dall-E</OptionInput>
      <OptionInput value="stability">Stability API</OptionInput>
      <OptionInput value="fal">Fal.ai</OptionInput>
      <OptionInput value="comfyui">ComfyUI</OptionInput>
      <OptionInput value="Imagen">Imagen</OptionInput>
      <OptionInput value="openai-compat">OpenAI Compatible</OptionInput>
      <OptionInput value="wavespeed">WaveSpeedAI</OptionInput>

      <!-- Legacy -->
      {#if sdProviderDraft.value === 'comfy'}
        <OptionInput value="comfy">ComfyUI (Legacy)</OptionInput>
      {/if}
    </SelectInput>

    {#if sdProviderDraft.value === 'webui'}
      <span class="text-draculared text-xs mb-2">You must use WebUI with --api flag</span>
      <span class="text-draculared text-xs mb-2"
        >You must use WebUI without agpl license or use unmodified version with agpl license to observe the contents of
        the agpl license.</span>
      <span class="text-draculared text-xs mb-2"
        >To reach a local WebUI from the browser, use ngrok or other tunnels.</span>
      <span class="text-textcolor mt-2">WebUI {language.providerURL}</span>
      <TextInput size="sm" marginBottom placeholder="https://..." bind:value={webUiUrlDraft.value} />
      <span class="text-textcolor">Steps</span>
      <NumberInput size="sm" marginBottom min={0} max={100} bind:value={sdStepsDraft.value} />

      <span class="text-textcolor">CFG Scale</span>
      <NumberInput size="sm" marginBottom min={0} max={20} bind:value={sdCFGDraft.value} />

      <span class="text-textcolor">Width</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={sdConfigDraft.value.width} />
      <span class="text-textcolor">Height</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={sdConfigDraft.value.height} />
      <span class="text-textcolor">Sampler</span>
      <TextInput size="sm" marginBottom bind:value={sdConfigDraft.value.sampler_name} />

      <div class="flex items-center mt-2">
        <Check bind:check={sdConfigDraft.value.enable_hr} name="Enable Hires" />
      </div>
      {#if sdConfigDraft.value.enable_hr === true}
        <span class="text-textcolor">denoising_strength</span>
        <NumberInput size="sm" marginBottom min={0} max={10} bind:value={sdConfigDraft.value.denoising_strength} />
        <span class="text-textcolor">hr_scale</span>
        <NumberInput size="sm" marginBottom min={0} max={10} bind:value={sdConfigDraft.value.hr_scale} />
        <span class="text-textcolor">Upscaler</span>
        <TextInput size="sm" marginBottom bind:value={sdConfigDraft.value.hr_upscaler} />
      {/if}
    {/if}

    {#if sdProviderDraft.value === 'novelai'}
      <span class="text-textcolor mt-2">Novel AI {language.providerURL}</span>
      <TextInput size="sm" marginBottom placeholder="https://image.novelai.net" bind:value={NAIImgUrlDraft.value} />
      <span class="text-textcolor">API Key</span>
      <TextInput hideText size="sm" marginBottom placeholder="pst-..." bind:value={NAIApiKeyDraft.value} />

      <span class="text-textcolor">Model</span>
      <SelectInput className="mb-4" bind:value={NAIImgModelDraft.value}>
        <OptionInput value="nai-diffusion-4-5-full">nai-diffusion-4-5-full</OptionInput>
        <OptionInput value="nai-diffusion-4-5-curated">nai-diffusion-4-5-curated</OptionInput>
        <OptionInput value="nai-diffusion-4-full">nai-diffusion-4-full</OptionInput>
        <OptionInput value="nai-diffusion-4-curated-preview">nai-diffusion-4-curated-preview</OptionInput>
        <OptionInput value="nai-diffusion-3">nai-diffusion-3</OptionInput>
        <OptionInput value="nai-diffusion-furry-3">nai-diffusion-furry-3</OptionInput>
        <OptionInput value="nai-diffusion-2">nai-diffusion-2</OptionInput>
      </SelectInput>

      <span class="text-textcolor">Width</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={NAIImgConfigDraft.value.width} />
      <span class="text-textcolor">Height</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={NAIImgConfigDraft.value.height} />
      <span class="text-textcolor">Sampler</span>

      {#if NAIImgModelDraft.value === 'nai-diffusion-4-full' || NAIImgModelDraft.value === 'nai-diffusion-4-curated-preview' || NAIImgModelDraft.value === 'nai-diffusion-4-5-full' || NAIImgModelDraft.value === 'nai-diffusion-4-5-curated'}
        <SelectInput className="mb-4" bind:value={NAIImgConfigDraft.value.sampler}>
          <OptionInput value="k_euler_ancestral">Euler Ancestral</OptionInput>
          <OptionInput value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</OptionInput>
          <OptionInput value="k_dpmpp_2m_sde">DPM++ 2M SDE</OptionInput>
          <OptionInput value="k_euler">Euler</OptionInput>
          <OptionInput value="k_dpmpp_2m">DPM++ 2M</OptionInput>
          <OptionInput value="k_dpmpp_sde">DPM++ SDE</OptionInput>
        </SelectInput>
      {:else}
        <SelectInput className="mb-4" bind:value={NAIImgConfigDraft.value.sampler}>
          <OptionInput value="k_euler_ancestral">Euler Ancestral</OptionInput>
          <OptionInput value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</OptionInput>
          <OptionInput value="k_dpmpp_sde">DPM++ SDE</OptionInput>
          <OptionInput value="k_euler">Euler</OptionInput>
          <OptionInput value="k_dpmpp_2m">DPM++ 2M</OptionInput>
          <OptionInput value="k_dpmpp_2s">DPM++ 2S</OptionInput>
          <OptionInput value="ddim_v3">DDIM</OptionInput>
        </SelectInput>
      {/if}

      <span class="text-textcolor">Noise Schedule</span>
      <SelectInput className="mb-4" bind:value={NAIImgConfigDraft.value.noise_schedule}>
        <OptionInput value="native">native</OptionInput>
        <OptionInput value="karras">karras</OptionInput>
        <OptionInput value="exponential">exponential</OptionInput>
        <OptionInput value="polyexponential">polyexponential</OptionInput>
      </SelectInput>

      <span class="text-textcolor">steps</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={NAIImgConfigDraft.value.steps} />
      <span class="text-textcolor">CFG scale</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={NAIImgConfigDraft.value.scale} />
      <span class="text-textcolor">CFG rescale</span>
      <NumberInput size="sm" marginBottom min={0} max={1} bind:value={NAIImgConfigDraft.value.cfg_rescale} />

      <span class="text-textcolor">Image Reference</span>
      <SelectInput className="mb-4" bind:value={NAIImgConfigDraft.value.reference_mode}>
        <OptionInput value="">None</OptionInput>
        <OptionInput value="vibe">Vibe Trasfer</OptionInput>
        {#if NAIImgModelDraft.value === 'nai-diffusion-4-5-full' || NAIImgModelDraft.value === 'nai-diffusion-4-5-curated'}
          <OptionInput value="character">Character Reference</OptionInput>
        {/if}
      </SelectInput>

      {#if NAIImgConfigDraft.value.reference_mode === 'vibe'}
        <div class="relative">
          <button
            class="mb-4"
            onclick={async () => {
              const file = await selectSingleFile(['naiv4vibe'])
              if (!file) {
                return null
              }
              try {
                const vibeData = JSON.parse(new TextDecoder().decode(file.data))
                if (vibeData.version !== 1 || vibeData.identifier !== 'novelai-vibe-transfer') {
                  alertError('Invalid vibe file. Version must be 1.')
                  return
                }

                // Store the vibe data
                NAIImgConfigDraft.value.vibe_data = vibeData

                // Set the thumbnail as preview image for display
                if (vibeData.thumbnail) {
                  // Clear the array and add the thumbnail
                  NAIImgConfigDraft.value.reference_image_multiple = []

                  // Set default model selection based on current model
                  if (NAIImgModelDraft.value.includes('nai-diffusion-4-full')) {
                    NAIImgConfigDraft.value.vibe_model_selection = 'v4full'
                  } else if (NAIImgModelDraft.value.includes('nai-diffusion-4-curated')) {
                    NAIImgConfigDraft.value.vibe_model_selection = 'v4curated'
                  } else if (NAIImgModelDraft.value.includes('nai-diffusion-4-5-full')) {
                    NAIImgConfigDraft.value.vibe_model_selection = 'v4-5full'
                  } else if (NAIImgModelDraft.value.includes('nai-diffusion-4-5-curated')) {
                    NAIImgConfigDraft.value.vibe_model_selection = 'v4-5curated'
                  }

                  // Set InfoExtracted to the first value for the selected model
                  const selectedModel = NAIImgConfigDraft.value.vibe_model_selection
                  if (selectedModel && vibeData.encodings[selectedModel]) {
                    const encodings = vibeData.encodings[selectedModel]
                    const firstKey = Object.keys(encodings)[0]
                    if (firstKey) {
                      NAIImgConfigDraft.value.InfoExtracted = Number(encodings[firstKey].params.information_extracted)
                    }
                  }
                }

                // Initialize reference_strength_multiple if not set
                if (
                  !NAIImgConfigDraft.value.reference_strength_multiple ||
                  !Array.isArray(NAIImgConfigDraft.value.reference_strength_multiple)
                ) {
                  NAIImgConfigDraft.value.reference_strength_multiple = [0.7]
                }
              } catch (error) {
                alertError('Error parsing vibe file: ' + error)
              }
            }}>
            {#if !NAIImgConfigDraft.value.vibe_data || !NAIImgConfigDraft.value.vibe_data.thumbnail}
              <div
                class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                <span class="text-sm">Upload<br />Vibe</span>
              </div>
            {:else}
              <img
                src={NAIImgConfigDraft.value.vibe_data.thumbnail}
                alt="Vibe Preview"
                class="rounded-md h-40 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500" />
            {/if}
          </button>

          {#if NAIImgConfigDraft.value.vibe_data}
            <button
              onclick={() => {
                NAIImgConfigDraft.value.vibe_data = undefined
                NAIImgConfigDraft.value.vibe_model_selection = undefined
              }}
              class="absolute top-2 right-2 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-sm">
              Delete
            </button>
          {/if}
        </div>

        {#if NAIImgConfigDraft.value.vibe_data}
          <span class="text-textcolor">Vibe Model</span>
          <SelectInput
            className="mb-2"
            bind:value={NAIImgConfigDraft.value.vibe_model_selection}
            onchange={(e) => {
              // When vibe model changes, set InfoExtracted to the first value
              if (
                NAIImgConfigDraft.value.vibe_data?.encodings &&
                NAIImgConfigDraft.value.vibe_model_selection &&
                NAIImgConfigDraft.value.vibe_data.encodings[NAIImgConfigDraft.value.vibe_model_selection]
              ) {
                const encodings =
                  NAIImgConfigDraft.value.vibe_data.encodings[NAIImgConfigDraft.value.vibe_model_selection]
                const firstKey = Object.keys(encodings)[0]
                if (firstKey) {
                  NAIImgConfigDraft.value.InfoExtracted = Number(encodings[firstKey].params.information_extracted)
                }
              }
            }}>
            {#if NAIImgConfigDraft.value.vibe_data.encodings?.v4full}
              <OptionInput value="v4full">nai-diffusion-4-full</OptionInput>
            {/if}
            {#if NAIImgConfigDraft.value.vibe_data.encodings?.v4curated}
              <OptionInput value="v4curated">nai-diffusion-4-curated</OptionInput>
            {/if}
            {#if NAIImgConfigDraft.value.vibe_data.encodings?.['v4-5full']}
              <OptionInput value="v4-5full">nai-diffusion-4-5-full</OptionInput>
            {/if}
            {#if NAIImgConfigDraft.value.vibe_data.encodings?.['v4-5curated']}
              <OptionInput value="v4-5curated">nai-diffusion-4-5-curated</OptionInput>
            {/if}
          </SelectInput>

          <span class="text-textcolor">Information Extracted</span>
          <SelectInput className="mb-2" bind:value={NAIImgConfigDraft.value.InfoExtracted}>
            {#if getVibeEncodingEntries().length > 0}
              {#each getVibeEncodingEntries() as [key, value]}
                <OptionInput value={value.params.information_extracted}
                  >{value.params.information_extracted}</OptionInput>
              {/each}
            {/if}
          </SelectInput>

          <span class="text-textcolor">Reference Strength Multiple</span>
          <SliderInput
            marginBottom
            min={0}
            max={1}
            step={0.1}
            fixed={2}
            bind:value={NAIImgConfigDraft.value.reference_strength_multiple[0]} />
        {/if}
      {/if}

      {#if NAIImgConfigDraft.value.reference_mode === 'character' && (NAIImgModelDraft.value === 'nai-diffusion-4-5-full' || NAIImgModelDraft.value === 'nai-diffusion-4-5-curated')}
        <div class="relative">
          <button class="mb-2" onclick={uploadNaiCharacterReferenceImage}>
            {#if !NAIImgConfigDraft.value.character_image || NAIImgConfigDraft.value.character_image === ''}
              <div
                class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                <span class="text-sm">Upload<br />Image</span>
              </div>
            {:else}
              {#await getCharImage(NAIImgConfigDraft.value.character_image, 'plain')}
                <div
                  class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                  <span class="text-sm">Uploading<br />Image..</span>
                </div>
              {:then im}
                <img
                  src={im}
                  class="rounded-md h-40 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
                  alt="Base Preview" />
              {/await}
            {/if}
          </button>

          {#if NAIImgConfigDraft.value.character_image && NAIImgConfigDraft.value.character_image !== ''}
            <button
              onclick={() => {
                NAIImgConfigDraft.value.character_image = undefined
                NAIImgConfigDraft.value.character_base64image = undefined
              }}
              class="absolute top-2 right-2 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-sm">
              Delete
            </button>
          {/if}
        </div>

        <span class="text-textcolor2 text-xs mb-2 block">Leave blank to use the character's default image.</span>

        <Check className="mb-4" bind:check={NAIImgConfigDraft.value.style_aware} name="Style Aware" />
      {/if}

      {#if (NAIImgModelDraft.value === 'nai-diffusion-3' || NAIImgModelDraft.value === 'nai-diffusion-furry-3' || NAIImgModelDraft.value === 'nai-diffusion-2') && NAIImgConfigDraft.value.sampler !== 'ddim_v3'}
        <Check bind:check={NAIImgConfigDraft.value.sm} name="Use SMEA" />
      {/if}

      {#if NAIImgModelDraft.value === 'nai-diffusion-3' && NAIImgConfigDraft.value.sampler !== 'ddim_v3'}
        <Check bind:check={NAIImgConfigDraft.value.sm_dyn} name="Use DYN" />
      {/if}

      {#if NAIImgModelDraft.value === 'nai-diffusion-4-5-full' || NAIImgModelDraft.value === 'nai-diffusion-4-5-curated' || NAIImgModelDraft.value === 'nai-diffusion-4-full' || NAIImgModelDraft.value === 'nai-diffusion-4-curated-preview' || NAIImgModelDraft.value === 'nai-diffusion-3' || NAIImgModelDraft.value === 'nai-diffusion-furry-3'}
        <Check bind:check={NAIImgConfigDraft.value.variety_plus} name="Variety+" />
      {/if}

      {#if NAIImgModelDraft.value === 'nai-diffusion-3' || NAIImgModelDraft.value === 'nai-diffusion-furry-3' || NAIImgModelDraft.value === 'nai-diffusion-2'}
        <Check bind:check={NAIImgConfigDraft.value.decrisp} name="Decrisp" />
      {/if}

      {#if NAIImgModelDraft.value === 'nai-diffusion-4-full' || NAIImgModelDraft.value === 'nai-diffusion-4-curated-preview'}
        <Check bind:check={NAIImgConfigDraft.value.legacy_uc} name="Use legacy uc" />
      {/if}

      <Check className="mt-4 mb-4" bind:check={NAII2IDraft.value} name="Enable I2I" />

      {#if NAII2IDraft.value}
        <div class="relative">
          <button class="mb-2" onclick={uploadNaiI2IBaseImage}>
            {#if !NAIImgConfigDraft.value.image || NAIImgConfigDraft.value.image === ''}
              <div
                class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                <span class="text-sm">Upload<br />Image</span>
              </div>
            {:else}
              {#await getCharImage(NAIImgConfigDraft.value.image, 'plain')}
                <div
                  class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                  <span class="text-sm">Uploading<br />Image..</span>
                </div>
              {:then im}
                <img
                  src={im}
                  class="rounded-md h-40 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
                  alt="Base Preview" />
              {/await}
            {/if}
          </button>

          {#if NAIImgConfigDraft.value.image && NAIImgConfigDraft.value.image !== ''}
            <button
              onclick={() => {
                NAIImgConfigDraft.value.image = undefined
                NAIImgConfigDraft.value.base64image = undefined
              }}
              class="absolute top-2 right-2 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-sm">
              Delete
            </button>
          {/if}
        </div>
        <span class="text-textcolor2 text-xs block">Leave blank to use the character's default image.</span>

        <span class="text-textcolor mt-2">Strength</span>
        <SliderInput min={0} max={0.99} step={0.01} fixed={2} bind:value={NAIImgConfigDraft.value.strength} />
        <span class="text-textcolor mt-2">Noise</span>
        <SliderInput min={0} max={0.99} step={0.01} fixed={2} bind:value={NAIImgConfigDraft.value.noise} />
      {/if}
    {/if}

    {#if sdProviderDraft.value === 'dalle'}
      <span class="text-textcolor">OpenAI API Key</span>
      <TextInput hideText size="sm" marginBottom placeholder="sk-..." bind:value={openAIKeyDraft.value} />

      <span class="text-textcolor mt-4">Dall-E Quality</span>
      <SelectInput className="mt-2 mb-4" bind:value={dallEQualityDraft.value}>
        <OptionInput value="standard">Standard</OptionInput>
        <OptionInput value="hd">HD</OptionInput>
      </SelectInput>
    {/if}

    {#if sdProviderDraft.value === 'stability'}
      <span class="text-textcolor">Stability API Key</span>
      <TextInput hideText size="sm" marginBottom placeholder="..." bind:value={stabilityKeyDraft.value} />

      <span class="text-textcolor">Stability Model</span>
      <SelectInput className="mt-2 mb-4" bind:value={stabilityModelDraft.value}>
        <OptionInput value="ultra">SD Ultra</OptionInput>
        <OptionInput value="core">SD Core</OptionInput>
        <OptionInput value="sd3-large">SD3 Large</OptionInput>
        <OptionInput value="sd3-medium">SD3 Medium</OptionInput>
      </SelectInput>

      {#if stabilityModelDraft.value === 'core'}
        <span class="text-textcolor">SD Core Style</span>
        <SelectInput className="mt-2 mb-4" bind:value={stabllityStyleDraft.value}>
          <OptionInput value="">Unspecified</OptionInput>
          <OptionInput value="3d-model">3D Model</OptionInput>
          <OptionInput value="analog-film">Analog Film</OptionInput>
          <OptionInput value="anime">Anime</OptionInput>
          <OptionInput value="cinematic">Cinematic</OptionInput>
          <OptionInput value="comic-book">Comic Book</OptionInput>
          <OptionInput value="digital-art">Digital Art</OptionInput>
          <OptionInput value="enhance">Enhance</OptionInput>
          <OptionInput value="fantasy-art">Fantasy Art</OptionInput>
          <OptionInput value="isometric">Isometric</OptionInput>
          <OptionInput value="line-art">Line Art</OptionInput>
          <OptionInput value="low-poly">Low Poly</OptionInput>
          <OptionInput value="modeling-compound">Modeling Compound</OptionInput>
          <OptionInput value="neon-punk">Neon Punk</OptionInput>
          <OptionInput value="origami">Origami</OptionInput>
          <OptionInput value="photographic">Photographic</OptionInput>
          <OptionInput value="pixel-art">Pixel Art</OptionInput>
          <OptionInput value="tile-texture">Tile Texture</OptionInput>
        </SelectInput>
      {/if}
    {/if}

    {#if sdProviderDraft.value === 'comfyui'}
      <span class="text-textcolor mt-2">ComfyUI {language.providerURL}</span>
      <TextInput size="sm" marginBottom placeholder="http://127.0.0.1:8188" bind:value={comfyUiUrlDraft.value} />

      <span class="text-textcolor">Workflow <Help key="comfyWorkflow" /></span>
      <TextInput size="sm" marginBottom bind:value={comfyConfigDraft.value.workflow} />

      <span class="text-textcolor">Timeout (sec)</span>
      <NumberInput size="sm" marginBottom bind:value={comfyConfigDraft.value.timeout} min={1} max={120} />
    {/if}

    {#if sdProviderDraft.value === 'comfy'}
      <span class="text-draculared text-xs mb-2">The first image generated by the prompt will be selected. </span>
      <span class="text-draculared text-xs mb-2">"Please run comfyUI with --enable-cors-header."</span>
      <span class="text-textcolor mt-2">ComfyUI {language.providerURL}</span>
      <TextInput size="sm" marginBottom placeholder="http://127.0.0.1:8188" bind:value={comfyUiUrlDraft.value} />
      <span class="text-textcolor">Workflow</span>
      <TextInput
        size="sm"
        marginBottom
        placeholder="valid ComfyUI API json (Enable Dev mode Options in ComfyUI)"
        bind:value={comfyConfigDraft.value.workflow} />

      <span class="text-textcolor">Positive Text Node: ID</span>
      <TextInput size="sm" marginBottom placeholder="eg. 1, 3, etc" bind:value={comfyConfigDraft.value.posNodeID} />
      <span class="text-textcolor">Positive Text Node: Input Field Name</span>
      <TextInput size="sm" marginBottom placeholder="eg. text" bind:value={comfyConfigDraft.value.posInputName} />
      <span class="text-textcolor">Negative Text Node: ID</span>
      <TextInput size="sm" marginBottom placeholder="eg. 1, 3, etc" bind:value={comfyConfigDraft.value.negNodeID} />
      <span class="text-textcolor">Positive Text Node: Input Field Name</span>
      <TextInput size="sm" marginBottom placeholder="eg. text" bind:value={comfyConfigDraft.value.negInputName} />
      <span class="text-textcolor">Timeout (sec)</span>
      <NumberInput size="sm" marginBottom bind:value={comfyConfigDraft.value.timeout} min={1} max={120} />
    {/if}

    {#if sdProviderDraft.value === 'fal'}
      <span class="text-textcolor">Fal.ai API Key</span>
      <TextInput hideText size="sm" marginBottom placeholder="..." bind:value={falTokenDraft.value} />

      <span class="text-textcolor mt-4">Width</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={sdConfigDraft.value.width} />
      <span class="text-textcolor mt-4">Height</span>
      <NumberInput size="sm" marginBottom min={0} max={2048} bind:value={sdConfigDraft.value.height} />

      <span class="text-textcolor mt-4">Model</span>
      <SelectInput className="mt-2" bind:value={falModelDraft.value}>
        <OptionInput value="fal-ai/flux/dev">Flux[Dev]</OptionInput>
        <OptionInput value="fal-ai/flux-lora">Flux[Dev] with Lora</OptionInput>
        <OptionInput value="fal-ai/flux-pro">Flux[Pro]</OptionInput>
        <OptionInput value="fal-ai/flux/schnell">Flux[Schnell]</OptionInput>
      </SelectInput>

      {#if falModelDraft.value === 'fal-ai/flux-lora'}
        <span class="text-textcolor mt-4">Lora Model URL <Help key="urllora" /></span>
        <TextInput size="sm" marginBottom bind:value={falLoraDraft.value} />

        <span class="text-textcolor mt-4">Lora Weight</span>
        <SliderInput fixed={2} min={0} max={2} step={0.01} bind:value={falLoraScaleDraft.value} />
      {/if}
    {/if}

    {#if sdProviderDraft.value === 'Imagen'}
      <span class="text-textcolor mt-2">GoogleAI API Key</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        hideText
        bind:value={googleDraft.value.accessToken} />

      <span class="text-textcolor">Model</span>
      <SelectInput className="mb-4" bind:value={ImagenModelDraft.value}>
        <OptionInput value="imagen-4.0-generate-001">Imagen 4</OptionInput>
        <OptionInput value="imagen-4.0-ultra-generate-001">Imagen 4 Ultra</OptionInput>
        <OptionInput value="imagen-4.0-fast-generate-001">Imagen 4 Fast</OptionInput>
        <OptionInput value="imagen-3.0-generate-002">Imagen 3.0</OptionInput>
      </SelectInput>

      {#if ImagenModelDraft.value === 'imagen-4.0-generate-001' || ImagenModelDraft.value === 'imagen-4.0-ultra-generate-001'}
        <span class="text-textcolor">Image size</span>
        <SelectInput className="mb-4" bind:value={ImagenImageSizeDraft.value}>
          <OptionInput value="1K">1K</OptionInput>
          <OptionInput value="2K">2K</OptionInput>
        </SelectInput>
      {/if}

      <span class="text-textcolor">Aspect ratio</span>
      <SelectInput className="mb-4" bind:value={ImagenAspectRatioDraft.value}>
        <OptionInput value="1:1">1:1</OptionInput>
        <OptionInput value="3:4">3:4</OptionInput>
        <OptionInput value="4:3">4:3</OptionInput>
        <OptionInput value="9:16">9:16</OptionInput>
        <OptionInput value="16:9">16:9</OptionInput>
      </SelectInput>

      <span class="text-textcolor">Person generation</span>
      <SelectInput className="mb-4" bind:value={ImagenPersonGenerationDraft.value}>
        <OptionInput value="allow_all">Allow all</OptionInput>
        <OptionInput value="allow_adult">Allow adult</OptionInput>
        <OptionInput value="dont_allow">Don't allow</OptionInput>
      </SelectInput>
    {/if}

    {#if sdProviderDraft.value === 'openai-compat'}
      <span class="text-textcolor mt-2">API URL</span>
      <TextInput
        size="sm"
        marginBottom
        placeholder="https://api.example.com/v1/images/generations"
        bind:value={openaiCompatImageDraft.value.url} />

      <span class="text-textcolor">API Key</span>
      <TextInput size="sm" marginBottom placeholder="sk-..." hideText bind:value={openaiCompatImageDraft.value.key} />

      <span class="text-textcolor">Model</span>
      <TextInput size="sm" marginBottom placeholder="dall-e-3" bind:value={openaiCompatImageDraft.value.model} />

      <span class="text-textcolor">Image Size</span>
      <SelectInput className="mb-4" bind:value={openaiCompatImageDraft.value.size}>
        <OptionInput value="1024x1024">1024x1024</OptionInput>
        <OptionInput value="1536x1024">1536x1024</OptionInput>
        <OptionInput value="1024x1536">1024x1536</OptionInput>
        <OptionInput value="512x512">512x512</OptionInput>
        <OptionInput value="256x256">256x256</OptionInput>
      </SelectInput>

      <span class="text-textcolor">Quality</span>
      <SelectInput className="mb-4" bind:value={openaiCompatImageDraft.value.quality}>
        <OptionInput value="auto">Auto</OptionInput>
        <OptionInput value="low">Low</OptionInput>
        <OptionInput value="medium">Medium</OptionInput>
        <OptionInput value="high">High</OptionInput>
      </SelectInput>
    {/if}

    {#if sdProviderDraft.value === 'wavespeed'}
      <span class="text-textcolor">API Key</span>
      <TextInput size="sm" marginBottom placeholder="sk-..." hideText bind:value={wavespeedImageDraft.value.key} />

      <span class="text-textcolor">Model</span>
      <button
        class="px-3 py-2 bg-darkbutton rounded-md hover:bg-textcolor2 transition-colors disabled:opacity-50"
        disabled={isWavespeedLoading}
        onclick={fetchWavespeedModels}>
        {isWavespeedLoading ? 'Loading...' : 'Refresh Models'}
      </button>
      <TextInput bind:value={wavespeedSearchQuery} placeholder="Search models..." size="sm" marginBottom />
      <SelectInput className="mb-4" bind:value={wavespeedImageDraft.value.model} onchange={handleModelChange}>
        <OptionInput value="">Select a model...</OptionInput>
        {#if wavespeedModels.length > 0}
          {#each getFilteredModels() as model}
            <OptionInput value={model.model_id}>
              {getModelDisplayName(model)}
            </OptionInput>
          {/each}
        {:else if wavespeedImageDraft.value.model}
          <OptionInput value={wavespeedImageDraft.value.model}>
            {wavespeedImageDraft.value.model}
          </OptionInput>
        {/if}
      </SelectInput>

      <span class="text-textcolor mt-4">LoRAs</span>
      {#if wavespeedModels.find((m) => m.model_id === wavespeedImageDraft.value.model)?.supportsLoras}
        {#each wavespeedLoras as lora, index}
          <TextInput
            size="sm"
            marginBottom
            marginTop
            placeholder={`LoRA ${index + 1} URL (optional)`}
            bind:value={lora.path} />
          <SliderInput marginBottom min={0} max={4} step={0.1} fixed={1} bind:value={lora.scale} />
        {/each}
        <span class="text-textcolor2 text-xs mb-2 block">
          Only .safetensors files are supported. Use owner/model-name (Hugging Face) or direct URL (Civitai).
        </span>
      {:else}
        <span class="text-textcolor2 text-xs mb-2 block">
          Model does not support LoRA. Or refresh model list to update model status.
        </span>
      {/if}

      <span class="text-textcolor">Image Reference</span>
      {#if wavespeedModels.find((m) => m.model_id === wavespeedImageDraft.value.model)?.supportsImageInput}
        <SelectInput className="mb-4" bind:value={wavespeedImageDraft.value.reference_mode}>
          <OptionInput value="">None</OptionInput>
          <OptionInput value="image">Upload Image</OptionInput>
          <OptionInput value="character">Use Character Image</OptionInput>
        </SelectInput>

        {#if wavespeedImageDraft.value.reference_mode === 'image'}
          <div class="relative">
            <button class="mb-2" onclick={uploadWavespeedReferenceImage}>
              {#if !wavespeedImageDraft.value.reference_image || wavespeedImageDraft.value.reference_image === ''}
                <div
                  class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                  <span class="text-sm">Upload<br />Image</span>
                </div>
              {:else}
                {#await getCharImage(wavespeedImageDraft.value.reference_image, 'plain')}
                  <div
                    class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500 flex items-center justify-center">
                    <span class="text-sm">Uploading<br />Image..</span>
                  </div>
                {:then im}
                  <img
                    src={im}
                    class="rounded-md h-40 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
                    alt="Base Preview" />
                {/await}
              {/if}
            </button>

            {#if wavespeedImageDraft.value.reference_image && wavespeedImageDraft.value.reference_image !== ''}
              <button
                onclick={() => {
                  wavespeedImageDraft.value.reference_image = undefined
                  wavespeedImageDraft.value.reference_base64image = undefined
                }}
                class="absolute top-2 right-2 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-sm">
                Delete
              </button>
            {/if}
          </div>
        {/if}
        {#if wavespeedImageDraft.value.reference_mode === 'character'}
          <span class="text-textcolor2 text-xs mb-2 block">Use the character's default image.</span>
        {/if}
      {:else}
        <span class="text-textcolor2 text-xs mb-2 block">
          Model does not support image input. Or refresh model list to update model status.
        </span>
      {/if}
    {/if}
  </Accordion>
{/if}

{#if submenu === 1 || submenu === -1}
  <Accordion name="TTS" styled disabled={submenu !== -1}>
    <span class="text-textcolor mt-2">Auto Speech</span>
    <CheckInput bind:check={ttsAutoSpeechDraft.value} />

    <span class="text-textcolor mt-2">ElevenLabs API key</span>
    <TextInput hideText size="sm" marginBottom bind:value={elevenLabKeyDraft.value} />

    <span class="text-textcolor mt-2">VOICEVOX URL</span>
    <TextInput size="sm" marginBottom bind:value={voicevoxUrlDraft.value} />

    <span class="text-textcolor">OpenAI Key</span>
    <TextInput hideText size="sm" marginBottom bind:value={openAIKeyDraft.value} />

    <span class="text-textcolor mt-2">NovelAI API key</span>
    <TextInput hideText size="sm" marginBottom placeholder="pst-..." bind:value={NAIApiKeyDraft.value} />

    <span class="text-textcolor">Huggingface Key</span>
    <TextInput hideText size="sm" marginBottom bind:value={huggingfaceKeyDraft.value} placeholder="hf_..." />

    <span class="text-textcolor">fish-speech API Key</span>
    <TextInput hideText size="sm" marginBottom bind:value={fishSpeechKeyDraft.value} />
  </Accordion>
{/if}

{#if submenu === 2 || submenu === -1}
  <Accordion name={language.emotionImage} styled disabled={submenu !== -1}>
    <span class="text-textcolor mt-2">{language.emotionMethod}</span>

    <SelectInput className="mt-2 mb-4" bind:value={emotionProcesserDraft.value}>
      <OptionInput value="submodel">Ax. Model</OptionInput>
      <OptionInput value="embedding">MiniLM-L6-v2</OptionInput>
    </SelectInput>
  </Accordion>
{/if}

{#if submenu === 0 || submenu === -1}
  <Accordion name={language.longTermMemory} styled disabled={submenu !== -1}>
    <div class="flex mb-4">
      <Check bind:check={hypaV3Draft.value} name="{language.HypaMemory} V3" />
    </div>

    {#if hypaV3Draft.value}
      <span class="max-w-full mb-6 text-sm text-wrap wrap-break-word text-textcolor2"
        >{language.hypaV3Settings.descriptionLabel}</span>
      <span class="text-textcolor">Preset</span>
      <select
        class={'border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200 text-md px-4 py-2 mb-1'}
        bind:value={hypaV3PresetIdDraft.value}>
        {#each hypaV3PresetsDraft.value as preset, i}
          <option class="bg-darkbg appearance-none" value={i}>{preset.name}</option>
        {/each}
      </select>

      <div class="flex items-center mb-8">
        <button
          class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={() => {
            const newPreset = createHypaV3Preset()
            const presets = [...hypaV3PresetsDraft.value]

            presets.push(newPreset)
            hypaV3PresetsDraft.value = presets
            hypaV3PresetIdDraft.value = presets.length - 1
          }}>
          <PlusIcon size={24} />
        </button>

        <button
          class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={async () => {
            const presets = [...hypaV3PresetsDraft.value]

            if (presets.length === 0) {
              alertError('There must be least one preset.')
              return
            }

            const id = hypaV3PresetIdDraft.value
            const preset = presets[id]
            const newName = await alertInput(`Enter new name for ${preset.name}`, [], preset.name)

            if (!newName || newName.trim().length === 0) return

            presets[id] = { ...preset, name: newName }
            hypaV3PresetsDraft.value = presets
          }}>
          <PencilIcon size={24} />
        </button>

        <button
          class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={async (e) => {
            const presets = [...hypaV3PresetsDraft.value]

            if (presets.length <= 1) {
              alertError('There must be least one preset.')
              return
            }

            const id = hypaV3PresetIdDraft.value
            const preset = presets[id]
            const confirmed = await alertConfirm(`${language.removeConfirm}${preset.name}`)

            if (!confirmed) return

            presets.splice(id, 1)
            hypaV3PresetIdDraft.value = 0
            hypaV3PresetsDraft.value = presets
          }}>
          <TrashIcon size={24} />
        </button>

        <div class="ml-2 mr-4 w-px h-full bg-darkborderc"></div>

        <button
          class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={async () => {
            try {
              const presets = hypaV3PresetsDraft.value

              if (presets.length === 0) {
                alertError('There must be least one preset.')
                return
              }

              const id = hypaV3PresetIdDraft.value
              const preset = presets[id]
              const bytesExport = Buffer.from(
                JSON.stringify({
                  type: 'risu',
                  ver: 1,
                  data: preset,
                }),
                'utf-8',
              )

              await downloadFile(`hypaV3_export_${preset.name}.json`, bytesExport)
              alertNormal(language.successExport)
            } catch (error) {
              alertError(`${error}`)
            }
          }}>
          <DownloadIcon size={24} />
        </button>

        <button
          class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={async () => {
            try {
              const bytesImport = (await selectSingleFile(['json'])).data

              if (!bytesImport) return

              const objImport = JSON.parse(Buffer.from(bytesImport).toString('utf-8'))

              if (objImport.type !== 'risu' || !objImport.data) return

              const newPreset = createHypaV3Preset(
                objImport.data.name || 'Imported Preset',
                objImport.data.settings || {},
              )
              const presets = [...hypaV3PresetsDraft.value]

              presets.push(newPreset)
              hypaV3PresetsDraft.value = presets
              hypaV3PresetIdDraft.value = presets.length - 1

              alertNormal(language.successImport)
            } catch (error) {
              alertError(`${error}`)
            }
          }}>
          <HardDriveUploadIcon size={24} />
        </button>
      </div>

      {#if hypaV3PresetsDraft.value?.[hypaV3PresetIdDraft.value]?.settings}
        {@const settings = hypaV3PresetsDraft.value[hypaV3PresetIdDraft.value].settings}

        <span class="text-textcolor">{language.SuperMemory} {language.model}</span>
        <SelectInput className="mb-4" bind:value={settings.summarizationModel}>
          <OptionInput value="subModel">{language.submodel}</OptionInput>
          {#if 'gpu' in navigator}
            <OptionInput value="Qwen3-1.7B-q4f32_1-MLC">Qwen3 1.7B (GPU)</OptionInput>
            <OptionInput value="Qwen3-4B-q4f32_1-MLC">Qwen3 4B (GPU)</OptionInput>
            <OptionInput value="Qwen3-8B-q4f32_1-MLC">Qwen3 8B (GPU)</OptionInput>
          {/if}
        </SelectInput>
        <span class="text-textcolor">{language.summarizationPrompt} <Help key="summarizationPrompt" /></span>
        <div class="mb-4">
          <TextAreaInput
            size="sm"
            placeholder={language.hypaV3Settings.supaMemoryPromptPlaceHolder}
            bind:value={settings.summarizationPrompt} />
        </div>
        <span class="text-textcolor">{language.reSummarizationPrompt} <Help key="reSummarizationPrompt" /></span>
        <div class="mb-4">
          <TextAreaInput
            size="sm"
            placeholder={language.hypaV3Settings.supaMemoryPromptPlaceHolder}
            bind:value={settings.reSummarizationPrompt} />
        </div>
        {#await getMaxMemoryRatio() then maxMemoryRatio}
          <span class="text-textcolor">{language.hypaV3Settings.maxMemoryTokensRatioLabel}</span>
          <NumberInput marginBottom disabled size="sm" value={maxMemoryRatio} />
        {:catch error}
          <span class="mb-4 text-red-400">{language.hypaV3Settings.maxMemoryTokensRatioError}</span>
        {/await}
        <span class="text-textcolor"
          >{language.hypaV3Settings.memoryTokensRatioLabel}
          <Help key="hypaV3MemoryTokensRatio" /></span>
        <SliderInput marginBottom min={0} max={1} step={0.01} fixed={2} bind:value={settings.memoryTokensRatio} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.extraSummarizationRatioLabel}
          <Help key="hypaV3ExtraSummarizationRatio" /></span>
        <SliderInput
          marginBottom
          min={0}
          max={1 - settings.memoryTokensRatio}
          step={0.01}
          fixed={2}
          bind:value={settings.extraSummarizationRatio} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.maxChatsPerSummaryLabel}
          <Help key="hypaV3MaxChatsPerSummary" /></span>
        <NumberInput marginBottom size="sm" min={1} bind:value={settings.maxChatsPerSummary} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.queryChatCountLabel} <Help key="hypaV3QueryChatCount" /></span>
        <NumberInput marginBottom size="sm" min={1} max={20} bind:value={settings.queryChatCount} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.summaryChunkSeparatorLabel}
          <Help key="hypaV3SummaryChunkSeparator" /></span>
        <TextInput marginBottom size="sm" bind:value={settings.summaryChunkSeparator} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.recentMemoryRatioLabel}
          <Help key="hypaV3RecentMemoryRatio" /></span>
        <SliderInput marginBottom min={0} max={1} step={0.01} fixed={2} bind:value={settings.recentMemoryRatio} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.similarMemoryRatioLabel}
          <Help key="hypaV3SimilarMemoryRatio" /></span>
        <SliderInput marginBottom min={0} max={1} step={0.01} fixed={2} bind:value={settings.similarMemoryRatio} />
        <span class="text-textcolor"
          >{language.hypaV3Settings.randomMemoryRatioLabel}
          <Help key="hypaV3RandomMemoryRatio" /></span>
        <NumberInput
          marginBottom
          disabled
          size="sm"
          value={parseFloat((1 - settings.recentMemoryRatio - settings.similarMemoryRatio).toFixed(2))} />
        <div class="mb-2 flex items-center">
          <Check
            name={language.hypaV3Settings.preserveOrphanedMemoryLabel}
            bind:check={settings.preserveOrphanedMemory} />
          <Help key="hypaV3PreserveOrphanedMemory" />
        </div>
        <div class="mb-2 flex items-center">
          <Check
            name={language.hypaV3Settings.applyRegexScriptWhenRerollingLabel}
            bind:check={settings.processRegexScript} />
          <Help key="hypaV3ProcessRegexScript" />
        </div>
        <div class="mb-2 flex items-center">
          <Check
            name={language.hypaV3Settings.doNotSummarizeUserMessageLabel}
            bind:check={settings.doNotSummarizeUserMessage} />
          <Help key="hypaV3DoNotSummarizeUserMessage" />
        </div>
        <Accordion name="Advanced Settings" styled>
          <div class="mb-2 flex items-center">
            <Check name="Use Experimental Implementation" bind:check={settings.useExperimentalImpl} />
            <Help key="hypaV3UseExperimentalImpl" />
          </div>
          <div class="mb-2 flex items-center">
            <Check name="Always Toggle On" bind:check={settings.alwaysToggleOn} />
            <Help key="hypaV3AlwaysToggleOn" />
          </div>
          {#if settings.useExperimentalImpl}
            <span class="text-textcolor"
              >Summarization Requests Per Minute <Help key="hypaV3SummarizationRequestsPerMinute" /></span>
            <NumberInput marginBottom size="sm" min={1} bind:value={settings.summarizationRequestsPerMinute} />
            <span class="text-textcolor"
              >Summarization Max Concurrent <Help key="hypaV3SummarizationMaxConcurrent" /></span>
            <NumberInput marginBottom size="sm" min={1} max={10} bind:value={settings.summarizationMaxConcurrent} />
            <span class="text-textcolor"
              >Embedding Requests Per Minute <Help key="hypaV3EmbeddingRequestsPerMinute" /></span>
            <NumberInput marginBottom size="sm" min={1} bind:value={settings.embeddingRequestsPerMinute} />
            <span class="text-textcolor">Embedding Max Concurrent <Help key="hypaV3EmbeddingMaxConcurrent" /></span>
            <NumberInput marginBottom size="sm" min={1} max={10} bind:value={settings.embeddingMaxConcurrent} />
          {:else}
            <div class="mb-2 flex items-center">
              <Check
                name={language.hypaV3Settings.enableSimilarityCorrectionLabel}
                bind:check={settings.enableSimilarityCorrection} />
              <Help key="hypaV3EnableSimilarityCorrection" />
            </div>
          {/if}
        </Accordion>
      {/if}

      <div class="mb-8"></div>
    {/if}

    <span class="text-textcolor">{language.embedding} <Help key="embedding" /></span>
    <SelectInput className="mb-4" bind:value={hypaModelDraft.value}>
      {#if 'gpu' in navigator}
        <OptionInput value="MiniLMGPU">MiniLM L6 v2 (GPU)</OptionInput>
        <OptionInput value="nomicGPU">Nomic Embed Text v1.5 (GPU)</OptionInput>
        <OptionInput value="bgeSmallEnGPU">BGE Small English (GPU)</OptionInput>
        <OptionInput value="bgem3GPU">BGE Medium 3 (GPU)</OptionInput>
        <OptionInput value="multiMiniLMGPU">Multilingual MiniLM L12 v2 (GPU)</OptionInput>
        <OptionInput value="bgeM3KoGPU">BGE Medium 3 Korean (GPU)</OptionInput>
      {/if}
      <OptionInput value="MiniLM">MiniLM L6 v2 (CPU)</OptionInput>
      <OptionInput value="nomic">Nomic Embed Text v1.5 (CPU)</OptionInput>
      <OptionInput value="bgeSmallEn">BGE Small English (CPU)</OptionInput>
      <OptionInput value="bgem3">BGE Medium 3 (CPU)</OptionInput>
      <OptionInput value="multiMiniLM">Multilingual MiniLM L12 v2 (CPU)</OptionInput>
      <OptionInput value="bgeM3Ko">BGE Medium 3 Korean (CPU)</OptionInput>
      <OptionInput value="openai3small">OpenAI text-embedding-3-small</OptionInput>
      <OptionInput value="openai3large">OpenAI text-embedding-3-large</OptionInput>
      <OptionInput value="ada">OpenAI Ada</OptionInput>
      <OptionInput value="voyageContext3">Voyage Context 3</OptionInput>
      <OptionInput value="custom">Custom (OpenAI-compatible)</OptionInput>
    </SelectInput>

    {#if hypaModelDraft.value === 'openai3small' || hypaModelDraft.value === 'openai3large' || hypaModelDraft.value === 'ada'}
      <span class="text-textcolor">OpenAI API Key</span>
      <TextInput hideText size="sm" marginBottom bind:value={hypaV3KeyDraft.value} />
    {/if}

    {#if hypaModelDraft.value === 'custom'}
      <span class="text-textcolor">URL</span>
      <TextInput size="sm" marginBottom bind:value={hypaCustomSettingsDraft.value.url} />
      <span class="text-textcolor">Key/Password</span>
      <TextInput hideText size="sm" marginBottom bind:value={hypaCustomSettingsDraft.value.key} />
      <span class="text-textcolor">Request Model</span>
      <TextInput size="sm" marginBottom bind:value={hypaCustomSettingsDraft.value.model} />
    {/if}

    {#if hypaModelDraft.value === 'voyageContext3'}
      <span class="text-textcolor">Voyage API Key</span>
      <TextInput size="sm" marginBottom hideText bind:value={voyageApiKeyDraft.value} />
    {/if}
  </Accordion>
{/if}
