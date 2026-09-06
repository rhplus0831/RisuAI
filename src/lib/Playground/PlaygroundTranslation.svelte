<script lang="ts">
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import { clearLLMCache, runTranslator } from 'src/ts/translator/translator'
  import Button from '../UI/GUI/Button.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import { getLanguageCodes } from 'src/ts/globalApi.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import { tokenize } from 'src/ts/tokenizer'

  const userPreferedLang = navigator.language.split('-')[0]

  let r = $state('')
  let sourceLang = $state('en')
  let output = $state('')
  let outputLang = $state(userPreferedLang)
  let loading = $state(false)
  let bulk = $state(false)
  let keepContext = $state(false)
  let bulkProgressText = $state('')
  let failureMessages = $state<string[]>([])
  let inputEpoch = 0
  let trackedInputSignature = ''

  $effect(() => {
    const inputSignature = JSON.stringify([r, sourceLang, outputLang, bulk, keepContext])
    if (inputSignature === trackedInputSignature) return

    trackedInputSignature = inputSignature
    inputEpoch += 1
    output = ''
    failureMessages = []
    bulkProgressText = ''
  })

  function translationErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message
    return String(error)
  }

  async function translate() {
    if (loading) return

    const sourceSnapshot = r
    const sourceLanguageSnapshot = sourceLang
    const outputLanguageSnapshot = outputLang
    const bulkSnapshot = bulk
    const keepContextSnapshot = keepContext
    const runInputEpoch = inputEpoch
    const isCurrentRun = () =>
      inputEpoch === runInputEpoch &&
      r === sourceSnapshot &&
      sourceLang === sourceLanguageSnapshot &&
      outputLang === outputLanguageSnapshot &&
      bulk === bulkSnapshot &&
      keepContext === keepContextSnapshot
    const abandonStaleRun = () => {
      if (isCurrentRun()) return false
      output = ''
      failureMessages = []
      return true
    }

    bulkProgressText = ''
    output = ''
    failureMessages = []
    loading = true
    try {
      if (!bulkSnapshot) {
        const translated = await runTranslator(sourceSnapshot, false, sourceLanguageSnapshot, outputLanguageSnapshot, {
          translatorPresetId: null,
        })
        if (!abandonStaleRun()) output = translated
        return
      }

      let preChunks: string[] = []
      const previousContexts: string[] = []
      const translatedChunks: Array<string | null> = []
      let parsedJson: unknown = null
      let jsonMode = false
      let singleJsonObject = false
      try {
        parsedJson = JSON.parse(sourceSnapshot.trim())
        if (Array.isArray(parsedJson)) {
          preChunks = parsedJson.map((item) => {
            if (!item || typeof item !== 'object') return ''
            const text = (item as { text?: unknown }).text
            return typeof text === 'string' ? text : ''
          })
          jsonMode = true
        } else if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
          const text = (parsedJson as { text?: unknown }).text
          if (typeof text === 'string') {
            preChunks = [text]
            jsonMode = true
            singleJsonObject = true
          } else {
            preChunks = [sourceSnapshot]
          }
        } else {
          preChunks = [sourceSnapshot]
        }
      } catch {
        preChunks = sourceSnapshot.split('\n\n')
      }

      const formattedOutput = () => {
        if (!jsonMode) return translatedChunks.map((chunk) => chunk ?? '').join('\n\n')
        if (singleJsonObject && parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
          return JSON.stringify({ ...parsedJson, text: translatedChunks[0] ?? '' }, null, 2)
        }
        if (!Array.isArray(parsedJson)) return translatedChunks.map((chunk) => chunk ?? '').join('\n\n')

        const rows = parsedJson.map((item, index) => {
          const translatedChunk = translatedChunks[index]
          if (translatedChunk === undefined || !item || typeof item !== 'object') return item
          return { ...item, text: translatedChunk ?? '' }
        })
        return JSON.stringify(rows, null, 2)
      }

      const previousContentNote =
        'Previous Content is the content that was translated before the current content. This is used to keep the context of the translation. do not retranslate or return it.'

      for (let i = 0; i < preChunks.length; i++) {
        try {
          if (preChunks[i].trim().length === 0) {
            translatedChunks.push(preChunks[i])
          } else {
            bulkProgressText = `(${i + 1} of ${preChunks.length})`

            if (previousContexts.length > 10) {
              previousContexts.shift()
            }

            const previousContext = previousContexts.length > 0 ? previousContexts.join('\n\n') : ''
            if (previousContext) {
              const previousTokens = await tokenize(previousContext)
              if (abandonStaleRun()) return
              bulkProgressText += ` (previous ${previousTokens} tokens)`
            }

            const translatedChunk = await runTranslator(
              preChunks[i],
              false,
              sourceLanguageSnapshot,
              outputLanguageSnapshot,
              {
                translatorPresetId: null,
                translatorNote: previousContext
                  ? `<Previous Content>${previousContext.trim()}</Previous Content>\n${previousContentNote}`
                  : '',
              },
            )
            if (abandonStaleRun()) return
            if (keepContextSnapshot) {
              previousContexts.push(`<Original>${preChunks[i]}</Original><Translated>${translatedChunk}</Translated>`)
            }
            translatedChunks.push(translatedChunk)
          }
        } catch (error) {
          console.error(error)
          if (abandonStaleRun()) return
          translatedChunks.push(null)
          failureMessages = [
            ...failureMessages,
            language.playground.translationChunkFailed(i + 1, preChunks.length, translationErrorMessage(error)),
          ]
        }

        if (abandonStaleRun()) return
        output = formattedOutput()
      }

      if (!abandonStaleRun()) output = formattedOutput()
    } catch (error) {
      console.error(error)
      if (!abandonStaleRun()) {
        failureMessages = [...failureMessages, language.playground.translationRunFailed(translationErrorMessage(error))]
      }
    } finally {
      loading = false
    }
  }
</script>

<span>{language.sourceLanguage}</span>
<SelectInput
  value={sourceLang}
  onchange={(event) => (sourceLang = event.currentTarget.value)}
  ariaLabel={language.sourceLanguage}>
  {#each getLanguageCodes() as lang}
    <OptionInput value={lang.code}>{lang.name}</OptionInput>
  {/each}
</SelectInput>
<TextAreaInput bind:value={r} ariaLabel={language.playground.translationSourceText} />

<span>{language.translatorLanguage}</span>
<SelectInput
  value={outputLang}
  onchange={(event) => (outputLang = event.currentTarget.value)}
  ariaLabel={language.translatorLanguage}>
  {#each getLanguageCodes() as lang}
    <OptionInput value={lang.code}>{lang.name}</OptionInput>
  {/each}
</SelectInput>
<TextAreaInput value={output} ariaLabel={language.playground.translationOutputText} />

{#if failureMessages.length > 0}
  <div class="mt-3 rounded-md border border-red-500 p-3 text-sm text-red-400" role="alert">
    <p class="font-bold">{language.playground.translationFailureTitle}</p>
    <ul class="mt-1 list-disc pl-5">
      {#each failureMessages as message}
        <li>{message}</li>
      {/each}
    </ul>
  </div>
{/if}

<CheckInput bind:check={bulk} name={language.playground.translationBulk} />
{#if bulk}
  <CheckInput bind:check={keepContext} name={language.playground.translationKeepContext} />
{/if}

<Button className="mt-4" onclick={translate}>
  {#if loading}
    Loading... {bulkProgressText}
  {:else}
    Translate
  {/if}
</Button>
<Button
  className="mt-4"
  onclick={async () => {
    await clearLLMCache()
  }}>
  {language.playground.translationClearCache}
</Button>
