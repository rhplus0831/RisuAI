<script lang="ts">
  import { untrack } from 'svelte'
  import { sleep } from 'src/ts/util'
  import { alertError } from '../../ts/alert'
  import {
    addMetadataToElement,
    getDistance,
    postTranslationParse,
    trimMarkdown,
    type CbsConditions,
    type simpleCharacterArgument,
  } from '../../ts/parser/parser.svelte'
  import { translateHTML } from '../../ts/translator/translator'
  import { getModuleAssets } from 'src/ts/process/modules'
  import { getCurrentCharacter, getDatabase } from 'src/ts/storage/database.svelte'
  import { getFileSrc } from 'src/ts/globalApi.svelte'
  import { RegexDisplayReloadPointer } from 'src/ts/process/regexDisplayReload'
  import {
    getChatBodyCachedOnlyLlmDecision,
    getChatBodyCachedOnlyLlmDetectionMode,
    getChatBodyCachedOnlyLlmDetectionKey,
    getChatBodyParseMemoKey,
    memoizedChatBodyParse,
  } from './ChatBodyParseMemo'

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
    allowClientTranslation?: boolean
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
    allowClientTranslation = true,
    bodyRoot,
    modelShortName = '',
  }: Props = $props()

  // svelte-ignore non_reactive_update
  let lastParsed = ''
  let lastTranslationDetectionKey = ''
  let markParsingRun = 0

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
    const parsingError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error))
    alertError(`Error while parsing chat message: ${translated}, ${parsingError.message}, ${parsingError.stack}`)
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
    setTranslating: (value: boolean) => void,
  ): Promise<{ ok: true; value: string } | { ok: false; value: string }> {
    setTranslating(true)
    try {
      return {
        ok: true,
        value: await translateHTML(html, false, charArg, chatID, regenerate),
      }
    } catch (error) {
      reportParsingError(error)
      return { ok: false, value: fallback }
    } finally {
      setTranslating(false)
    }
  }

  const markParsing = async (data: string, charArg: string | simpleCharacterArgument, chatID: number) => {
    const runId = ++markParsingRun
    const setTranslatingForRun = (value: boolean) => {
      if (runId === markParsingRun) {
        translating = value
      }
    }
    // track 'translated' and 'retranslate' state
    translated
    retranslate
    let lastParsedQueue = ''
    let mode = 'notrim' as const
    const cbsConditions = getCbsCondition()

    try {
      const cachedOnlyDetectionMode = getChatBodyCachedOnlyLlmDetectionMode({
        fallbackMode: mode,
      })
      const cachedOnlyParseKey =
        cachedOnlyDetectionMode === 'raw'
          ? undefined
          : getChatBodyParseMemoKey({
              data,
              charArg,
              mode: cachedOnlyDetectionMode,
              chatID,
              cbsConditions,
            })
      const detectionKey = getChatBodyCachedOnlyLlmDetectionKey({
        data,
        charArg,
        chatID,
        cbsConditions,
        fallbackMode: mode,
        cachedOnlyParseKey,
      })
      if (allowClientTranslation && !retranslate && detectionKey !== lastTranslationDetectionKey) {
        lastParsedQueue = ''
        lastTranslationDetectionKey = detectionKey
        let translateText = false
        try {
          const database = getDatabase()
          if (database.autoTranslate) {
            if (database.autoTranslateCachedOnly && database.translatorType === 'llm') {
              translateText = await getChatBodyCachedOnlyLlmDecision({
                data,
                charArg,
                chatID,
                cbsConditions,
                fallbackMode: mode,
                cachedOnlyParseKey,
                detectionKey,
              })
            } else {
              translateText = true
            }
          }

          const lastTranslated = translated

          setTimeout(() => {
            if (runId === markParsingRun) {
              translated = translateText
            }
          }, 10)

          // State change of `translated` triggers markParsing again,
          // causing redundant translation attempts.
          if (lastTranslated !== translateText) {
            return
          }
        } catch (error) {
          console.error(error)
        }
      }

      if (allowClientTranslation && (retranslate || translated)) {
        const database = getDatabase()
        if (database.showTranslationLoading) {
          lastParsed = `<div style="display:flex;justify-content:center;align-items:center;height:48px;"><div style="animation: spin 1s linear infinite; border-radius: 50%; height: 32px; width: 32px; border: 2px solid #3b82f6; border-top: 2px solid transparent;"></div></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`
        }

        if (database.translatorType === 'llm' && database.translateBeforeHTMLFormatting) {
          await sleep(100)
          const translatedHtml = await translateHTMLOnce(data, charArg, chatID, retranslate, data, setTranslatingForRun)
          if (!translatedHtml.ok) {
            return translatedHtml.value
          }
          const marked = await parseWithRetry(
            () =>
              memoizedChatBodyParse({
                data: translatedHtml.value,
                charArg,
                mode,
                chatID,
                cbsConditions,
              }),
            data,
          )
          if (!marked.ok) {
            return marked.value
          }
          lastParsedQueue = marked.value
          setTimeout(() => {
            if (runId === markParsingRun) {
              retranslate = false
            }
          }, 10)
          return marked.value
        } else if (!database.legacyTranslation) {
          const marked = await parseWithRetry(
            () =>
              memoizedChatBodyParse({
                data,
                charArg,
                mode: 'pretranslate',
                chatID,
                cbsConditions,
              }),
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
            setTranslatingForRun,
          )
          if (!translatedHtml.ok) {
            return translatedHtml.value
          }
          const translated = await parseWithRetry(
            () => Promise.resolve(postTranslationParse(translatedHtml.value)),
            data,
          )
          if (!translated.ok) {
            return translated.value
          }
          lastParsedQueue = translated.value
          setTimeout(() => {
            if (runId === markParsingRun) {
              retranslate = false
            }
          }, 10)
          return translated.value
        } else {
          const marked = await parseWithRetry(
            () =>
              memoizedChatBodyParse({
                data,
                charArg,
                mode,
                chatID,
                cbsConditions,
              }),
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
            setTranslatingForRun,
          )
          if (!translated.ok) {
            return translated.value
          }
          lastParsedQueue = translated.value
          setTimeout(() => {
            if (runId === markParsingRun) {
              retranslate = false
            }
          }, 10)
          return translated.value
        }
      } else {
        const marked = await parseWithRetry(
          () =>
            memoizedChatBodyParse({
              data,
              charArg,
              mode,
              chatID,
              cbsConditions,
            }),
          data,
        )
        if (!marked.ok) {
          return marked.value
        }
        lastParsedQueue = marked.value
        return marked.value
      }
    } finally {
      // Since trimMarkdown is fast, we don't need to cache it.
      if (runId === markParsingRun) {
        lastParsed = lastParsedQueue
      }
    }
  }

  const checkImg = () => {
    if (!getDatabase().newImageHandlingBeta || !bodyRoot) {
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

  let markParsingResult = $derived.by(() => {
    void $RegexDisplayReloadPointer
    const parseData = msgDisplay
    const parseCharacter = character
    const parseIndex = idx

    // These local inputs intentionally restart parsing. Database reads made by
    // the parser are snapshots; their UI activation is controlled by the
    // explicit reload pointers instead of deep subscriptions per chat row.
    void translated
    void retranslate
    void allowClientTranslation
    void firstMessage
    void role

    return untrack(() => markParsing(parseData, parseCharacter, parseIndex))
  })

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
