<script lang="ts">
  import {
    alertGenerationInfoStore,
    cardExportCancelMessage,
    resolveAlertConfirmation,
    resolveAlertInput,
    resolveAlertSelection,
    resolveAlertWorkflow,
    type AlertGenerationInfoStoreData,
    type alertData,
  } from '../../ts/alert'

  import { getCharImage } from '../../ts/characters'
  import { ParseMarkdown } from '../../ts/parser/parser.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { ChevronRightIcon, User } from '@lucide/svelte'
  import { hubURL, isCharacterHasAssets } from 'src/ts/characterCards'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { aiLawApplies, openURL, getFetchLogs } from 'src/ts/globalApi.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { XIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from '@lucide/svelte'
  import hljs from 'highlight.js/lib/core'
  import json from 'highlight.js/lib/languages/json'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import { language } from 'src/lang'
  import { getFetchData } from 'src/ts/globalApi.svelte'
  import { alertStore, selectedCharID } from 'src/ts/stores.svelte'
  import { tokenize } from 'src/ts/tokenizer'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import ModuleChatMenu from '../Setting/Pages/Module/ModuleChatMenu.svelte'
  import { ColorSchemeTypeStore } from 'src/ts/gui/colorscheme'
  import Help from './Help.svelte'
  import { getChatBranches } from 'src/ts/gui/branches'
  import { getCurrentCharacter, getDatabase, type Message } from 'src/ts/storage/database.svelte'
  import { translateStackTrace } from '../../ts/sourcemap'
  import { getDetailedOSLabel, getFallbackOSLabel, getRisuEnvironmentLabel } from 'src/ts/platform'
  import versionData from '../../../version.json'
  import { normalizeMessagePromptInfo } from './alertPromptInfo'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { isTrustedLoginMessageOrigin } from 'src/ts/gui/loginMessageOrigin'

  let showDetails = $state(false)
  let translatedStackTrace = $state('')
  let stackTraceTranslationFailed = $state(false)
  let isTranslating = $state(false)
  let stackTraceTranslationRun = 0
  let osLabel = $state(getFallbackOSLabel())
  const displayedStackTrace = $derived(translatedStackTrace || $alertStore.stackTrace || '')
  const risuVersion = versionData.version
  const risuEnvironment = getRisuEnvironmentLabel()
  const userAgent = typeof navigator === 'undefined' ? 'Unknown' : navigator.userAgent || 'Unknown'
  const stackTraceCodeBlock = $derived.by(() => {
    const lines = [
      `Risu version: ${risuVersion}`,
      `OS: ${osLabel}`,
      `User-Agent: ${userAgent}`,
      `Risu environment: ${risuEnvironment}`,
    ]

    if (stackTraceTranslationFailed) {
      lines.push(language.stackTraceTranslationFailed)
    } else if (isTranslating) {
      lines.push(language.translating)
    }

    if (displayedStackTrace) {
      lines.push('', displayedStackTrace)
    }

    return lines.join('\n')
  })
  function resolveGenerationMessage(
    info: AlertGenerationInfoStoreData,
  ): { message: Message; index: number } | undefined {
    const characters = getDatabase().characters ?? []
    const character = info.characterId
      ? characters.find((candidate) => candidate.chaId === info.characterId)
      : characters[$selectedCharID]
    const chat = info.chatId
      ? character?.chats?.find((candidate) => candidate.id === info.chatId)
      : character?.chats?.[character.chatPage]
    const messages = chat?.message ?? []
    if (info.messageId) {
      const index = messages.findIndex((message) => message.chatId === info.messageId)
      if (index >= 0) return { message: messages[index], index }
    }
    const generationId = info.genInfo.generationId
    if (generationId) {
      const index = messages.findIndex(
        (message) => message.generationInfo?.generationId === generationId || message.chatId === generationId,
      )
      if (index >= 0) return { message: messages[index], index }
    }
    if (!info.messageId && !generationId && messages[info.idx]) {
      return { message: messages[info.idx], index: info.idx }
    }
    return undefined
  }
  const generationMessageTarget = $derived.by(() => {
    const info = $alertGenerationInfoStore
    if (!info) return undefined
    return resolveGenerationMessage(info)
  })
  const generationMessage = $derived(generationMessageTarget?.message)
  const promptInfoView = $derived.by(() => normalizeMessagePromptInfo(generationMessage))
  const alertDialogRole = $derived(
    $alertStore.type === 'error' || $alertStore.type === 'ask' || $alertStore.type === 'pluginconfirm'
      ? 'alertdialog'
      : 'dialog',
  )
  const alertDialogTitle = $derived.by(() => {
    if ($alertStore.title) return $alertStore.title
    if ($alertStore.type === 'error') return language.error
    if ($alertStore.type === 'ask') return language.confirm
    if ($alertStore.type === 'pluginconfirm') return language.pluginImport
    if ($alertStore.type === 'select') return language.select
    if ($alertStore.type === 'selectChar') return language.select
    if ($alertStore.type === 'input') return language.input
    if ($alertStore.type === 'tos') return language.termsOfService
    return $alertStore.msg || 'Risuai'
  })

  let alertInputElement: HTMLInputElement | undefined = $state()
  let cardExportType = $state('')
  let cardExportType2 = $state('')
  let generationInfoMenuIndex = $state(0)
  type BranchNode = ReturnType<typeof getChatBranches>[number]
  type BranchDetails = {
    id: string
    x: number
    y: number
    content: string
  }

  let branchHover: BranchDetails | null = $state(null)
  let branchFocusedDetails: BranchDetails | null = $state(null)
  let branchPointerFocusPending = false
  const branchGraph = $derived.by(() => {
    if ($alertStore.type !== 'branches' || $selectedCharID < 0) return []
    return getChatBranches()
  })
  let expandedLogs: Set<number> = $state(new Set())
  let allExpanded = $state(false)
  let copiedKey: string | null = $state(null)

  // Register JSON language for syntax highlighting
  if (!hljs.getLanguage('json')) {
    hljs.registerLanguage('json', json)
  }

  $effect(() => {
    void loadDetailedOSLabel()
  })

  function highlightJson(code: string): string {
    try {
      return hljs.highlight(code, { language: 'json' }).value
    } catch {
      return code.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    copiedKey = key
    setTimeout(() => {
      if (copiedKey === key) copiedKey = null
    }, 1500)
  }

  async function loadDetailedOSLabel() {
    try {
      osLabel = await getDetailedOSLabel()
    } catch (error) {
      console.warn('Failed to load detailed OS information:', error)
    }
  }

  function getBranchDetails(obj: BranchNode, index: number): BranchDetails {
    const char = getCurrentCharacter()
    const chat = char?.chats?.[obj.chatId]
    const content =
      obj.y === 0
        ? chat?.fmIndex === -1
          ? (char?.firstMessage ?? '')
          : (char?.alternateGreetings?.[chat?.fmIndex ?? 0] ?? '')
        : (chat?.message?.[obj.y - 1]?.data ?? '')

    return {
      id: `risu-branch-details-${index}`,
      x: obj.x,
      y: obj.y,
      content,
    }
  }

  function showBranchDetails(obj: BranchNode, index: number) {
    branchHover = getBranchDetails(obj, index)
  }

  $effect.pre(() => {
    $alertStore
    stackTraceTranslationRun += 1
    showDetails = false
    translatedStackTrace = ''
    stackTraceTranslationFailed = false
    isTranslating = false
    if ($alertStore.type !== 'branches') {
      branchHover = null
      branchFocusedDetails = null
      branchPointerFocusPending = false
    }
    if ($alertStore.type !== 'cardexport') {
      cardExportType = ''
      cardExportType2 = ''
    }
    if ($alertStore.type !== 'requestlogs') {
      expandedLogs = new Set()
      allExpanded = false
    }
  })

  $effect(() => {
    if ($alertStore.type === 'input' && alertInputElement) {
      alertInputElement.focus()
      alertInputElement.select()
    }
  })

  $effect(() => {
    const sourceStackTrace = $alertStore.stackTrace
    if (
      $alertStore.type === 'error' &&
      sourceStackTrace &&
      !translatedStackTrace &&
      !stackTraceTranslationFailed &&
      !isTranslating
    ) {
      const run = ++stackTraceTranslationRun
      void loadTranslatedTrace(sourceStackTrace, run)
    }
  })

  function isCurrentStackTraceTranslation(sourceStackTrace: string, run: number) {
    return (
      run === stackTraceTranslationRun && $alertStore.type === 'error' && $alertStore.stackTrace === sourceStackTrace
    )
  }

  async function loadTranslatedTrace(sourceStackTrace: string, run: number) {
    isTranslating = true
    try {
      const result = await translateStackTrace(sourceStackTrace)
      if (!isCurrentStackTraceTranslation(sourceStackTrace, run)) return
      if (result.didTranslate) {
        translatedStackTrace = result.stackTrace
      } else {
        stackTraceTranslationFailed = true
      }
    } catch (e) {
      if (!isCurrentStackTraceTranslation(sourceStackTrace, run)) return
      console.error('Failed to translate stack trace:', e)
      stackTraceTranslationFailed = true
    } finally {
      if (isCurrentStackTraceTranslation(sourceStackTrace, run)) {
        isTranslating = false
      }
    }
  }

  const beautifyJSON = (data: string) => {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch (error) {
      return data
    }
  }

  function readProgressPercent(data: alertData) {
    if (data.progress === null) {
      return 100
    }

    const progress = typeof data.progress === 'number' ? data.progress : Number(data.submsg)
    if (!Number.isFinite(progress)) {
      return 0
    }

    return Math.max(0, Math.min(100, progress))
  }

  function readProgressLabel(data: alertData, percent: number) {
    if (data.progress === null) {
      return 'Working'
    }

    const rounded = Math.round(percent * 100) / 100
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}%`
  }

  function readProgressDetail(data: alertData) {
    if (!data.submsg) {
      return ''
    }

    if (data.progress === undefined && Number.isFinite(Number(data.submsg))) {
      return ''
    }

    return data.submsg
  }

  function cancelCardExport(owner: alertData['dialogOwner']) {
    resolveAlertWorkflow(owner, cardExportCancelMessage(cardExportType2))
  }

  function closeInputAlert(owner: alertData['dialogOwner'], value: string) {
    resolveAlertInput(owner, value)
  }

  function submitInputAlert(owner: alertData['dialogOwner']) {
    closeInputAlert(owner, alertInputElement?.value ?? $alertStore.defaultValue ?? '')
  }

  function cancelSelectAlert() {
    if ($alertStore.type !== 'select' || $alertStore.dismissible === false) return
    resolveAlertSelection($alertStore.dialogOwner, null)
  }

  function handleAlertKeydown(event: KeyboardEvent) {
    if ($alertStore.type !== 'select' || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancelSelectAlert()
  }
</script>

<svelte:window
  onmessage={async (e) => {
    if (isTrustedLoginMessageOrigin(e.origin, window.location.origin)) {
      if (e.data.msg?.data?.vaild && $alertStore.type === 'login') {
        resolveAlertWorkflow($alertStore.dialogOwner, JSON.stringify(e.data.msg))
      }
    }
  }} />

{#if $alertStore.type !== 'none' && $alertStore.type !== 'toast' && $alertStore.type !== 'cardexport' && $alertStore.type !== 'branches' && $alertStore.type !== 'selectModule' && $alertStore.type !== 'pukmakkurit' && $alertStore.type !== 'requestlogs'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:modalBackdropDismiss={cancelSelectAlert}
    data-modal-root
    class="fixed inset-0 z-[100] bg-black/50 flex justify-center items-center"
    class:vis={$alertStore.type === 'wait2'}
    onkeydown={handleAlertKeydown}>
    <div
      use:modalFocusTrap
      role={alertDialogRole}
      aria-modal="true"
      aria-labelledby="risu-alert-dialog-title"
      tabindex="-1"
      class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl max-h-full overflow-y-auto">
      <h2 id="risu-alert-dialog-title" class="sr-only">{alertDialogTitle}</h2>
      {#if $alertStore.title}
        <h2 class="text-green-700 mt-0 mb-2 max-w-full">{$alertStore.title}</h2>
      {:else if $alertStore.type === 'error'}
        <h2 class="text-red-700 mt-0 mb-2 w-40 max-w-full">{language.error}</h2>
      {:else if $alertStore.type === 'ask'}
        <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.confirm}</h2>
      {:else if $alertStore.type === 'pluginconfirm'}
        <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.pluginImport}</h2>
      {:else if $alertStore.type === 'selectChar'}
        <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.select}</h2>
      {:else if $alertStore.type === 'input'}
        <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.input}</h2>
      {/if}
      {#if $alertStore.type === 'markdown'}
        <div class="overflow-y-auto">
          <span class="text-gray-300 chattext prose chattext2" class:prose-invert={$ColorSchemeTypeStore}>
            {#await ParseMarkdown($alertStore.msg) then msg}
              {@html msg}
            {/await}
          </span>
        </div>
      {:else if $alertStore.type === 'tos'}
        <div class="text-textcolor">
          You should accept
          <a
            href="https://account.sionyw.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer"
            onclick={(event) => {
              event.preventDefault()
              openURL('https://account.sionyw.com/terms')
            }}>Terms of Service</a>

          and

          <a
            href="https://account.sionyw.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer"
            onclick={(event) => {
              event.preventDefault()
              openURL('https://account.sionyw.com/privacy')
            }}>Privacy Policy</a>

          to continue
        </div>

        {#if localStorage.getItem('tos2') && Date.now() - new Date('2026-05-15').getTime() < 0}
          <div class="text-gray-500 mt-4 text-sm">
            You can still continue using Risuai using original terms until {new Date(
              '2026-05-15',
            ).toLocaleDateString()}.
          </div>
        {/if}
      {:else if $alertStore.type === 'pluginconfirm'}
        {@const parts = $alertStore.msg.split('\n\n')}
        {@const mainPart = parts[0]}
        {@const confirmMessage = parts[1]}
        {@const mainParts = mainPart.split('\n')}
        {@const pluginName = mainParts[0]}
        {@const warnings = mainParts.slice(1)}
        <div class="plugin-confirm-content">
          <p class="plugin-name">{pluginName}</p>
          {#if warnings.length > 0}
            <ul class="warnings-list">
              {#each warnings as warning}
                <li class="warning-item">{warning}</li>
              {/each}
            </ul>
          {/if}
          <p class="confirm-message">{confirmMessage}</p>
        </div>
      {:else if $alertStore.type !== 'select' && $alertStore.type !== 'requestdata' && $alertStore.type !== 'addchar' && $alertStore.type !== 'chatOptions'}
        <span class="text-gray-300 whitespace-pre-wrap">{$alertStore.msg}</span>
        {#if $alertStore.submsg && $alertStore.type !== 'progress'}
          <span class="text-gray-500 text-sm">{$alertStore.submsg}</span>
        {/if}

        {#if $alertStore.type === 'error' && $alertStore.stackTrace}
          <div class="mt-4">
            <Button styled="outlined" size="sm" onclick={() => (showDetails = !showDetails)}>
              {showDetails ? language.hideErrorDetails : language.showErrorDetails}
              {#if showDetails}
                <XIcon class="inline ml-2" />
              {:else}
                <ChevronRightIcon class="inline ml-2" />
              {/if}
            </Button>
            {#if showDetails}
              <div class="stack-trace-wrap">
                <button
                  class="stack-trace-copy"
                  onclick={() => copyToClipboard(stackTraceCodeBlock, 'stack-trace')}
                  title={language.copy}
                  aria-label={language.copy}>
                  {#if copiedKey === 'stack-trace'}
                    <CheckIcon size={14} />
                  {:else}
                    <CopyIcon size={14} />
                  {/if}
                </button>
                <pre class="stack-trace">{stackTraceCodeBlock}</pre>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
      {#if $alertStore.type === 'progress'}
        {@const progressPercent = readProgressPercent($alertStore)}
        {@const progressLabel = readProgressLabel($alertStore, progressPercent)}
        {@const progressDetail = readProgressDetail($alertStore)}
        <div
          class="w-full min-w-64 md:min-w-138 h-2 bg-darkbg border border-darkborderc rounded-md mt-6 overflow-hidden"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={$alertStore.progress === null ? undefined : Math.round(progressPercent)}
          aria-label={$alertStore.msg}>
          <div
            class="h-full w-full origin-left bg-linear-to-r from-blue-500 to-purple-800 saving-animation transition-transform"
            style:transform={`scaleX(${progressPercent / 100})`}>
          </div>
        </div>
        <div class="w-full flex justify-center mt-6">
          <span class="text-gray-500 text-sm">{progressLabel}</span>
        </div>
        {#if progressDetail}
          <div class="w-full mt-2 text-center text-gray-500 text-sm whitespace-pre-wrap">
            {progressDetail}
          </div>
        {/if}
      {/if}

      {#if $alertStore.type === 'ask' || $alertStore.type === 'pluginconfirm'}
        <div class="flex gap-2 w-full">
          <Button
            className="mt-4 grow"
            onclick={() => {
              resolveAlertConfirmation($alertStore.dialogOwner, true)
            }}>YES</Button>
          <Button
            className="mt-4 grow"
            onclick={() => {
              resolveAlertConfirmation($alertStore.dialogOwner, false)
            }}>NO</Button>
        </div>
      {:else if $alertStore.type === 'tos' && import.meta.env.VITE_RISU_LEGAL_CONFIGURED}
        {@const tosOwner = $alertStore.dialogOwner}
        <div class="flex gap-2 w-full">
          <Button
            className="mt-4 grow"
            onclick={() => {
              resolveAlertWorkflow(tosOwner, 'yes')
            }}>Accept</Button>
          <Button
            styled={'outlined'}
            className="mt-4 grow"
            onclick={() => {
              resolveAlertWorkflow(tosOwner, 'no')
            }}>Do not Accept</Button>
        </div>
      {:else if $alertStore.type === 'select'}
        {@const hasDisplay = $alertStore.msg.startsWith('__DISPLAY__')}
        {#if hasDisplay}
          {@const parts = $alertStore.msg.substring(11).split('||')}
          <div class="mb-4 text-textcolor">{parts[0]}</div>
          {#each parts.slice(1) as n, i}
            <Button
              className="mt-4"
              onclick={() => {
                resolveAlertSelection($alertStore.dialogOwner, i)
              }}>{n}</Button>
          {/each}
        {:else}
          {@const parts = $alertStore.msg.split('||')}
          {#each parts as n, i}
            <Button
              className="mt-4"
              onclick={() => {
                resolveAlertSelection($alertStore.dialogOwner, i)
              }}>{n}</Button>
          {/each}
        {/if}
        {#if $alertStore.dismissible !== false}
          <Button className="mt-4" styled="outlined" onclick={cancelSelectAlert}>{language.cancel}</Button>
        {/if}
      {:else if $alertStore.type === 'error' || $alertStore.type === 'normal' || $alertStore.type === 'markdown'}
        <Button
          className="mt-4"
          onclick={() => {
            alertStore.set({
              type: 'none',
              msg: '',
            })
          }}>OK</Button>
      {:else if $alertStore.type === 'input'}
        {#key $alertStore.dialogOwner}
          {@const inputOwner = $alertStore.dialogOwner}
          <TextInput
            bind:inputRef={alertInputElement}
            value={$alertStore.defaultValue}
            id="alert-input"
            ariaLabel={$alertStore.msg}
            autocomplete="off"
            marginTop
            list="alert-input-list"
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitInputAlert(inputOwner)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeInputAlert(inputOwner, '')
              }
            }} />
          <div class="flex gap-2 w-full mt-4">
            <Button className="grow" onclick={() => submitInputAlert(inputOwner)}>OK</Button>
            <Button className="grow" styled="outlined" onclick={() => closeInputAlert(inputOwner, '')}
              >{language.cancel}</Button>
          </div>
          {#if $alertStore.datalist}
            <datalist id="alert-input-list">
              {#each $alertStore.datalist as item}
                <option value={item[0]} label={item[1] ? item[1] : item[0]}>{item[1] ? item[1] : item[0]}</option>
              {/each}
            </datalist>
          {/if}
        {/key}
      {:else if $alertStore.type === 'login'}
        <div class="fixed top-0 left-0 bg-black/50 w-full h-full flex justify-center items-center">
          <iframe src={hubURL + '/hub/login'} title="login" class="w-full h-full"> </iframe>
        </div>
      {:else if $alertStore.type === 'selectChar'}
        {@const selectCharacterOwner = $alertStore.dialogOwner}
        <div class="flex w-full items-start flex-wrap gap-2 justify-start">
          {#each getDatabase().characters as char}
            {#if char.image}
              {#await getCharImage(char.image, 'css')}
                <BarIcon
                  ariaLabel={char.name || language.character}
                  onClick={() => {
                    resolveAlertWorkflow(selectCharacterOwner, char.chaId)
                  }}>
                  <User />
                </BarIcon>
              {:then im}
                <BarIcon
                  ariaLabel={char.name || language.character}
                  onClick={() => {
                    resolveAlertWorkflow(selectCharacterOwner, char.chaId)
                  }}
                  additionalStyle={im} />
              {/await}
            {:else}
              <BarIcon
                ariaLabel={char.name || language.character}
                onClick={() => {
                  resolveAlertWorkflow(selectCharacterOwner, char.chaId)
                }}>
                <User />
              </BarIcon>
            {/if}
          {/each}
        </div>
      {:else if $alertStore.type === 'requestdata'}
        {#if aiLawApplies()}
          <div>
            {language.generatedByAIDisclaimer}
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button
            selected={generationInfoMenuIndex === 0}
            size="sm"
            onclick={() => {
              generationInfoMenuIndex = 0
            }}>
            {language.tokens}
          </Button>
          <Button
            selected={generationInfoMenuIndex === 1}
            size="sm"
            onclick={() => {
              generationInfoMenuIndex = 1
            }}>
            {language.metaData}
          </Button>
          <Button
            selected={generationInfoMenuIndex === 2}
            size="sm"
            onclick={() => {
              generationInfoMenuIndex = 2
            }}>
            {language.log}
          </Button>
          <Button
            selected={generationInfoMenuIndex === 3}
            size="sm"
            onclick={() => {
              generationInfoMenuIndex = 3
            }}>
            {language.prompt}
          </Button>
          <button
            class="ml-auto"
            aria-label={language.close}
            onclick={() => {
              alertStore.set({
                type: 'none',
                msg: '',
              })
            }}>✖</button>
        </div>
        {#if generationInfoMenuIndex === 0}
          <div class="mt-4 flex justify-center w-full">
            <div
              class="w-32 h-32 border-darkborderc border-4 rounded-lg"
              style:background={`linear-gradient(0deg,
                            rgb(59,130,246) 0%,
                            rgb(59,130,246) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) 100%)`}>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
            <span class="text-blue-500">{language.inputTokens}</span>
            <span class="text-blue-500 justify-self-end"
              >{$alertGenerationInfoStore.genInfo.inputTokens ?? '?'} {language.tokens}</span>
            <span class="text-green-500">{language.outputTokens}</span>
            <span class="text-green-500 justify-self-end"
              >{$alertGenerationInfoStore.genInfo.outputTokens ?? '?'} {language.tokens}</span>
            <span class="text-gray-400">{language.maxContextSize}</span>
            <span class="text-gray-400 justify-self-end"
              >{$alertGenerationInfoStore.genInfo.maxContext ?? '?'} {language.tokens}</span>
          </div>
          <span class="text-textcolor2 text-sm">{language.tokenWarning}</span>
        {/if}
        {#if generationInfoMenuIndex === 1}
          <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
            <span class="text-blue-500">Index</span>
            <span class="text-blue-500 justify-self-end"
              >{generationMessageTarget?.index ?? $alertGenerationInfoStore.idx}</span>
            <span class="text-amber-500">Model</span>
            <span class="text-amber-500 justify-self-end">{$alertGenerationInfoStore.genInfo.model}</span>
            <span class="text-red-500">GenID</span>
            <span class="text-red-500 justify-self-end">{$alertGenerationInfoStore.genInfo.generationId}</span>
            {#if generationMessage}
              <span class="text-green-500">ID</span>
              <span class="text-green-500 justify-self-end">{generationMessage.chatId ?? 'None'}</span>
              <span class="text-cyan-500">Saying</span>
              <span class="text-cyan-500 justify-self-end">{generationMessage.saying}</span>
              <span class="text-purple-500">Size</span>
              <span class="text-purple-500 justify-self-end">{JSON.stringify(generationMessage).length} Bytes</span>
              <span class="text-yellow-500">Time</span>
              <span class="text-yellow-500 justify-self-end"
                >{new Date(generationMessage.time ?? 0).toLocaleString()}</span>
            {:else}
              <span class="col-span-2 text-gray-400" role="status">{language.errors.requestDataMessageMissing}</span>
            {/if}
            {#if $alertGenerationInfoStore.genInfo.stageTiming}
              {@const stage1 = parseFloat(
                (($alertGenerationInfoStore.genInfo.stageTiming.stage1 ?? 0) / 1000).toFixed(1),
              )}
              {@const stage2 = parseFloat(
                (($alertGenerationInfoStore.genInfo.stageTiming.stage2 ?? 0) / 1000).toFixed(1),
              )}
              {@const stage3 = parseFloat(
                (($alertGenerationInfoStore.genInfo.stageTiming.stage3 ?? 0) / 1000).toFixed(1),
              )}
              {@const stage4 = parseFloat(
                (($alertGenerationInfoStore.genInfo.stageTiming.stage4 ?? 0) / 1000).toFixed(1),
              )}
              {@const totalRounded = (stage1 + stage2 + stage3 + stage4).toFixed(1)}
              <span class="text-gray-400">Timing</span>
              <span class="text-gray-400 justify-self-end">
                <span style="color: #60a5fa;">{stage1}</span> +
                <span style="color: #db2777;">{stage2}</span> +
                <span style="color: #34d399;">{stage3}</span> +
                <span style="color: #8b5cf6;">{stage4}</span> =
                <span class="text-white font-bold">{totalRounded}s</span>
              </span>
            {/if}

            {#if generationMessage}
              <span class="text-green-500">Tokens</span>
              {#await tokenize(generationMessage.data ?? '')}
                <span class="text-green-500 justify-self-end">Loading</span>
              {:then tokens}
                <span class="text-green-500 justify-self-end">{tokens}</span>
              {/await}
            {/if}
          </div>
        {/if}
        {#if generationInfoMenuIndex === 2}
          {#await getFetchData($alertStore.msg) then data}
            {#if !data}
              <span class="text-gray-300 text-lg mt-2">{language.errors.requestLogRemoved}</span>
              <span class="text-gray-500">{language.errors.requestLogRemovedDesc}</span>
            {:else}
              <h1 class="text-2xl font-bold my-4">URL</h1>
              <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{data.url}</code>
              <h1 class="text-2xl font-bold my-4">Request Body</h1>
              <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap"
                >{beautifyJSON(data.body)}</code>
              <h1 class="text-2xl font-bold my-4">Response</h1>
              <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap"
                >{beautifyJSON(data.response)}</code>
            {/if}
          {/await}
        {/if}
        {#if generationInfoMenuIndex === 3}
          {#if !promptInfoView.hasPromptInfo}
            <div class="text-gray-300 text-lg mt-2">{language.promptInfoEmptyMessage}</div>
          {:else}
            <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
              <span class="text-blue-500">Preset Name</span>
              <span class="text-blue-500 justify-self-end">{promptInfoView.promptName || '-'}</span>
              <span class="text-purple-500">Toggles</span>
              <div class="col-span-2 max-h-32 overflow-y-auto border border-stone-500 rounded-sm p-2 bg-gray-900">
                {#if promptInfoView.promptToggles.length === 0}
                  <div class="text-gray-500 italic text-center py-4">
                    {language.promptInfoEmptyToggle}
                  </div>
                {:else}
                  <div class="grid grid-cols-2 gap-y-2 gap-x-4">
                    {#each promptInfoView.promptToggles as toggle}
                      <span class="text-gray-200 truncate">{toggle.key}</span>
                      <span class="text-gray-200 justify-self-end truncate">{toggle.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <span class="text-red-500">Prompt Text</span>
              <div class="col-span-2 max-h-80 overflow-y-auto border border-stone-500 rounded-sm p-4 bg-gray-900">
                {#if promptInfoView.promptText.length === 0}
                  <div class="text-gray-500 italic text-center py-4">
                    {language.promptInfoEmptyText}
                  </div>
                {:else}
                  {#each promptInfoView.promptText as block}
                    <div class="mb-2">
                      <div class="font-bold text-gray-600">{block.role}</div>
                      <pre
                        class="whitespace-pre-wrap text-sm bg-stone-900 p-2 rounded-sm border border-stone-500">{block.content}</pre>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      {:else if $alertStore.type === 'addchar'}
        {@const addCharacterOwner = $alertStore.dialogOwner}
        <div class="w-2xl flex flex-col max-w-full">
          <button
            class="border-darkborderc border py-12 px-8 flex rounded-md hover:ring-2 justify-center items-center"
            onclick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              resolveAlertWorkflow(addCharacterOwner, 'importFromRealm')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span class="text-2xl font-bold">{language.importFromRealm}</span>
              <span class="text-textcolor2">{language.importFromRealmDesc}</span>
            </div>
            <div class="ml-9 float-right flex-1 flex justify-end">
              <ChevronRightIcon />
            </div>
          </button>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              resolveAlertWorkflow(addCharacterOwner, 'importCharacter')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.importCharacter}</span>
            </div>
            <div class="ml-9 float-right flex-1 flex justify-end">
              <ChevronRightIcon />
            </div>
          </button>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              resolveAlertWorkflow(addCharacterOwner, 'createfromScratch')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.createfromScratch}</span>
            </div>
            <div class="ml-9 float-right flex-1 flex justify-end">
              <ChevronRightIcon />
            </div>
          </button>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              resolveAlertWorkflow(addCharacterOwner, 'cancel')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.cancel}</span>
            </div>
          </button>
        </div>
      {:else if $alertStore.type === 'chatOptions'}
        {@const chatOptionsOwner = $alertStore.dialogOwner}
        <div class="w-2xl flex flex-col max-w-full">
          <h1 class="text-xl mb-4 font-bold">
            {language.chatOptions}
          </h1>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={() => {
              resolveAlertWorkflow(chatOptionsOwner, '0')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.createCopy}</span>
            </div>
            <div class="ml-9 float-right flex-1 flex justify-end">
              <ChevronRightIcon />
            </div>
          </button>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={() => {
              resolveAlertWorkflow(chatOptionsOwner, '1')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.bindPersona}</span>
            </div>
            <div class="ml-9 float-right flex-1 flex justify-end">
              <ChevronRightIcon />
            </div>
          </button>
          <button
            class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2"
            onclick={() => {
              resolveAlertWorkflow(chatOptionsOwner, 'cancel')
            }}>
            <div class="flex flex-col justify-start items-start">
              <span>{language.cancel}</span>
            </div>
          </button>
        </div>
      {/if}
    </div>
  </div>
{:else if $alertStore.type === 'cardexport'}
  {@const cardExportOwner = $alertStore.dialogOwner}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:modalBackdropDismiss={() => cancelCardExport(cardExportOwner)}
    data-modal-root
    class="fixed top-0 left-0 h-full w-full bg-black/50 flex flex-col z-[100] items-center justify-center">
    <div
      use:modalFocusTrap
      class="bg-darkbg rounded-md p-4 max-w-full flex flex-col w-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-card-export-title"
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation()
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape') cancelCardExport(cardExportOwner)
      }}>
      <h1 id="risu-card-export-title" class="font-bold text-2xl w-full">
        <span>
          {language.shareExport}
        </span>
        <button
          class="float-right text-textcolor2 hover:text-green-500"
          aria-label={language.close}
          onclick={() => cancelCardExport(cardExportOwner)}>
          <XIcon />
        </button>
      </h1>
      <span class="text-textcolor mt-4">{language.type}</span>
      {#if cardExportType === ''}
        {#if $alertStore.submsg === 'module'}
          <span class="text-textcolor2 text-sm">{language.risuMDesc}</span>
        {:else if $alertStore.submsg === 'preset'}
          <span class="text-textcolor2 text-sm">{language.risupresetDesc}</span>
          {#if cardExportType2 === 'preset' && (getDatabase().botPresets[getDatabase().botPresetsId].image || getDatabase().botPresets[getDatabase().botPresetsId].regex?.length > 0)}
            <span class="text-red-500 text-sm">Preset with image or regexes cannot be exported for now.</span>
          {/if}
        {:else}
          <span class="text-textcolor2 text-sm">{language.ccv3Desc}</span>
          {#if cardExportType2 !== 'charx' && cardExportType2 !== 'charxJpeg' && isCharacterHasAssets(getDatabase().characters[$selectedCharID])}
            <span class="text-red-500 text-sm">{language.notCharxWarn}</span>
          {/if}
        {/if}
      {:else if cardExportType === 'json'}
        <span class="text-textcolor2 text-sm">{language.jsonDesc}</span>
      {:else if cardExportType === 'ccv2'}
        <span class="text-textcolor2 text-sm">{language.ccv2Desc}</span>
        <span class="text-red-500 text-sm">{language.v2Warning}</span>
      {/if}
      <div class="flex items-center flex-wrap mt-2">
        {#if $alertStore.submsg === 'preset'}
          <button
            aria-pressed={cardExportType === ''}
            class="bg-bgcolor px-2 py-4 rounded-lg flex-1"
            class:ring-1={cardExportType === ''}
            onclick={() => {
              cardExportType = ''
            }}>Risupreset</button>
        {:else if $alertStore.submsg === 'module'}
          <button
            aria-pressed={cardExportType === ''}
            class="bg-bgcolor px-2 py-4 rounded-lg flex-1"
            class:ring-1={cardExportType === ''}
            onclick={() => {
              cardExportType = ''
            }}>RisuM</button>
        {:else}
          <button
            aria-pressed={cardExportType === ''}
            class="bg-bgcolor px-2 py-4 rounded-lg flex-1"
            class:ring-1={cardExportType === ''}
            onclick={() => {
              cardExportType = ''
              cardExportType2 = 'charxJpeg'
            }}>Character Card V3</button>
          <button
            aria-pressed={cardExportType === 'ccv2'}
            class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1"
            class:ring-1={cardExportType === 'ccv2'}
            onclick={() => {
              cardExportType = 'ccv2'
            }}>Character Card V2</button>
        {/if}
      </div>
      {#if $alertStore.submsg === '' && cardExportType === ''}
        <span class="text-textcolor mt-4">{language.format}</span>
        <SelectInput bind:value={cardExportType2} className="mt-2">
          <OptionInput value="charx">CHARX</OptionInput>
          <OptionInput value="charxJpeg">CHARX-JPEG</OptionInput>
          <OptionInput value="">PNG</OptionInput>
          <OptionInput value="json">JSON</OptionInput>
        </SelectInput>
      {/if}
      <Button
        className="mt-4"
        onclick={() => {
          resolveAlertWorkflow(
            cardExportOwner,
            JSON.stringify({
              type: cardExportType,
              type2: cardExportType2,
            }),
          )
        }}>{language.export}</Button>
    </div>
  </div>
{:else if $alertStore.type === 'toast'}
  <div
    class="toast-anime absolute right-0 bottom-0 bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl max-h-11/12 overflow-y-auto z-50 text-textcolor"
    role="status"
    aria-live="polite"
    onanimationend={() => {
      alertStore.set({
        type: 'none',
        msg: '',
      })
    }}>
    {$alertStore.msg}
  </div>
{:else if $alertStore.type === 'selectModule'}
  {@const moduleSelectOwner = $alertStore.dialogOwner}
  <ModuleChatMenu
    alertMode
    close={(d) => {
      resolveAlertWorkflow(moduleSelectOwner, d)
    }} />
{:else if $alertStore.type === 'pukmakkurit'}
  <!-- Log Generator by dootaang, GPL3 -->
  <!-- Svelte, Typescript version by Kwaroran -->

  <div data-modal-root class="fixed inset-0 z-[100] bg-black/50 flex justify-center items-center">
    <div
      use:modalFocusTrap
      class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl max-h-full overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-preview-title"
      tabindex="-1">
      <h2 id="risu-preview-title" class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.preview}</h2>
    </div>
  </div>
{:else if $alertStore.type === 'branches'}
  <div
    use:modalFocusTrap
    data-modal-root
    class="fixed inset-0 z-[100] bg-black/80 flex justify-center items-center overflow-x-auto overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-label={language.branch}
    tabindex="-1">
    {#if branchHover !== null}
      <div
        id={branchHover.id}
        role="tooltip"
        aria-live="polite"
        class="z-30 whitespace-pre-wrap p-4 text-textcolor bg-darkbg border-darkborderc border rounded-md absolute"
        style="top: {branchHover.y * 80 + 24}px; left: {(branchHover.x + 1) * 80 + 24}px">
        {branchHover.content}
      </div>
    {/if}

    <div class="x-50 right-2 top-2 absolute">
      <button
        class="bg-darkbg border-darkborderc border p-2 rounded-md"
        aria-label={language.close}
        onclick={() => {
          alertStore.set({
            type: 'none',
            msg: '',
          })
        }}>
        <XIcon />
      </button>
    </div>

    {#each branchGraph as obj, index}
      {@const detailsId = `risu-branch-details-${index}`}
      <button
        type="button"
        data-risu-branch-node
        aria-label={`${language.branch} ${index + 1}`}
        aria-describedby={branchHover?.id === detailsId ? detailsId : undefined}
        class="peer w-12 h-12 z-20 bg-bgcolor border border-darkborderc rounded-full flex justify-center items-center overflow-y-auto absolute focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        style="top: {obj.y * 80 + 24}px; left: {obj.x * 80 + 24}px"
        onmouseenter={() => {
          showBranchDetails(obj, index)
        }}
        onpointerdown={(event) => {
          if (event.button !== 0) return
          branchPointerFocusPending = true
          queueMicrotask(() => {
            branchPointerFocusPending = false
          })
        }}
        onpointerup={() => {
          branchPointerFocusPending = false
        }}
        onpointercancel={() => {
          branchPointerFocusPending = false
        }}
        onfocus={() => {
          const details = getBranchDetails(obj, index)
          if (!branchPointerFocusPending) branchFocusedDetails = details
          branchHover = details
          branchPointerFocusPending = false
        }}
        onclick={() => {
          branchPointerFocusPending = false
          showBranchDetails(obj, index)
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') showBranchDetails(obj, index)
        }}
        onkeyup={(event) => {
          if (event.key === ' ') showBranchDetails(obj, index)
        }}
        onmouseleave={() => {
          if (branchHover?.id === detailsId) branchHover = branchFocusedDetails
        }}
        onblur={() => {
          if (branchFocusedDetails?.id === detailsId) branchFocusedDetails = null
          if (branchHover?.id === detailsId) branchHover = null
        }}>
      </button>
      {#if obj.connectX === obj.x}
        {#if obj.multiChild}
          <div
            class="w-0 h-20 border-x border-x-red-500 absolute"
            style="top: {(obj.y - 1) * 80 + 24}px; left: {obj.x * 80 + 45}px">
          </div>
        {:else}
          <div
            class="w-0 h-20 border-x border-x-blue-500 absolute"
            style="top: {(obj.y - 1) * 80 + 24}px; left: {obj.x * 80 + 45}px">
          </div>
        {/if}
      {:else if obj.connectX !== -1}
        <div class="w-0 h-10 border-x border-x-red-500 absolute" style="top: {obj.y * 80}px; left: {obj.x * 80 + 45}px">
        </div>
        <div
          class="h-0 border-y border-y-red-500 absolute"
          style="top: {obj.y * 80}px; left: {obj.connectX * 80 + 46}px"
          style:width={Math.abs((obj.x - obj.connectX) * 80) + 'px'}>
        </div>
      {/if}
    {/each}
  </div>
{:else if $alertStore.type === 'requestlogs'}
  {@const logs = getFetchLogs()}
  <div data-modal-root class="fixed inset-0 z-[100] bg-black/80 flex justify-center items-start overflow-y-auto p-4">
    <div
      use:modalFocusTrap
      class="bg-darkbg rounded-lg w-full max-w-4xl my-4 flex flex-col max-h-[90vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-request-logs-title"
      tabindex="-1">
      <div class="flex items-center justify-between p-4 border-b border-darkborderc sticky top-0 bg-darkbg z-10">
        <h1 id="risu-request-logs-title" class="text-xl font-bold text-textcolor">{language.ShowLog}</h1>
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            onclick={() => {
              if (allExpanded) {
                expandedLogs = new Set()
              } else {
                expandedLogs = new Set(logs.map((_, i) => i))
              }
              allExpanded = !allExpanded
            }}>
            {allExpanded ? language.collapseAll : language.expandAll}
          </Button>
          <button
            class="text-textcolor2 hover:text-textcolor p-1"
            aria-label={language.close}
            onclick={() => {
              alertStore.set({ type: 'none', msg: '' })
            }}>
            <XIcon />
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        {#if logs.length === 0}
          <div class="text-textcolor2 text-center py-8" role="status">{language.noRequestLogs}</div>
        {:else}
          <div class="flex flex-col gap-2">
            {#each logs as log, i}
              {@const isExpanded = expandedLogs.has(i)}
              <div class="border border-darkborderc rounded-lg overflow-hidden">
                <button
                  class="w-full flex items-center justify-between p-3 hover:bg-bgcolor/50 transition-colors"
                  onclick={() => {
                    const newSet = new Set(expandedLogs)
                    if (isExpanded) {
                      newSet.delete(i)
                    } else {
                      newSet.add(i)
                    }
                    expandedLogs = newSet
                  }}>
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      class="px-2 py-1 rounded text-xs font-bold font-mono {log.success
                        ? 'bg-green-600 text-white'
                        : 'bg-red-600 text-white'}">
                      {log.status ?? (log.success ? 'OK' : 'ERR')}
                    </span>
                    <span class="text-textcolor text-sm truncate flex-1 text-left font-mono" title={log.url}>
                      {log.url}
                    </span>
                    <span class="text-textcolor text-xs whitespace-nowrap opacity-70">{log.date}</span>
                  </div>
                  <div class="ml-2 text-textcolor">
                    {#if isExpanded}
                      <ChevronUpIcon size={20} />
                    {:else}
                      <ChevronDownIcon size={20} />
                    {/if}
                  </div>
                </button>
                {#if isExpanded}
                  <div class="border-t border-darkborderc p-4 bg-bgcolor/30">
                    <div class="space-y-4">
                      <div>
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-textcolor text-sm font-semibold">URL</span>
                          <button
                            class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-url`
                              ? 'text-green-500'
                              : 'text-textcolor2 hover:text-textcolor'}"
                            onclick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(log.url, `${i}-url`)
                            }}
                            title="Copy">
                            {#if copiedKey === `${i}-url`}
                              <CheckIcon size={14} />
                            {:else}
                              <CopyIcon size={14} />
                            {/if}
                          </button>
                        </div>
                        <pre class="request-log-code hljs text-sm">{log.url}</pre>
                      </div>
                      <div>
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-textcolor text-sm font-semibold">Request Body</span>
                          <button
                            class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-body`
                              ? 'text-green-500'
                              : 'text-textcolor2 hover:text-textcolor'}"
                            onclick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(log.body, `${i}-body`)
                            }}
                            title="Copy">
                            {#if copiedKey === `${i}-body`}
                              <CheckIcon size={14} />
                            {:else}
                              <CopyIcon size={14} />
                            {/if}
                          </button>
                        </div>
                        <pre class="request-log-code hljs">{@html highlightJson(log.body)}</pre>
                      </div>
                      <div>
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-textcolor text-sm font-semibold">Request Header</span>
                          <button
                            class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-header`
                              ? 'text-green-500'
                              : 'text-textcolor2 hover:text-textcolor'}"
                            onclick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(log.header, `${i}-header`)
                            }}
                            title="Copy">
                            {#if copiedKey === `${i}-header`}
                              <CheckIcon size={14} />
                            {:else}
                              <CopyIcon size={14} />
                            {/if}
                          </button>
                        </div>
                        <pre class="request-log-code hljs max-h-32">{@html highlightJson(log.header)}</pre>
                      </div>
                      <div>
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-textcolor text-sm font-semibold">Response</span>
                          <button
                            class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-response`
                              ? 'text-green-500'
                              : 'text-textcolor2 hover:text-textcolor'}"
                            onclick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(log.response, `${i}-response`)
                            }}
                            title="Copy">
                            {#if copiedKey === `${i}-response`}
                              <CheckIcon size={14} />
                            {:else}
                              <CopyIcon size={14} />
                            {/if}
                          </button>
                        </div>
                        <pre class="request-log-code hljs max-h-64">{@html highlightJson(log.response)}</pre>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .plugin-confirm-content .plugin-name {
    font-size: 1.25rem;
    font-weight: bold;
    color: white;
  }
  .plugin-confirm-content .warnings-list {
    list-style-type: disc;
    list-style-position: inside;
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    padding-left: 1rem;
    color: #f87171; /* red-400 */
  }
  .plugin-confirm-content .warning-item {
    margin-bottom: 0.25rem;
  }
  .plugin-confirm-content .confirm-message {
    margin-top: 1rem;
    color: #d1d5db; /* gray-300 */
  }
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
  @keyframes toastAnime {
    0% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .toast-anime {
    animation: toastAnime 1s ease-out;
  }

  .vis {
    opacity: 1 !important;
    --tw-bg-opacity: 1 !important;
  }

  .stack-trace-wrap {
    position: relative;
    margin-top: 0.5rem;
  }

  .stack-trace {
    background-color: var(--risu-theme-bgcolor);
    color: var(--risu-theme-textcolor2);
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 0.25rem;
    padding: 0.75rem 2.75rem 0.75rem 0.75rem;
    font-family: monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }

  .stack-trace-copy {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 0.375rem;
    background-color: var(--risu-theme-darkbg);
    color: var(--risu-theme-textcolor2);
    transition:
      background-color 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease;
  }

  .stack-trace-copy:hover {
    background-color: var(--risu-theme-bgcolor);
    color: var(--risu-theme-textcolor);
  }

  .request-log-code {
    background-color: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 0.375rem;
    padding: 0.75rem;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 12rem;
    overflow: auto;
  }
</style>
