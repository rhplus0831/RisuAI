import type { CbsConditions } from '../../ts/parser/parser.svelte'
import { risuChatParser } from 'src/ts/process/scripts'

const CUSTOM_HTML_TEMPLATE_MEMO_LIMIT = 8

const customHtmlTemplateMemo = new Map<string, HTMLElement>()

function normalizedCbsConditions(cbsConditions: CbsConditions = {}) {
  return {
    firstmsg: cbsConditions.firstmsg ?? false,
    chatRole: cbsConditions.chatRole ?? null,
  }
}

function customHtmlTemplateKey(html: string, cbsConditions: CbsConditions, cacheScopeKey = '') {
  return JSON.stringify({
    html,
    cbsConditions: normalizedCbsConditions(cbsConditions),
    cacheScopeKey,
  })
}

function rememberCustomHtmlTemplate(key: string, body: HTMLElement) {
  customHtmlTemplateMemo.set(key, body)
  while (customHtmlTemplateMemo.size > CUSTOM_HTML_TEMPLATE_MEMO_LIMIT) {
    const oldest = customHtmlTemplateMemo.keys().next().value
    if (oldest === undefined) break
    customHtmlTemplateMemo.delete(oldest)
  }
  return body
}

function refreshCustomHtmlTemplate(key: string, body: HTMLElement) {
  customHtmlTemplateMemo.delete(key)
  customHtmlTemplateMemo.set(key, body)
  return body
}

export function renderCustomHtmlTemplate(
  html: string | null | undefined,
  cbsConditions: CbsConditions,
  cacheScopeKey = '',
) {
  const templateHtml = html ?? ''
  const key = customHtmlTemplateKey(templateHtml, cbsConditions, cacheScopeKey)
  const cached = customHtmlTemplateMemo.get(key)
  if (cached) {
    return refreshCustomHtmlTemplate(key, cached)
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(
      risuChatParser(templateHtml, {
        cbsConditions: normalizedCbsConditions(cbsConditions),
      }),
      'text/html',
    )
    return rememberCustomHtmlTemplate(key, doc.body)
  } catch {
    return document.createElement('div')
  }
}

export function clearCustomHtmlTemplateMemo() {
  customHtmlTemplateMemo.clear()
}

export function getCustomHtmlTemplateMemoSize() {
  return customHtmlTemplateMemo.size
}
