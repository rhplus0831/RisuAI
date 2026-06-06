<script lang="ts">
  import isEqual from 'lodash/isEqual'
  import { DBState } from 'src/ts/stores.svelte'
  import { sleep } from 'src/ts/util'
  import { alertError } from '../../ts/alert'
  import {
    addMetadataToElement,
    getDistance,
    ParseMarkdown,
    postTranslationParse,
    trimMarkdown,
    type CbsConditions,
    type simpleCharacterArgument,
  } from '../../ts/parser/parser.svelte'
  import { getLLMCache, translateHTML } from '../../ts/translator/translator'
  import { getModuleAssets } from 'src/ts/process/modules'
  import { getCurrentCharacter } from 'src/ts/storage/database.svelte'
  import { getFileSrc } from 'src/ts/globalApi.svelte'

  interface Props {
    character?: simpleCharacterArgument | string | null
    firstMessage?: boolean
    idx?: number
    msgDisplay?: string
    name?: string
    role: string | null
    translated: boolean
    translating: boolean
    retranslate: boolean
    bodyRoot?: HTMLElement | null
    modelShortName: string
  }

  let {
    character = null,
    idx = 0,
    firstMessage = false,
    msgDisplay,
    role,
    translated = $bindable(false),
    translating = $bindable(false),
    retranslate = $bindable(false),
    bodyRoot,
    modelShortName = '',
  }: Props = $props()

  // svelte-ignore non_reactive_update
  let lastParsed = ''
  let lastCharArg: string | simpleCharacterArgument = null
  let lastChatId = -10

  function getCbsCondition() {
    try {
      const cbsConditions: CbsConditions = {
        firstmsg: firstMessage ?? false,
        chatRole: role,
      }
      return cbsConditions
    } catch (e) {
      return {
        firstmsg: firstMessage ?? false,
        chatRole: null,
      }
    }
  }

  function reportParsingError(error: unknown) {
    const parsingError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error))
    alertError(
      `Error while parsing chat message: ${translated}, ${parsingError.message}, ${parsingError.stack}`,
    )
  }

  async function parseWithRetry(
    parse: () => Promise<string>,
    fallback: string,
  ): Promise<{ ok: true; value: string } | { ok: false; value: string }> {
    let tries = 0

    while (true) {
      try {
        return { ok: true, value: await parse() }
      } catch (error) {
        if (tries > 2) {
          reportParsingError(error)
          return { ok: false, value: fallback }
        }
        tries += 1
      }
    }
  }

  async function translateHTMLOnce(
    html: string,
    charArg: string | simpleCharacterArgument,
    chatID: number,
    regenerate: boolean,
    fallback: string,
  ): Promise<{ ok: true; value: string } | { ok: false; value: string }> {
    translating = true
    try {
      return {
        ok: true,
        value: await translateHTML(html, false, charArg, chatID, regenerate),
      }
    } catch (error) {
      reportParsingError(error)
      return { ok: false, value: fallback }
    } finally {
      translating = false
    }
  }

  const markParsing = async (
    data: string,
    charArg: string | simpleCharacterArgument,
    chatID: number,
  ) => {
    // track 'translated' and 'retranslate' state
    translated
    retranslate
    let lastParsedQueue = ''
    let mode = 'notrim' as const

    try {
      if (!isEqual(lastCharArg, charArg) || chatID !== lastChatId) {
        lastParsedQueue = ''
        lastCharArg = charArg
        lastChatId = chatID
        let translateText = false
        try {
          if (DBState.db.autoTranslate) {
            if (DBState.db.autoTranslateCachedOnly && DBState.db.translatorType === 'llm') {
              const cache = DBState.db.translateBeforeHTMLFormatting
                ? await getLLMCache(data)
                : !DBState.db.legacyTranslation
                  ? await getLLMCache(
                      await ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition()),
                    )
                  : await getLLMCache(
                      await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition()),
                    )

              translateText = cache !== null
            } else {
              translateText = true
            }
          }

          const lastTranslated = translated

          setTimeout(() => {
            translated = translateText
          }, 10)

          // State change of `translated` triggers markParsing again,
          // causing redundant translation attempts
          if (lastTranslated !== translateText) {
            return
          }
        } catch (error) {
          console.error(error)
        }
      }
      if (retranslate || translated) {
        if (DBState.db.showTranslationLoading) {
          lastParsed = `<div style="display:flex;justify-content:center;align-items:center;height:48px;"><div style="animation: spin 1s linear infinite; border-radius: 50%; height: 32px; width: 32px; border: 2px solid #3b82f6; border-top: 2px solid transparent;"></div></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`
        }

        if (DBState.db.translatorType === 'llm' && DBState.db.translateBeforeHTMLFormatting) {
          await sleep(100)
          const translatedHtml = await translateHTMLOnce(data, charArg, chatID, retranslate, data)
          if (!translatedHtml.ok) {
            return translatedHtml.value
          }
          const marked = await parseWithRetry(
            () => ParseMarkdown(translatedHtml.value, charArg, mode, chatID, getCbsCondition()),
            data,
          )
          if (!marked.ok) {
            return marked.value
          }
          lastParsedQueue = marked.value
          lastCharArg = charArg
          setTimeout(() => {
            retranslate = false
          }, 10)
          return marked.value
        } else if (!DBState.db.legacyTranslation) {
          const marked = await parseWithRetry(
            () => ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition()),
            data,
          )
          if (!marked.ok) {
            return marked.value
          }
          const translatedHtml = await translateHTMLOnce(
            marked.value,
            charArg,
            chatID,
            retranslate,
            data,
          )
          if (!translatedHtml.ok) {
            return translatedHtml.value
          }
          const translated = await parseWithRetry(
            () => postTranslationParse(translatedHtml.value),
            data,
          )
          if (!translated.ok) {
            return translated.value
          }
          lastParsedQueue = translated.value
          lastCharArg = charArg
          setTimeout(() => {
            retranslate = false
          }, 10)
          return translated.value
        } else {
          const marked = await parseWithRetry(
            () => ParseMarkdown(data, charArg, mode, chatID, getCbsCondition()),
            data,
          )
          if (!marked.ok) {
            return marked.value
          }
          const translated = await translateHTMLOnce(
            marked.value,
            charArg,
            chatID,
            retranslate,
            data,
          )
          if (!translated.ok) {
            return translated.value
          }
          lastParsedQueue = translated.value
          lastCharArg = charArg
          setTimeout(() => {
            retranslate = false
          }, 10)
          return translated.value
        }
      } else {
        const marked = await parseWithRetry(
          () => ParseMarkdown(data, charArg, mode, chatID, getCbsCondition()),
          data,
        )
        if (!marked.ok) {
          return marked.value
        }
        lastParsedQueue = marked.value
        lastCharArg = charArg
        return marked.value
      }
    } finally {
      //since trimMarkdown is fast, we don't need to cache it
      lastParsed = lastParsedQueue
    }
  }

  const checkImg = () => {
    if (!DBState.db.newImageHandlingBeta || !bodyRoot) {
      return
    }
    const imgs = bodyRoot.querySelectorAll(
      'img:not([src^="data:"]):not([src^="http:"]):not([src^="https:"]):not([src^="blob:"]):not([src^="file:"]):not([noimage])',
    ) as NodeListOf<HTMLImageElement>

    if (imgs.length > 0) {
      const currentCharacter = getCurrentCharacter()
      const styl = currentCharacter.prebuiltAssetStyle
      const assets = getModuleAssets().concat(currentCharacter.additionalAssets ?? [])
      const normalizedAssets = assets.map((asset) => {
        return {
          name: asset[0].toLocaleLowerCase(),
          path: asset[1],
        }
      })
      const exactAssets = new Map(normalizedAssets.map((asset) => [asset.name, asset.path]))

      imgs.forEach(async (img) => {
        const name = img.getAttribute('src')?.toLocaleLowerCase() || ''

        if (name.length > 200 || name.includes(':')) {
          img.setAttribute('noimage', 'true')
          return
        }

        const foundAsset = exactAssets.get(name)
        if (foundAsset) {
          img.classList.add('root-loaded-image')
          img.classList.add('root-loaded-image-' + styl)
          img.src = await getFileSrc(foundAsset)
          return
        }

        if (name.length < 3) {
          img.setAttribute('noimage', 'true')
          return
        }
        const prefixLoc = name.lastIndexOf('.')
        const prefix = prefixLoc > 0 ? name.substring(0, prefixLoc) : ''
        let currentDistance = 1000
        let currentFound = ''
        for (const asset of normalizedAssets) {
          if (!asset.name.startsWith(prefix)) {
            continue
          }
          const distance = getDistance(name, asset.name)
          if (distance < currentDistance) {
            currentDistance = distance
            currentFound = asset.path
          }
        }
        if (currentFound) {
          const got = await getFileSrc(currentFound)
          const name2 = img.getAttribute('src')?.toLocaleLowerCase() || ''
          if (name === name2) {
            img.setAttribute('src', got)
          }

          if (img.classList.length === 0) {
            img.classList.add('root-loaded-image')
            img.classList.add('root-loaded-image-' + styl)
          }
          img.removeAttribute('noimage')
        } else {
          img.setAttribute('noimage', 'true')
        }
      })
    }
  }

  let markParsingResult = $derived.by(() => markParsing(msgDisplay, character, idx))

  $effect(() => {
    markParsingResult
    checkImg()
    markParsingResult.then(checkImg)
  })
</script>

{#await markParsingResult}
  {@html addMetadataToElement(trimMarkdown(lastParsed), modelShortName)}
{:then md}
  {@html addMetadataToElement(trimMarkdown(md), modelShortName)}
{/await}
