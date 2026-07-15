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

  async function translate() {
    if (loading) return

    const sourceSnapshot = r
    const sourceLanguageSnapshot = sourceLang
    const outputLanguageSnapshot = outputLang
    const bulkSnapshot = bulk
    const keepContextSnapshot = keepContext
    const isCurrentRun = () =>
      r === sourceSnapshot &&
      sourceLang === sourceLanguageSnapshot &&
      outputLang === outputLanguageSnapshot &&
      bulk === bulkSnapshot &&
      keepContext === keepContextSnapshot
    const abandonStaleRun = () => {
      if (isCurrentRun()) return false
      output = ''
      return true
    }

    bulkProgressText = ''
    output = ''
    loading = true
    try {
      if (!bulkSnapshot) {
        const translated = await runTranslator(sourceSnapshot, false, sourceLanguageSnapshot, outputLanguageSnapshot)
        if (!abandonStaleRun()) output = translated
        return
      }

      let preChunks: string[] = []
      const previousContexts: string[] = []
      const translatedChunks: string[] = []
      let parsedJson: unknown = null
      let jsonMode = false
      try {
        parsedJson = JSON.parse(sourceSnapshot.trim())
        if (Array.isArray(parsedJson)) {
          preChunks = parsedJson.map((item) => {
            if (!item || typeof item !== 'object') return ''
            const text = (item as { text?: unknown }).text
            return typeof text === 'string' ? text : ''
          })
        }
        jsonMode = true
      } catch {
        preChunks = sourceSnapshot.split('\n\n')
      }

      const formattedOutput = () => {
        if (!jsonMode) return translatedChunks.join('\n\n')
        if (!Array.isArray(parsedJson)) return JSON.stringify(parsedJson, null, 2)

        const rows = parsedJson.map((item, index) => {
          if (!translatedChunks[index] || !item || typeof item !== 'object') return item
          return { ...item, text: translatedChunks[index] }
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
          translatedChunks.push(preChunks[i])
        }

        if (abandonStaleRun()) return
        output = formattedOutput()
      }

      if (!abandonStaleRun()) output = formattedOutput()
    } catch (error) {
      console.error(error)
    } finally {
      loading = false
    }
  }
</script>

<span>{language.sourceLanguage}</span>
<SelectInput value={sourceLang} onchange={(event) => (sourceLang = event.currentTarget.value)}>
  {#each getLanguageCodes() as lang}
    <OptionInput value={lang.code}>{lang.name}</OptionInput>
  {/each}
</SelectInput>
<TextAreaInput bind:value={r} />

<span>{language.translatorLanguage}</span>
<SelectInput value={outputLang} onchange={(event) => (outputLang = event.currentTarget.value)}>
  {#each getLanguageCodes() as lang}
    <OptionInput value={lang.code}>{lang.name}</OptionInput>
  {/each}
</SelectInput>
<TextAreaInput value={output} />

<CheckInput bind:check={bulk}>Bulk</CheckInput>
{#if bulk}
  <CheckInput bind:check={keepContext}>Keep Context</CheckInput>
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
  Clear Cache
</Button>
