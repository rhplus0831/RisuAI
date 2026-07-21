import type {
  SummarizationOutput,
  TextToAudioPipeline,
  FeatureExtractionPipeline,
  TextGenerationConfig,
  TextGenerationOutput,
  ImageToTextOutput,
} from '@huggingface/transformers'
import { unzip } from 'fflate'
import { loadAsset, saveAssets } from 'src/ts/globalApi.svelte'
import { asBuffer } from 'src/ts/util'
import { selectSingleFile } from 'src/ts/filePicker'
import { v4 } from 'uuid'
let tfCache: Cache = null
let tfLoaded = false
let tfMap: { [key: string]: string } = {}
async function initTransformers() {
  if (tfLoaded) {
    return
  }
  const { env } = await import('@huggingface/transformers')
  tfCache = await caches.open('tfCache')
  env.localModelPath = 'https://sv.risuai.xyz/transformers/'
  env.useBrowserCache = false
  env.useFSCache = false
  env.useCustomCache = true
  env.allowLocalModels = true
  env.customCache = {
    put: async (url: URL | string, response: Response) => {
      await tfCache.put(url, response)
    },
    match: async (url: URL | string) => {
      if (typeof url === 'string') {
        if (Object.keys(tfMap).includes(url)) {
          const assetId = tfMap[url]
          return new Response(asBuffer(await loadAsset(assetId)))
        }
      }
      return await tfCache.match(url)
    },
  }
  tfLoaded = true
  console.log('transformers loaded')
}

export const runTransformers = async (
  baseText: string,
  model: string,
  config: TextGenerationConfig,
  device: 'webgpu' | 'wasm' = 'wasm',
) => {
  await initTransformers()
  const { pipeline } = await import('@huggingface/transformers')
  let text = baseText
  let generator = await pipeline('text-generation', model, {
    device,
  })
  let output = (await generator(text, config)) as TextGenerationOutput
  const outputOne = output[0]
  return outputOne
}

export const runSummarizer = async (text: string) => {
  await initTransformers()
  const { pipeline } = await import('@huggingface/transformers')
  let classifier = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6')
  const v = (await classifier(text)) as SummarizationOutput
  return v[0].summary_text
}

let extractor: FeatureExtractionPipeline = null
let lastEmbeddingModelQuery: string = ''
type EmbeddingModel = 'Xenova/all-MiniLM-L6-v2' | 'nomic-ai/nomic-embed-text-v1.5'
export const runEmbedding = async (
  texts: string[],
  model: EmbeddingModel = 'Xenova/all-MiniLM-L6-v2',
  device: 'webgpu' | 'wasm',
): Promise<Float32Array[]> => {
  await initTransformers()
  console.log('running embedding')
  let embeddingModelQuery = model + device
  const { pipeline } = await import('@huggingface/transformers')
  if (!extractor || embeddingModelQuery !== lastEmbeddingModelQuery) {
    // Dispose old extractor
    if (extractor) {
      await extractor.dispose()
    }
    extractor = await pipeline<'feature-extraction'>('feature-extraction', model, {
      // Default dtype for webgpu is fp32, so we can use q8, which is the default dtype in wasm.
      dtype: 'q8',
      device: device,
    })
    lastEmbeddingModelQuery = embeddingModelQuery
    console.log('extractor loaded')
  }
  let result = await extractor(texts, { pooling: 'mean', normalize: true })
  const data = result.data as Float32Array
  const lenPerText = data.length / texts.length
  let res: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    res.push(data.subarray(i * lenPerText, (i + 1) * lenPerText))
  }
  return res ?? []
}

export const runImageEmbedding = async (dataurl: string) => {
  await initTransformers()
  const { pipeline } = await import('@huggingface/transformers')
  const captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning')
  const output = await captioner(dataurl)
  return output as ImageToTextOutput
}

let synthesizer: TextToAudioPipeline = null
let lastSynth: string = null
let vitsAudioContext: AudioContext | null = null

async function getVitsAudioContext(): Promise<AudioContext> {
  if (!vitsAudioContext || vitsAudioContext.state === 'closed') {
    vitsAudioContext = new AudioContext()
  }

  if (vitsAudioContext.state === 'suspended') {
    await vitsAudioContext.resume()
  }

  return vitsAudioContext
}

async function replaceVitsSynthesizer(nextSynthKey: string, createSynthesizer: () => Promise<TextToAudioPipeline>) {
  if (synthesizer && lastSynth !== nextSynthKey) {
    await synthesizer.dispose?.()
    synthesizer = null
  }
  if (!synthesizer) {
    synthesizer = await createSynthesizer()
    lastSynth = nextSynthKey
  }
}

function decodeVitsAudio(audioContext: AudioContext, audio: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    audioContext.decodeAudioData(audio, resolve, (error) => reject(error ?? new Error('VITS audio decode failed')))
  })
}

export interface OnnxModelFiles {
  files: { [key: string]: string }
  id: string
  name?: string
}

export interface SelectedOnnxModelFile {
  name: string
  data: Uint8Array
}

export interface RegisterOnnxModelOptions {
  shouldContinue?: () => boolean
}

export interface RunVitsOptions {
  signal?: AbortSignal
}

function throwIfVitsAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('VITS request aborted', 'AbortError')
}

export const runVITS = async (
  text: string,
  modelData: string | OnnxModelFiles = 'Xenova/mms-tts-eng',
  options: RunVitsOptions = {},
) => {
  throwIfVitsAborted(options.signal)
  await initTransformers()
  throwIfVitsAborted(options.signal)
  const { WaveFile } = await import('wavefile')
  const { pipeline, env } = await import('@huggingface/transformers')
  throwIfVitsAborted(options.signal)
  if (modelData === null) {
    return
  }
  if (typeof modelData === 'string') {
    await replaceVitsSynthesizer(modelData, () => pipeline<'text-to-speech'>('text-to-speech', modelData))
  } else {
    if (!synthesizer || lastSynth !== modelData.id) {
      const files = modelData.files
      const keys = Object.keys(files)
      for (const key of keys) {
        const fileURL = env.localModelPath + modelData.id + '/' + key
        tfMap[fileURL] = files[key]
        tfMap[location.origin + fileURL] = files[key]
      }
    }
    await replaceVitsSynthesizer(modelData.id, () => pipeline<'text-to-speech'>('text-to-speech', modelData.id))
  }
  throwIfVitsAborted(options.signal)
  let out = await synthesizer(text, {})
  throwIfVitsAborted(options.signal)
  const wav = new WaveFile()
  wav.fromScratch(1, out.sampling_rate, '32f', out.audio)
  const audioContext = await getVitsAudioContext()
  const decodedData = await decodeVitsAudio(audioContext, asBuffer(wav.toBuffer().buffer))
  throwIfVitsAborted(options.signal)
  const sourceNode = audioContext.createBufferSource()
  sourceNode.buffer = decodedData
  sourceNode.connect(audioContext.destination)
  let released = false
  const cleanup = () => {
    if (released) return
    released = true
    sourceNode.onended = null
    options.signal?.removeEventListener('abort', stopSource)
    sourceNode.disconnect()
  }
  const stopSource = () => {
    try {
      sourceNode.stop()
    } catch (error) {
      if (!options.signal?.aborted) throw error
    } finally {
      cleanup()
    }
  }
  sourceNode.onended = cleanup
  options.signal?.addEventListener('abort', stopSource, { once: true })
  if (options.signal?.aborted) {
    stopSource()
    return
  }
  sourceNode.start()
}

export const registerOnnxModelFromFile = async (
  modelFile: SelectedOnnxModelFile,
  options: RegisterOnnxModelOptions = {},
): Promise<OnnxModelFiles | undefined> => {
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!shouldContinue()) return

  const id = v4().replace(/-/g, '')

  const unziped = await new Promise<Record<string, Uint8Array>>((res, rej) => {
    unzip(
      modelFile.data,
      {
        filter: (file) => {
          return file.name.endsWith('.onnx') || file.size < 10_000_000 || file.name.includes('.git')
        },
      },
      (err, unzipped) => {
        if (err) {
          rej(err)
        } else {
          res(unzipped)
        }
      },
    )
  })
  if (!shouldContinue()) return

  let fileIdMapped: { [key: string]: string } = {}

  const keys = Object.keys(unziped)
  if (!shouldContinue()) return

  const savedAssetIds = await saveAssets(
    keys.map((key) => ({
      data: unziped[key],
      fileName: key.endsWith('.onnx') ? key : '',
    })),
  )
  if (!shouldContinue()) return

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const fid = savedAssetIds[i]
    let url = key
    if (url.startsWith('/')) {
      url = url.substring(1)
    }
    fileIdMapped[url] = fid
  }

  return {
    files: fileIdMapped,
    name: modelFile.name,
    id: id,
  }
}

export const registerOnnxModel = async (): Promise<OnnxModelFiles | undefined> => {
  const modelFile = await selectSingleFile(['zip'])

  if (!modelFile) {
    return
  }

  return registerOnnxModelFromFile(modelFile)
}
