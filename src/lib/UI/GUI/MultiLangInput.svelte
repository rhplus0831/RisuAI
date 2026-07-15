<script lang="ts">
  import { language } from 'src/lang'
  import { encodeMultilangString, languageCodes, parseMultilangString, toLangName } from 'src/ts/util'
  import { untrack } from 'svelte'
  import TextAreaInput from './TextAreaInput.svelte'
  let addingLang = $state(false)
  interface Props {
    value: string
    className?: string
    onInput?: any
  }

  let { value = $bindable(), className = '', onInput = () => {} }: Props = $props()

  function normalizeValue(nextValue: string): Record<string, string> {
    const parsed = parseMultilangString(nextValue)
    const localizedLanguages = Object.keys(parsed).filter((lang) => lang !== 'xx')
    let legacyContent = parsed.xx ?? ''
    delete parsed.xx

    if (legacyContent.trim() !== '') {
      if (localizedLanguages.length > 0) {
        legacyContent = legacyContent.replace(/\n$/, '')
      }

      if (parsed.en === undefined || parsed.en === '') {
        parsed.en = legacyContent
      } else if (parsed.en !== legacyContent) {
        const separator = legacyContent.endsWith('\n') || parsed.en.startsWith('\n') ? '' : '\n'
        parsed.en = `${legacyContent}${separator}${parsed.en}`
      }
    }

    if (Object.keys(parsed).length === 0) {
      parsed.en = ''
    }

    return parsed
  }

  function availableLanguage(valueByLanguage: Record<string, string>, currentLanguage: string): string {
    if (valueByLanguage[currentLanguage] !== undefined) return currentLanguage
    if (valueByLanguage.en !== undefined) return 'en'
    return Object.keys(valueByLanguage)[0] ?? 'en'
  }

  const initialValueObject = normalizeValue(value)
  let valueObject: { [code: string]: string } = $state(initialValueObject)
  let selectedLang = $state(availableLanguage(initialValueObject, 'en'))

  const updateValue = () => {
    for (let lang in valueObject) {
      if (valueObject[lang] === '' && lang !== selectedLang && lang !== 'en') {
        delete valueObject[lang]
      }
    }
    if (valueObject.en === '') {
      valueObject.en = ' '
    }
    valueObject = valueObject // force update
    value = encodeMultilangString(valueObject)
  }

  $effect.pre(() => {
    const nextValueObject = normalizeValue(value)
    selectedLang = availableLanguage(
      nextValueObject,
      untrack(() => selectedLang),
    )
    valueObject = nextValueObject
  })
</script>

<div class="flex flex-wrap max-w-fit p-1 gap-2">
  {#each Object.keys(valueObject) as lang}
    {#if lang !== 'xx'}
      <button
        aria-pressed={selectedLang === lang}
        class="bg-bgcolor py-2 rounded-lg px-4"
        class:ring-1={selectedLang === lang}
        onclick={() => {
          selectedLang = lang
          updateValue()
        }}>{toLangName(lang)}</button>
    {/if}
  {/each}
  <button
    aria-label={`${language.add} ${language.language}`}
    aria-expanded={addingLang}
    class="text-nowrap bg-bgcolor py-2 rounded-lg px-4"
    class:ring-1={addingLang}
    onclick={() => {
      addingLang = !addingLang
    }}>+</button>
</div>
{#if addingLang}
  <div class="m-1 p-1 g-2 flex max-w-fit rounded-md border-t-bgcolor flex-wrap gap-1">
    {#each languageCodes as lang}
      {#if toLangName(lang) !== lang}
        <button
          class="bg-bgcolor py-2 rounded-lg px-4 text-nowrap"
          onclick={() => {
            valueObject[lang] = ''
            selectedLang = lang
            addingLang = false
          }}>{toLangName(lang)}</button>
      {/if}
    {/each}
  </div>
{/if}
<TextAreaInput
  autocomplete="off"
  bind:value={valueObject[selectedLang]}
  onInput={() => {
    updateValue()
    onInput()
  }}
  {className} />
