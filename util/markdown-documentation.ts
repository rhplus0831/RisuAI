import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export interface MarkdownSourceLine {
  line: string
  lineNumber: number
}

export interface MarkdownLink {
  lineNumber: number
  target: string
}

interface FenceState {
  marker: '`' | '~'
  length: number
}

function fenceMarker(line: string): { marker: '`' | '~'; length: number; suffix: string } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return undefined
  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
    suffix: match[2],
  }
}

/** Return source lines that Markdown renders outside backtick or tilde fences. */
export function markdownLinesOutsideFences(markdown: string): MarkdownSourceLine[] {
  const lines: MarkdownSourceLine[] = []
  let fence: FenceState | undefined

  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    const candidate = fenceMarker(line)
    if (fence) {
      if (
        candidate?.marker === fence.marker &&
        candidate.length >= fence.length &&
        candidate.suffix.trim().length === 0
      ) {
        fence = undefined
      }
      continue
    }
    if (candidate) {
      fence = { marker: candidate.marker, length: candidate.length }
      continue
    }
    lines.push({ line, lineNumber: lineIndex + 1 })
  }

  return lines
}

function githubHeadingSlug(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, '$1')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Build GitHub-style heading IDs, including duplicate suffixes and explicit HTML IDs. */
export function markdownAnchorIds(markdown: string): Set<string> {
  const anchors = new Set<string>()
  const duplicateCounts = new Map<string, number>()
  const lines = markdownLinesOutsideFences(markdown)

  const addHeading = (heading: string): void => {
    const base = githubHeadingSlug(heading)
    const duplicateCount = duplicateCounts.get(base) ?? 0
    duplicateCounts.set(base, duplicateCount + 1)
    anchors.add(duplicateCount === 0 ? base : `${base}-${duplicateCount}`)
  }

  for (const [index, sourceLine] of lines.entries()) {
    const atxHeading = /^ {0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/.exec(sourceLine.line)
    if (atxHeading) addHeading(atxHeading[1])

    const setextUnderline = /^ {0,3}(?:=+|-+)[ \t]*$/.test(sourceLine.line)
    const previous = lines[index - 1]
    if (
      setextUnderline &&
      previous &&
      previous.lineNumber === sourceLine.lineNumber - 1 &&
      previous.line.trim().length > 0
    ) {
      addHeading(previous.line.trim())
    }

    for (const match of sourceLine.line.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(match[1])
  }

  return anchors
}

export function localMarkdownLinkTarget(rawTarget: string): string | undefined {
  const trimmed = rawTarget.trim()
  const target = trimmed.startsWith('<') ? /^<([^>]+)>/.exec(trimmed)?.[1] : /^\S+/.exec(trimmed)?.[0]
  if (!target || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined
  return target
}

/** Extract local inline Markdown links, excluding examples inside fenced code. */
export function markdownLocalLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = []
  for (const { line, lineNumber } of markdownLinesOutsideFences(markdown)) {
    for (const match of line.matchAll(/!?\[[^\]]*]\(([^)\n]+)\)/g)) {
      const target = localMarkdownLinkTarget(match[1])
      if (target) links.push({ lineNumber, target })
    }
  }
  return links
}

export function listMarkdownFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...listMarkdownFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath)
  }
  return files.sort()
}

export function resolveMarkdownLinkPath(repoRoot: string, sourcePath: string, target: string): string | undefined {
  const hashIndex = target.indexOf('#')
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex)
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch {
    return undefined
  }
  return decodedPath
    ? decodedPath.startsWith('/')
      ? path.resolve(repoRoot, `.${decodedPath}`)
      : path.resolve(path.dirname(sourcePath), decodedPath)
    : sourcePath
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

/** Validate local Markdown file targets and fragments for an explicit source set. */
export function validateMarkdownLinks(repoRoot: string, sourcePaths: readonly string[]): string[] {
  const errors: string[] = []

  for (const sourcePath of sourcePaths) {
    const sourceLabel = path.relative(repoRoot, sourcePath).replaceAll(path.sep, '/')
    const markdown = readFileSync(sourcePath, 'utf8')
    for (const { lineNumber, target } of markdownLocalLinks(markdown)) {
      const hashIndex = target.indexOf('#')
      const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex)
      const rawAnchor = hashIndex === -1 ? '' : target.slice(hashIndex + 1)
      let decodedPath: string
      let decodedAnchor: string
      try {
        decodedPath = decodeURIComponent(rawPath)
        decodedAnchor = decodeURIComponent(rawAnchor)
      } catch {
        errors.push(`${sourceLabel}:${lineNumber} has an invalid percent-encoded link ${JSON.stringify(target)}`)
        continue
      }

      let targetPath = decodedPath
        ? decodedPath.startsWith('/')
          ? path.resolve(repoRoot, `.${decodedPath}`)
          : path.resolve(path.dirname(sourcePath), decodedPath)
        : sourcePath
      if (!isPathWithinRoot(repoRoot, targetPath)) {
        errors.push(`${sourceLabel}:${lineNumber} links outside the repository ${JSON.stringify(target)}`)
        continue
      }
      if (!existsSync(targetPath)) {
        errors.push(`${sourceLabel}:${lineNumber} links to missing path ${JSON.stringify(target)}`)
        continue
      }
      if (!decodedAnchor) continue

      if (statSync(targetPath).isDirectory()) targetPath = path.join(targetPath, 'README.md')
      if (!existsSync(targetPath) || path.extname(targetPath).toLowerCase() !== '.md') {
        errors.push(`${sourceLabel}:${lineNumber} links to an anchor outside Markdown ${JSON.stringify(target)}`)
        continue
      }
      const anchors = markdownAnchorIds(readFileSync(targetPath, 'utf8'))
      if (!anchors.has(decodedAnchor)) {
        errors.push(`${sourceLabel}:${lineNumber} links to missing anchor ${JSON.stringify(target)}`)
      }
    }
  }

  return errors
}
