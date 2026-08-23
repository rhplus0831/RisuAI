import { isIOS } from './platform'
import { safeStructuredClone } from './safeStructuredClone'

export { safeStructuredClone } from './safeStructuredClone'

export type BaselineRuntimeFeature =
  | 'arrayAt'
  | 'arrayFindLast'
  | 'arrayFindLastIndex'
  | 'objectFromEntries'
  | 'objectHasOwn'
  | 'promiseAllSettled'
  | 'promiseAny'
  | 'stringReplaceAll'
  | 'structuredClone'

export type BaselineRuntimeSupport = Record<BaselineRuntimeFeature, boolean>

interface RuntimeEnvironmentTarget {
  Buffer?: BufferConstructor
  ReadableStream?: unknown
  TransformStream?: unknown
  WritableStream?: unknown
  polyfilledDragDrop?: boolean
  safeStructuredClone?: typeof safeStructuredClone
}

type DragDropModule = Pick<typeof import('mobile-drag-drop'), 'polyfill'>
type DragDropScrollModule = Pick<
  typeof import('mobile-drag-drop/scroll-behaviour'),
  'scrollBehaviourDragImageTranslateOverride'
>
type StreamPonyfillModule = Pick<
  typeof import('web-streams-polyfill/ponyfill/es2018'),
  'ReadableStream' | 'TransformStream' | 'WritableStream'
>

interface RuntimeEnvironmentLoaders {
  buffer: () => Promise<{ Buffer: BufferConstructor }>
  dragDrop: () => Promise<DragDropModule>
  dragDropScroll: () => Promise<DragDropScrollModule>
  streams: () => Promise<StreamPonyfillModule>
  baseline: Record<BaselineRuntimeFeature, () => Promise<unknown>>
}

export interface RuntimeEnvironmentOptions {
  documentTarget?: Pick<Document, 'createElement'>
  ios?: boolean
  loaders?: RuntimeEnvironmentLoaders
  runtimeSupport?: BaselineRuntimeSupport
  target?: RuntimeEnvironmentTarget
}

const defaultLoaders: RuntimeEnvironmentLoaders = {
  buffer: () => import('buffer'),
  dragDrop: () => import('mobile-drag-drop'),
  dragDropScroll: () => import('mobile-drag-drop/scroll-behaviour'),
  streams: () => import('web-streams-polyfill/ponyfill/es2018'),
  baseline: {
    arrayAt: () => import('core-js/actual/instance/at'),
    arrayFindLast: () => import('core-js/actual/array/find-last'),
    arrayFindLastIndex: () => import('core-js/actual/array/find-last-index'),
    objectFromEntries: () => import('core-js/actual/object/from-entries'),
    objectHasOwn: () => import('core-js/actual/object/has-own'),
    promiseAllSettled: () => import('core-js/actual/promise/all-settled'),
    promiseAny: () => import('core-js/actual/promise/any'),
    stringReplaceAll: () => import('core-js/actual/string/replace-all'),
    structuredClone: () => import('core-js/actual/structured-clone'),
  },
}

const BASELINE_RUNTIME_FEATURES = Object.freeze<BaselineRuntimeFeature[]>([
  'arrayAt',
  'arrayFindLast',
  'arrayFindLastIndex',
  'objectFromEntries',
  'objectHasOwn',
  'promiseAllSettled',
  'promiseAny',
  'stringReplaceAll',
  'structuredClone',
])

/** Runtime features used by application code and present in the supported Baseline target. */
export function detectBaselineRuntimeSupport(): BaselineRuntimeSupport {
  return {
    arrayAt: typeof Array.prototype.at === 'function',
    arrayFindLast: typeof Array.prototype.findLast === 'function',
    arrayFindLastIndex: typeof Array.prototype.findLastIndex === 'function',
    objectFromEntries: typeof Object.fromEntries === 'function',
    objectHasOwn: typeof Object.hasOwn === 'function',
    promiseAllSettled: typeof Promise.allSettled === 'function',
    promiseAny: typeof Promise.any === 'function',
    stringReplaceAll: typeof String.prototype.replaceAll === 'function',
    structuredClone: typeof globalThis.structuredClone === 'function',
  }
}

function supportsNativeDragDrop(documentTarget: Pick<Document, 'createElement'>): boolean {
  const testElement = documentTarget.createElement('div')
  const supports = 'draggable' in testElement || ('ondragstart' in testElement && 'ondrop' in testElement)
  testElement.remove()
  return supports
}

async function installBaselineRuntimePolyfills(
  support: BaselineRuntimeSupport,
  loaders: RuntimeEnvironmentLoaders['baseline'],
): Promise<void> {
  for (const feature of BASELINE_RUNTIME_FEATURES) {
    if (!support[feature]) await loaders[feature]()
  }
}

async function installBuffer(target: RuntimeEnvironmentTarget, loader: RuntimeEnvironmentLoaders['buffer']) {
  if (target.Buffer) return
  const { Buffer } = await loader()
  target.Buffer = Buffer
}

async function installStreams(target: RuntimeEnvironmentTarget, loader: RuntimeEnvironmentLoaders['streams']) {
  if (target.ReadableStream && target.TransformStream && target.WritableStream) return
  const streams = await loader()
  target.ReadableStream ??= streams.ReadableStream
  target.TransformStream ??= streams.TransformStream
  target.WritableStream ??= streams.WritableStream
}

async function installDragDrop(
  target: RuntimeEnvironmentTarget,
  documentTarget: Pick<Document, 'createElement'> | undefined,
  ios: boolean,
  loaders: Pick<RuntimeEnvironmentLoaders, 'dragDrop' | 'dragDropScroll'>,
): Promise<void> {
  if (!documentTarget) return

  let needsPolyfill = ios
  try {
    needsPolyfill ||= !supportsNativeDragDrop(documentTarget)
  } catch {
    return
  }
  if (!needsPolyfill) return

  const [{ polyfill }, { scrollBehaviourDragImageTranslateOverride }] = await Promise.all([
    loaders.dragDrop(),
    loaders.dragDropScroll(),
  ])
  target.polyfilledDragDrop = true
  polyfill({
    dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride,
    holdToDrag: 400,
    forceApply: true,
  })
}

/** Install required globals before the full application module graph is evaluated. */
export async function installRuntimeEnvironment(options: RuntimeEnvironmentOptions = {}): Promise<void> {
  const target = options.target ?? (globalThis as RuntimeEnvironmentTarget)
  const loaders = options.loaders ?? defaultLoaders
  const documentTarget = options.documentTarget ?? (typeof document === 'undefined' ? undefined : document)
  const ios = options.ios ?? (typeof navigator === 'undefined' ? false : isIOS())

  target.safeStructuredClone = safeStructuredClone
  await installBaselineRuntimePolyfills(options.runtimeSupport ?? detectBaselineRuntimeSupport(), loaders.baseline)
  await Promise.all([
    installBuffer(target, loaders.buffer),
    installStreams(target, loaders.streams),
    installDragDrop(target, documentTarget, ios, loaders),
  ])
}
