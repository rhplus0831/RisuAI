import {
  DIAGNOSTICS_ENDPOINT,
  DIAGNOSTICS_LIMIT,
  isDiagnosticsResponse,
  projectDiagnosticEntry,
  type DiagnosticEntry,
  type DiagnosticsResponse,
} from '@risuai/protocol/diagnostics'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import versionData from '../../../version.json'

export async function fetchClientDiagnostics(signal?: AbortSignal): Promise<DiagnosticsResponse> {
  const auth = await getNodeServerProxyAuth()
  const response = await fetch(DIAGNOSTICS_ENDPOINT, {
    signal,
    cache: 'no-store',
    headers: { 'risu-auth': auth },
  })
  if (!response.ok) throw new Error('diagnostics-unavailable')
  const result: unknown = await response.json()
  if (!isDiagnosticsResponse(result)) throw new Error('invalid-diagnostics')
  return result
}

export function diagnosticEntryText(entry: DiagnosticEntry): string {
  const safe = projectDiagnosticEntry(entry)
  if (!safe) return ''
  const { timestamp, source, level, event, ...fields } = safe
  return `${new Date(timestamp).toISOString()} ${source} ${level} ${event} ${JSON.stringify(fields)}`
}

export function buildDiagnosticsReport(
  browser: DiagnosticEntry[],
  server: DiagnosticEntry[],
  serverStatus: 'current' | 'unavailable',
): string {
  // The report deliberately does not read settings, transcripts, fetch logs, or raw UA/URL values.
  const agent = navigator.userAgent
  const browserFamily = /Firefox\//.test(agent)
    ? 'Firefox'
    : /Edg\//.test(agent)
      ? 'Edge'
      : /(?:Chrome|CriOS)\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Other'
  const os = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Other'
  const version = /^\d[\w.+-]{0,40}$/.test(versionData.version) ? versionData.version : 'unknown'
  const safeEntries = [...browser.slice(-DIAGNOSTICS_LIMIT), ...server.slice(-DIAGNOSTICS_LIMIT)]
    .map(projectDiagnosticEntry)
    .filter((entry): entry is DiagnosticEntry => entry !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
  return [
    'RisuAI diagnostic report v1',
    `Version: ${version}`,
    `Browser: ${browserFamily}`,
    `OS: ${os}`,
    `Online: ${navigator.onLine}`,
    `Viewport: ${window.innerWidth} x ${window.innerHeight}`,
    `Server diagnostics: ${serverStatus}`,
    `Exported: ${new Date().toISOString()}`,
    'Content policy: no message/prompt text, request/response bodies, headers, credentials, raw URLs, or free-form log messages.',
    '',
    ...safeEntries.map(diagnosticEntryText),
    '',
  ].join('\n')
}
