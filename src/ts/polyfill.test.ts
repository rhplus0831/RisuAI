import { describe, expect, it, vi } from 'vitest'
import {
  detectBaselineRuntimeSupport,
  installRuntimeEnvironment,
  type BaselineRuntimeFeature,
  type BaselineRuntimeSupport,
  type RuntimeEnvironmentOptions,
} from './polyfill'

const allSupported: BaselineRuntimeSupport = {
  arrayAt: true,
  arrayFindLast: true,
  arrayFindLastIndex: true,
  objectFromEntries: true,
  objectHasOwn: true,
  promiseAllSettled: true,
  promiseAny: true,
  stringReplaceAll: true,
  structuredClone: true,
}

type TestLoaders = NonNullable<RuntimeEnvironmentOptions['loaders']>
type TestDragDropModule = Awaited<ReturnType<TestLoaders['dragDrop']>>
type TestDragDropScrollModule = Awaited<ReturnType<TestLoaders['dragDropScroll']>>
type TestStreamModule = Awaited<ReturnType<TestLoaders['streams']>>

function createBaselineLoaders() {
  return {
    arrayAt: vi.fn(async () => undefined),
    arrayFindLast: vi.fn(async () => undefined),
    arrayFindLastIndex: vi.fn(async () => undefined),
    objectFromEntries: vi.fn(async () => undefined),
    objectHasOwn: vi.fn(async () => undefined),
    promiseAllSettled: vi.fn(async () => undefined),
    promiseAny: vi.fn(async () => undefined),
    stringReplaceAll: vi.fn(async () => undefined),
    structuredClone: vi.fn(async () => undefined),
  } satisfies Record<BaselineRuntimeFeature, () => Promise<unknown>>
}

function nativeDragDocument() {
  return {
    createElement: vi.fn(() => ({ draggable: false, remove: vi.fn() })),
  } as unknown as Pick<Document, 'createElement'>
}

function createLoaders(): {
  dragImageTranslateOverride: TestDragDropScrollModule['scrollBehaviourDragImageTranslateOverride']
  dragPolyfill: TestDragDropModule['polyfill']
  loaders: TestLoaders
  streamPonyfills: TestStreamModule
} {
  const dragPolyfill = vi.fn(() => true) as TestDragDropModule['polyfill']
  const dragImageTranslateOverride = vi.fn() as TestDragDropScrollModule['scrollBehaviourDragImageTranslateOverride']
  const streamPonyfills = {
    ReadableStream: class TestReadableStream {},
    TransformStream: class TestTransformStream {},
    WritableStream: class TestWritableStream {},
  } as unknown as TestStreamModule
  return {
    dragImageTranslateOverride,
    dragPolyfill,
    streamPonyfills,
    loaders: {
      buffer: vi.fn(async () => ({ Buffer: globalThis.Buffer })),
      dragDrop: vi.fn(async () => ({ polyfill: dragPolyfill })),
      dragDropScroll: vi.fn(async () => ({ scrollBehaviourDragImageTranslateOverride: dragImageTranslateOverride })),
      streams: vi.fn(async () => streamPonyfills),
      baseline: createBaselineLoaders(),
    },
  }
}

describe('runtime environment installation', () => {
  it('recognizes the configured Baseline runtime features in the test browser', () => {
    expect(detectBaselineRuntimeSupport()).toEqual(allSupported)
  })

  it('keeps native globals and does not download optional implementations', async () => {
    const { dragPolyfill, loaders } = createLoaders()
    const target = {
      Buffer: globalThis.Buffer,
      ReadableStream,
      TransformStream,
      WritableStream,
    } as NonNullable<RuntimeEnvironmentOptions['target']>

    await installRuntimeEnvironment({
      target,
      loaders,
      runtimeSupport: allSupported,
      documentTarget: nativeDragDocument(),
      ios: false,
    })

    expect(target.safeStructuredClone).toBeTypeOf('function')
    expect(loaders.buffer).not.toHaveBeenCalled()
    expect(loaders.streams).not.toHaveBeenCalled()
    expect(loaders.dragDrop).not.toHaveBeenCalled()
    expect(loaders.dragDropScroll).not.toHaveBeenCalled()
    expect(dragPolyfill).not.toHaveBeenCalled()
    for (const loader of Object.values(loaders.baseline)) expect(loader).not.toHaveBeenCalled()
  })

  it('loads only missing baseline features and missing global implementations', async () => {
    const { dragImageTranslateOverride, dragPolyfill, loaders, streamPonyfills } = createLoaders()
    const target = {} as NonNullable<RuntimeEnvironmentOptions['target']>
    const documentTarget = {
      createElement: vi.fn(() => ({ remove: vi.fn() })),
    } as unknown as Pick<Document, 'createElement'>

    await installRuntimeEnvironment({
      target,
      loaders,
      runtimeSupport: { ...allSupported, objectHasOwn: false, stringReplaceAll: false },
      documentTarget,
      ios: false,
    })

    expect(loaders.baseline.objectHasOwn).toHaveBeenCalledOnce()
    expect(loaders.baseline.stringReplaceAll).toHaveBeenCalledOnce()
    for (const [feature, loader] of Object.entries(loaders.baseline)) {
      if (feature === 'objectHasOwn' || feature === 'stringReplaceAll') continue
      expect(loader).not.toHaveBeenCalled()
    }
    expect(loaders.buffer).toHaveBeenCalledOnce()
    expect(loaders.streams).toHaveBeenCalledOnce()
    expect(target.Buffer).toBe(globalThis.Buffer)
    expect(target.ReadableStream).toBe(streamPonyfills.ReadableStream)
    expect(target.TransformStream).toBe(streamPonyfills.TransformStream)
    expect(target.WritableStream).toBe(streamPonyfills.WritableStream)
    expect(target.polyfilledDragDrop).toBe(true)
    expect(dragPolyfill).toHaveBeenCalledWith({
      dragImageTranslateOverride,
      holdToDrag: 400,
      forceApply: true,
    })
  })

  it('finishes the affected-platform drag polyfill before reporting readiness', async () => {
    let resolveDragModule!: (module: TestDragDropModule) => void
    const dragPolyfill = vi.fn(() => true) as TestDragDropModule['polyfill']
    const dragModule = new Promise<TestDragDropModule>((resolve) => {
      resolveDragModule = resolve
    })
    const { loaders } = createLoaders()
    loaders.dragDrop = vi.fn(() => dragModule)
    const target = {
      Buffer: globalThis.Buffer,
      ReadableStream,
      TransformStream,
      WritableStream,
    } as NonNullable<RuntimeEnvironmentOptions['target']>

    let ready = false
    const installation = installRuntimeEnvironment({
      target,
      loaders,
      runtimeSupport: allSupported,
      documentTarget: nativeDragDocument(),
      ios: true,
    }).then(() => {
      ready = true
    })
    await Promise.resolve()

    expect(loaders.dragDrop).toHaveBeenCalledOnce()
    expect(ready).toBe(false)
    resolveDragModule({ polyfill: dragPolyfill })
    await installation

    expect(dragPolyfill).toHaveBeenCalledOnce()
    expect(ready).toBe(true)
  })
})
