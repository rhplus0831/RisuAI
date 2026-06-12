import { cloneMCPTools, MCPClientLike } from './internalmcp'
import type { MCPTool, RPCToolCallContent } from './mcplib'

const FILE_SYSTEM_TOOLS: MCPTool[] = [
  {
    name: 'fs_read_file',
    description: 'Read contents of a file (supports text files, pdf, images)',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to selected directory',
        },
        limit: {
          type: 'number',
          description: 'Maximum bytes/content to read, bounded by file-type safety caps',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_write_file',
    description: 'Write contents to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to selected directory',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'fs_list_directory',
    description: 'List contents of a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory relative to selected directory (empty for root)',
        },
      },
      required: [],
    },
  },
  {
    name: 'fs_create_directory',
    description: 'Create a new directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to create relative to selected directory',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_delete_file',
    description: 'Delete a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to delete relative to selected directory',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_search_files',
    description: 'Search for files by name pattern or content',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (supports glob patterns like *.js, test*)',
        },
        content: {
          type: 'string',
          description: 'Search for files containing this text',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: root)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to search (default: 10)',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive search (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'fs_copy_file',
    description: 'Copy a file to another location',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source file path',
        },
        destination: {
          type: 'string',
          description: 'Destination file path',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'fs_move_file',
    description: 'Move/rename a file',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source file path',
        },
        destination: {
          type: 'string',
          description: 'Destination file path',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'fs_get_file_info',
    description: 'Get detailed information about a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_watch_directory',
    description: 'Watch a directory for changes',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to watch (default: root)',
        },
      },
      required: [],
    },
  },
  {
    name: 'fs_find_duplicates',
    description: 'Find duplicate files by content or name',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to search in (default: root)',
        },
        byContent: {
          type: 'boolean',
          description: 'Compare by content hash (default: false, compares by name)',
        },
      },
      required: [],
    },
  },
  {
    name: 'fs_tree_view',
    description: 'Get a tree view of the directory structure',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Root path for tree view (default: root)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to display (default: 5)',
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files (default: false)',
        },
      },
      required: [],
    },
  },
]

const DIRECTORY_PERMISSION_DENIED = 'Directory access permission was denied.'
export const FILESYSTEM_TEXT_READ_LIMIT_BYTES = 100000
export const FILESYSTEM_IMAGE_READ_LIMIT_BYTES = 5 * 1024 * 1024
export const FILESYSTEM_PDF_MAX_INPUT_BYTES = 16 * 1024 * 1024
export const FILESYSTEM_PDF_MAX_PAGES = 20
export const FILESYSTEM_PDF_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024
export const FILESYSTEM_SEARCH_CONTENT_MAX_FILE_BYTES = 1024 * 1024
export const FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES = 48 * 1024
let persistedDirectoryHandle: FileSystemDirectoryHandle | null = null

export function clearFileSystemDirectoryHandleForTests() {
  persistedDirectoryHandle = null
}

type FileReadOptions = {
  limit?: unknown
  signal?: AbortSignal
}

function normalizeReadLimit(value: unknown, fallback: number, cap: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(Math.floor(numeric), cap)
}

function toAbortSignal(value: unknown): AbortSignal | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (!('aborted' in value)) return undefined
  if (typeof (value as AbortSignal).addEventListener !== 'function') return undefined
  return value as AbortSignal
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Operation aborted', 'AbortError')
  }
  const error = new Error('Operation aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal)
  }
}

function encodeArrayBufferBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let base64 = ''

  for (let offset = 0; offset < bytes.length; offset += FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES)
    let binary = ''
    for (let i = 0; i < chunk.length; i += 1) {
      binary += String.fromCharCode(chunk[i])
    }
    base64 += btoa(binary)
  }

  return base64
}

async function getReusablePersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!persistedDirectoryHandle) return null

  try {
    await ensureDirectoryPermission(persistedDirectoryHandle)
    return persistedDirectoryHandle
  } catch (error) {
    if (isInvalidFileSystemHandleError(error)) {
      persistedDirectoryHandle = null
      return null
    }
    throw error
  }
}

async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const permissionHandle = handle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
    requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
  }

  if (!permissionHandle.queryPermission) return

  let permission = await permissionHandle.queryPermission({ mode: 'readwrite' })
  if (permission === 'granted') return

  if (permissionHandle.requestPermission) {
    permission = await permissionHandle.requestPermission({ mode: 'readwrite' })
  }

  if (permission !== 'granted') {
    throw new Error(DIRECTORY_PERMISSION_DENIED)
  }
}

function isInvalidFileSystemHandleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'NotFoundError' || error.name === 'InvalidStateError'
}

function formatDirectorySelectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Directory selection cancelled or failed. Please try again.'
  }
  if (error.message === DIRECTORY_PERMISSION_DENIED) {
    return DIRECTORY_PERMISSION_DENIED
  }
  if (error.name === 'AbortError') {
    return 'Directory selection cancelled. Please try again.'
  }
  if (error.message) {
    return `Directory selection failed: ${error.message}`
  }
  return 'Directory selection cancelled or failed. Please try again.'
}

export class FileSystemClient extends MCPClientLike {
  private directoryHandle: FileSystemDirectoryHandle | null = persistedDirectoryHandle
  private initialized: boolean = false

  constructor() {
    super('internal:fs')
    this.serverInfo.serverInfo.name = 'File System Access MCP'
    this.serverInfo.serverInfo.version = '1.0.0'
    this.serverInfo.instructions = 'FProvides file system access using the File System Access API'
  }

  async checkHandshake() {
    if (!this.initialized) {
      await this.initializeDirectory()
      this.initialized = true
    }
    return this.serverInfo
  }

  private async initializeDirectory(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      throw new Error(
        'File System Access API is not supported in this browser. Please use a compatible browser like Chrome or Edge.',
      )
    }

    const reusableHandle = await getReusablePersistedDirectoryHandle()
    if (reusableHandle) {
      this.directoryHandle = reusableHandle
      return
    }

    try {
      const directoryHandle = await (window as any).showDirectoryPicker()
      if (!directoryHandle) {
        throw new Error('Directory selection was cancelled or failed.')
      }
      await ensureDirectoryPermission(directoryHandle)
      persistedDirectoryHandle = directoryHandle
      this.directoryHandle = directoryHandle
      console.log(`FileSystemClient: Selected directory: ${directoryHandle.name}`)
    } catch (error) {
      throw new Error(formatDirectorySelectionError(error))
    }
  }

  async getToolList(): Promise<MCPTool[]> {
    return cloneMCPTools(FILE_SYSTEM_TOOLS)
  }

  async callTool(toolName: string, args: any): Promise<RPCToolCallContent[]> {
    try {
      switch (toolName) {
        case 'fs_read_file':
          return await this.readFile(args.path, {
            limit: args.limit,
            signal: toAbortSignal(args.signal),
          })
        case 'fs_write_file':
          return await this.writeFile(args.path, args.content)
        case 'fs_list_directory':
          return await this.listDirectory(args.path || '')
        case 'fs_create_directory':
          return await this.createDirectory(args.path)
        case 'fs_delete_file':
          return await this.deleteFile(args.path)
        case 'fs_search_files':
          return await this.searchFiles(args)
        case 'fs_copy_file':
          return await this.copyFile(args.source, args.destination)
        case 'fs_move_file':
          return await this.moveFile(args.source, args.destination)
        case 'fs_get_file_info':
          return await this.getFileInfo(args.path)
        case 'fs_find_duplicates':
          return await this.findDuplicates(args.path || '', args.byContent || false)
        case 'fs_tree_view':
          return await this.getTreeView(args.path || '', args.maxDepth || 5, args.showHidden || false)
        default:
          return [
            {
              type: 'text',
              text: `Unknown tool: ${toolName}`,
            },
          ]
      }
    } catch (error) {
      return [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ]
    }
  }

  private async readFile(path: string, options: FileReadOptions = {}): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    throwIfAborted(options.signal)
    const fileHandle = await this.getFileHandle(path)
    const file = await fileHandle.getFile()
    throwIfAborted(options.signal)

    // Check file size
    if (file.size === 0) {
      return [
        {
          type: 'text',
          text: 'File is empty',
        },
      ]
    }

    if (file.name.endsWith('.pdf')) {
      const pdfLimit = normalizeReadLimit(
        options.limit,
        FILESYSTEM_PDF_OUTPUT_LIMIT_BYTES,
        FILESYSTEM_PDF_OUTPUT_LIMIT_BYTES,
      )
      return await this.readFileAsPDF(file, pdfLimit, options.signal)
    }

    // Auto-detect encoding
    const encoding = this.detectFileEncoding(file)

    try {
      if (encoding === 'base64') {
        const imageLimit = normalizeReadLimit(
          options.limit,
          FILESYSTEM_IMAGE_READ_LIMIT_BYTES,
          FILESYSTEM_IMAGE_READ_LIMIT_BYTES,
        )
        return await this.readFileAsBase64(file, 0, imageLimit)
      } else {
        const textLimit = normalizeReadLimit(
          options.limit,
          FILESYSTEM_TEXT_READ_LIMIT_BYTES,
          FILESYSTEM_TEXT_READ_LIMIT_BYTES,
        )
        return await this.readFileAsText(file, 0, textLimit)
      }
    } catch (error) {
      return [
        {
          type: 'text',
          text: `Error reading file: ${error.message}. Only text/code files and images are supported.`,
        },
      ]
    }
  }

  private async readFileAsPDF(file: File, limit: number, signal?: AbortSignal): Promise<RPCToolCallContent[]> {
    if (file.size > FILESYSTEM_PDF_MAX_INPUT_BYTES) {
      return [
        {
          type: 'text',
          text: `PDF is too large to render (${this.formatBytes(file.size)}; cap ${this.formatBytes(
            FILESYSTEM_PDF_MAX_INPUT_BYTES,
          )})`,
        },
      ]
    }

    throwIfAborted(signal)
    const { convertPdfToImages } = await import('src/ts/process/dynamicutils/pdf.js')
    throwIfAborted(signal)
    const pdfBuffer = await file.arrayBuffer()
    throwIfAborted(signal)
    const images = await convertPdfToImages(pdfBuffer, {
      scale: 1.5,
      format: 'jpeg',
      quality: 0.8,
      maxPages: FILESYSTEM_PDF_MAX_PAGES,
      maxOutputBytes: limit,
      signal,
    })
    throwIfAborted(signal)
    if (images.length === 0) {
      return [
        {
          type: 'text',
          text: `No images extracted from PDF within ${this.formatBytes(limit)} output limit`,
        },
      ]
    }
    const result: RPCToolCallContent[] = []
    let outputBytes = 0
    let truncated = false
    for (const image of images) {
      const nextBytes = image.length
      if (outputBytes + nextBytes > limit) {
        truncated = true
        break
      }
      result.push({
        type: 'image',
        data: image,
        mimeType: 'image/jpeg',
      })
      outputBytes += nextBytes
    }

    if (result.length === 0) {
      return [
        {
          type: 'text',
          text: `PDF render output exceeded ${this.formatBytes(limit)} before any page could be returned`,
        },
      ]
    }

    if (truncated || images.length >= FILESYSTEM_PDF_MAX_PAGES) {
      result.unshift({
        type: 'text',
        text: `PDF rendering capped at ${this.formatBytes(limit)} and ${FILESYSTEM_PDF_MAX_PAGES} pages`,
      })
    }
    return result
  }

  private detectFileEncoding(file: File): string {
    const mimeType = file.type.toLowerCase()
    const fileName = file.name.toLowerCase()

    // Image types we support
    const imageTypes = ['image/']
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico']

    // Check if it's an image
    if (imageTypes.some((type) => mimeType.startsWith(type)) || imageExtensions.some((ext) => fileName.endsWith(ext))) {
      return 'base64'
    }

    // Everything else is treated as text (includes code files like .js, .json, .html, .css, .md, etc.)
    return 'text'
  }

  private async readFileAsText(file: File, offset: number, limit: number): Promise<RPCToolCallContent[]> {
    let content: string

    if (offset === 0 && file.size <= limit) {
      // Read entire file
      content = await file.text()
    } else {
      // Read partial file
      const endOffset = Math.min(offset + limit, file.size)
      const slice = file.slice(offset, endOffset)
      content = await slice.text()
    }

    // Check if content was truncated
    const wasTruncated = offset + content.length < file.size
    const info: string[] = []

    if (offset > 0) {
      info.push(`Reading from byte ${offset}`)
    }

    if (wasTruncated) {
      info.push(`Content truncated (showing ${content.length} of ${file.size - offset} remaining bytes)`)
    }

    const result = info.length > 0 ? `${info.join(', ')}\n\n${content}` : content

    return [
      {
        type: 'text',
        text: result,
      },
    ]
  }

  private async readFileAsBase64(file: File, offset: number, limit: number): Promise<RPCToolCallContent[]> {
    let arrayBuffer: ArrayBuffer

    if (offset === 0 && file.size <= limit) {
      // Read entire file
      arrayBuffer = await file.arrayBuffer()
    } else {
      // Read partial file
      const endOffset = Math.min(offset + limit, file.size)
      const slice = file.slice(offset, endOffset)
      arrayBuffer = await slice.arrayBuffer()
    }

    const base64 = encodeArrayBufferBase64(arrayBuffer)

    // Check if content was truncated
    const wasTruncated = offset + arrayBuffer.byteLength < file.size
    const info: string[] = [`File type: ${file.type || 'unknown'}`, `Size: ${this.formatBytes(file.size)}`]

    if (offset > 0) {
      info.push(`Reading from byte ${offset}`)
    }

    if (wasTruncated) {
      info.push(`Content truncated (showing ${arrayBuffer.byteLength} of ${file.size - offset} remaining bytes)`)
    }

    const result: RPCToolCallContent[] = []
    if (offset > 0 || wasTruncated) {
      result.push({
        type: 'text',
        text: info.join(', '),
      })
    }

    result.push({
      type: 'image',
      data: base64,
      mimeType: file.type || 'application/octet-stream',
    })

    return result
  }

  private async writeFile(path: string, content: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory selected. Use fs_select_directory first.',
        },
      ]
    }

    const fileHandle = await this.getFileHandle(path, true)
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()

    return [
      {
        type: 'text',
        text: `Successfully wrote ${content.length} characters to ${path}`,
      },
    ]
  }

  private async listDirectory(path: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory selected. Use fs_select_directory first.',
        },
      ]
    }

    const dirHandle = path ? await this.getDirectoryHandle(path) : this.directoryHandle
    const entries: string[] = []

    for await (const [name, handle] of dirHandle.entries()) {
      const type = handle.kind === 'directory' ? '[DIR]' : '[FILE]'
      entries.push(`${type} ${name}`)
    }

    return [
      {
        type: 'text',
        text: entries.length > 0 ? entries.join('\n') : 'Directory is empty',
      },
    ]
  }

  private async createDirectory(path: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory selected. Use fs_select_directory first.',
        },
      ]
    }

    await this.getDirectoryHandle(path, true)

    return [
      {
        type: 'text',
        text: `Successfully created directory: ${path}`,
      },
    ]
  }

  private async deleteFile(path: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory selected. Use fs_select_directory first.',
        },
      ]
    }

    const pathParts = path.split('/').filter((part) => part.length > 0)
    const fileName = pathParts.pop()!

    let currentDir = this.directoryHandle
    for (const part of pathParts) {
      currentDir = await currentDir.getDirectoryHandle(part)
    }

    await currentDir.removeEntry(fileName)

    return [
      {
        type: 'text',
        text: `Successfully deleted: ${path}`,
      },
    ]
  }

  private async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const pathParts = path.split('/').filter((part) => part.length > 0)
    const fileName = pathParts.pop()!

    let currentDir = this.directoryHandle!
    for (const part of pathParts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create })
    }

    return await currentDir.getFileHandle(fileName, { create })
  }

  private async getDirectoryHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    const pathParts = path.split('/').filter((part) => part.length > 0)

    let currentDir = this.directoryHandle!
    for (const part of pathParts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create })
    }

    return currentDir
  }

  private async searchFiles(args: {
    pattern?: string
    content?: string
    path?: string
    maxDepth?: number
    caseSensitive?: boolean
  }): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    const searchPath = args.path || ''
    const maxDepth = args.maxDepth || 10
    const caseSensitive = args.caseSensitive || false
    const results: string[] = []
    const skippedLargeFiles: string[] = []

    const searchDir = searchPath ? await this.getDirectoryHandle(searchPath) : this.directoryHandle

    await this.searchInDirectory(
      searchDir,
      args.pattern,
      args.content,
      '',
      maxDepth,
      caseSensitive,
      results,
      skippedLargeFiles,
    )

    const skippedText =
      skippedLargeFiles.length > 0
        ? `\n\nSkipped ${skippedLargeFiles.length} file(s) larger than ${this.formatBytes(
            FILESYSTEM_SEARCH_CONTENT_MAX_FILE_BYTES,
          )} content-search cap:\n${skippedLargeFiles.slice(0, 20).join('\n')}${
            skippedLargeFiles.length > 20 ? '\n...' : ''
          }`
        : ''

    return [
      {
        type: 'text',
        text:
          results.length > 0
            ? `Found ${results.length} matches:\n${results.join('\n')}${skippedText}`
            : `No matches found${skippedText}`,
      },
    ]
  }

  private async searchInDirectory(
    dirHandle: FileSystemDirectoryHandle,
    pattern?: string,
    content?: string,
    currentPath: string = '',
    maxDepth: number = 10,
    caseSensitive: boolean = false,
    results: string[] = [],
    skippedLargeFiles: string[] = [],
  ): Promise<void> {
    if (maxDepth <= 0) return

    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name

      if (handle.kind === 'file') {
        let matches = false

        // Pattern matching
        if (pattern) {
          const regex = this.globToRegex(pattern, caseSensitive)
          matches = regex.test(name)
        }

        // Content search
        if (!matches && content) {
          try {
            const file = await handle.getFile()
            if (file.size > FILESYSTEM_SEARCH_CONTENT_MAX_FILE_BYTES) {
              skippedLargeFiles.push(fullPath)
              continue
            }
            const text = await file.text()
            const searchText = caseSensitive ? text : text.toLowerCase()
            const searchContent = caseSensitive ? content : content.toLowerCase()
            matches = searchText.includes(searchContent)
          } catch (error) {
            // Skip files that can't be read
          }
        }

        if (matches || (!pattern && !content)) {
          results.push(fullPath)
        }
      } else if (handle.kind === 'directory') {
        await this.searchInDirectory(
          handle,
          pattern,
          content,
          fullPath,
          maxDepth - 1,
          caseSensitive,
          results,
          skippedLargeFiles,
        )
      }
    }
  }

  private globToRegex(pattern: string, caseSensitive: boolean): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')

    const flags = caseSensitive ? '' : 'i'
    return new RegExp(`^${escaped}$`, flags)
  }

  private async copyFile(source: string, destination: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    const sourceHandle = await this.getFileHandle(source)
    const file = await sourceHandle.getFile()
    const content = await file.arrayBuffer()

    const destHandle = await this.getFileHandle(destination, true)
    const writable = await destHandle.createWritable()
    await writable.write(content)
    await writable.close()

    return [
      {
        type: 'text',
        text: `Successfully copied ${source} to ${destination}`,
      },
    ]
  }

  private async moveFile(source: string, destination: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    // Copy the file first
    await this.copyFile(source, destination)

    // Then delete the source
    await this.deleteFile(source)

    return [
      {
        type: 'text',
        text: `Successfully moved ${source} to ${destination}`,
      },
    ]
  }

  private async getFileInfo(path: string): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    try {
      const fileHandle = await this.getFileHandle(path)
      const file = await fileHandle.getFile()

      const info = [
        `File: ${path}`,
        `Name: ${file.name}`,
        `Size: ${this.formatBytes(file.size)}`,
        `Type: ${file.type || 'Unknown'}`,
        `Last Modified: ${new Date(file.lastModified).toLocaleString()}`,
      ]

      return [
        {
          type: 'text',
          text: info.join('\n'),
        },
      ]
    } catch (error) {
      // Try as directory
      try {
        const dirHandle = await this.getDirectoryHandle(path)
        let fileCount = 0
        let dirCount = 0

        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'file') fileCount++
          else dirCount++
        }

        const info = [`Directory: ${path}`, `Files: ${fileCount}`, `Subdirectories: ${dirCount}`]

        return [
          {
            type: 'text',
            text: info.join('\n'),
          },
        ]
      } catch (dirError) {
        return [
          {
            type: 'text',
            text: `Path not found: ${path}`,
          },
        ]
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  private async findDuplicates(path: string, byContent: boolean): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    const searchDir = path ? await this.getDirectoryHandle(path) : this.directoryHandle
    const files: { path: string; name: string; content?: string; hash?: string }[] = []

    await this.collectFiles(searchDir, '', files)

    if (byContent) {
      // Group by content hash
      const hashMap = new Map<string, string[]>()

      for (const file of files) {
        try {
          const fileHandle = await this.getFileHandle(file.path)
          const fileObj = await fileHandle.getFile()
          const arrayBuffer = await fileObj.arrayBuffer()
          const hash = await this.generateHash(arrayBuffer)

          if (!hashMap.has(hash)) {
            hashMap.set(hash, [])
          }
          hashMap.get(hash)!.push(file.path)
        } catch (error) {
          // Skip files that can't be read
        }
      }

      const duplicates: string[] = []
      for (const [hash, paths] of hashMap) {
        if (paths.length > 1) {
          duplicates.push(`Duplicate content (${paths.length} files):`)
          paths.forEach((p) => duplicates.push(`  ${p}`))
          duplicates.push('')
        }
      }

      return [
        {
          type: 'text',
          text: duplicates.length > 0 ? duplicates.join('\n') : 'No duplicate files found by content',
        },
      ]
    } else {
      // Group by name
      const nameMap = new Map<string, string[]>()

      for (const file of files) {
        if (!nameMap.has(file.name)) {
          nameMap.set(file.name, [])
        }
        nameMap.get(file.name)!.push(file.path)
      }

      const duplicates: string[] = []
      for (const [name, paths] of nameMap) {
        if (paths.length > 1) {
          duplicates.push(`Duplicate name "${name}" (${paths.length} files):`)
          paths.forEach((p) => duplicates.push(`  ${p}`))
          duplicates.push('')
        }
      }

      return [
        {
          type: 'text',
          text: duplicates.length > 0 ? duplicates.join('\n') : 'No duplicate files found by name',
        },
      ]
    }
  }

  private async collectFiles(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string,
    files: { path: string; name: string }[],
  ): Promise<void> {
    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name

      if (handle.kind === 'file') {
        files.push({ path: fullPath, name })
      } else if (handle.kind === 'directory') {
        await this.collectFiles(handle, fullPath, files)
      }
    }
  }

  private async generateHash(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async getTreeView(path: string, maxDepth: number, showHidden: boolean): Promise<RPCToolCallContent[]> {
    if (!this.directoryHandle) {
      return [
        {
          type: 'text',
          text: 'No directory available. Directory selection may have been cancelled or failed.',
        },
      ]
    }

    const searchDir = path ? await this.getDirectoryHandle(path) : this.directoryHandle
    const tree: string[] = []

    await this.buildTree(searchDir, '', maxDepth, showHidden, tree)

    return [
      {
        type: 'text',
        text: tree.length > 0 ? tree.join('\n') : 'Empty directory',
      },
    ]
  }

  private async buildTree(
    dirHandle: FileSystemDirectoryHandle,
    prefix: string,
    maxDepth: number,
    showHidden: boolean,
    tree: string[],
  ): Promise<void> {
    if (maxDepth <= 0) return

    const entries: [string, FileSystemHandle][] = []
    for await (const entry of dirHandle.entries()) {
      entries.push(entry)
    }

    // Filter hidden files if needed
    const filteredEntries = showHidden ? entries : entries.filter(([name]) => !name.startsWith('.'))

    // Sort: directories first, then files
    filteredEntries.sort(([nameA, handleA], [nameB, handleB]) => {
      if (handleA.kind !== handleB.kind) {
        return handleA.kind === 'directory' ? -1 : 1
      }
      return nameA.localeCompare(nameB)
    })

    for (let i = 0; i < filteredEntries.length; i++) {
      const [name, handle] = filteredEntries[i]
      const isLast = i === filteredEntries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const icon = handle.kind === 'directory' ? '📁 ' : '📄 '

      tree.push(`${prefix}${connector}${icon}${name}`)

      if (handle.kind === 'directory') {
        const newPrefix = prefix + (isLast ? '    ' : '│   ')
        await this.buildTree(handle as FileSystemDirectoryHandle, newPrefix, maxDepth - 1, showHidden, tree)
      }
    }
  }
}
