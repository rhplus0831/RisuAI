<script lang="ts">
  import { onDestroy } from 'svelte'
  import { language } from 'src/lang'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { getModelInfo, LLMFlags } from 'src/ts/model/modellist'
  import { resolveModelForRole } from '@risuai/shared-core/model-roles'
  import { requestChatData } from 'src/ts/process/request/request'
  import { asBuffer, sleep } from 'src/ts/util'
  import { selectFileByDom, selectSingleFile } from 'src/ts/filePicker'
  import { alertError, alertSelect } from 'src/ts/alert'
  import { risuChatParser } from 'src/ts/parser/parser.svelte'
  import { AppendableBuffer, downloadFile, getLanguageCodes } from 'src/ts/globalApi.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import sendSound from '../../etc/send.mp3'
  import {
    decodeAudioFileWithTemporaryContext,
    probeVideoDuration,
    stereoAudioChannels,
    subtitlePreviewMimeType,
  } from './subtitleMedia'
  import { requestOpenAITranscription } from 'src/ts/server/openAITranscription'

  let LLMModePrompt =
    "Transcribe and create a caption and timestamp of it, according to the user's audio or video input. inside a markdown code block. (prefix ```webvtt / postfix ```)\n\nFormat\n```\n[TIME] CONTENT\n```\n\nExample\n```\n[00:00] Hildy!\n[00:01] How are you?\n[00:03] Tell me, is the lord of the universe in?\n[00:07] Somebody must've stolen the crown jewels\n```\n\nStep 2. Generate another subtitle, this time, as a translation to {{slot}}, with same format with Step 1., using step 1 as ref.\n\n The translation must be in natural {{slot}}.\n\n Now, start (Hint: media length is {{slot::time}})"
  let WhisperModePrompt =
    '```\n{{slot::data}}\n``` Translate the following WEBVTT to natural {{slot}}, with keeping the timestamp and header, inside a markdown code block. (prefix ``` / postfix ```)'

  let selLang = $state(getDatabase().language)
  let prompt = $state(LLMModePrompt)
  let modelInfo = $derived(getModelInfo(resolveModelForRole(getDatabase(), 'translate')))
  let outputText = $state('')
  let fileB64 = $state('')
  let vttB64 = $state('')
  let vobj: TranscribeObj[] = $state([])
  let mode: 'llm' | 'whisper' | 'whisperLocal' = $state('llm')
  let sourceLang: string | null = $state(null)
  let running = $state(false)
  let resultLanguage = $state('')

  type SubtitleStreamReader = ReadableStreamDefaultReader<Record<string, string>>
  type DisposablePipeline = {
    dispose?: () => void | Promise<void>
  }
  type LocalTranscriber = DisposablePipeline & ((audio: Float32Array, options: unknown) => Promise<any>)
  type PipelineProgress = {
    name?: string
    status?: string
    file?: string
    progress?: number
  }
  type SubtitleRun = {
    controller: AbortController
    reader: SubtitleStreamReader | null
    pipeline: DisposablePipeline | null
  }

  let activeRun: SubtitleRun | null = null
  let destroyed = false
  let trackedInputSignature = ''
  const disposedPipelines = new WeakSet<object>()

  function subtitleAbortError(): DOMException {
    return new DOMException('Subtitle run aborted', 'AbortError')
  }

  function isAbortError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
  }

  function isCurrentRun(run: SubtitleRun): boolean {
    return !destroyed && activeRun === run && !run.controller.signal.aborted
  }

  function requireCurrentRun(run: SubtitleRun): void {
    if (!isCurrentRun(run)) throw subtitleAbortError()
  }

  async function awaitRun<T>(
    value: PromiseLike<T> | T,
    run: SubtitleRun,
    onLateValue?: (value: T) => void,
  ): Promise<T> {
    requireCurrentRun(run)
    return await new Promise<T>((resolve, reject) => {
      const signal = run.controller.signal
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) return false
        settled = true
        signal.removeEventListener('abort', onAbort)
        callback()
        return true
      }
      const onAbort = () => settle(() => reject(subtitleAbortError()))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(value).then(
        (result) => {
          if (!isCurrentRun(run)) {
            settle(() => reject(subtitleAbortError()))
            onLateValue?.(result)
            return
          }
          if (!settle(() => resolve(result))) onLateValue?.(result)
        },
        (error) => settle(() => reject(error)),
      )
      if (signal.aborted) onAbort()
    })
  }

  function disposePipeline(pipeline: DisposablePipeline | null): void {
    if (!pipeline?.dispose) return
    if (disposedPipelines.has(pipeline)) return
    disposedPipelines.add(pipeline)
    try {
      void Promise.resolve(pipeline.dispose()).catch((error) => {
        if (!destroyed) console.error('Unable to dispose subtitle transcription pipeline', error)
      })
    } catch (error) {
      if (!destroyed) console.error('Unable to dispose subtitle transcription pipeline', error)
    }
  }

  function cancelRun(run: SubtitleRun): void {
    run.controller.abort()
    const reader = run.reader
    run.reader = null
    if (reader) {
      try {
        void reader.cancel().catch(() => {})
      } catch {
        // The reader may already have released its lock.
      }
    }
    const pipeline = run.pipeline
    run.pipeline = null
    disposePipeline(pipeline)
  }

  function currentInputSignature(): string {
    return JSON.stringify([mode, prompt, selLang, sourceLang])
  }

  $effect(() => {
    const inputSignature = currentInputSignature()
    if (inputSignature === trackedInputSignature) return
    trackedInputSignature = inputSignature

    const run = activeRun
    activeRun = null
    if (run) cancelRun(run)
    running = false
    resetOutput()
  })

  onDestroy(() => {
    destroyed = true
    if (activeRun) cancelRun(activeRun)
    activeRun = null
  })

  async function runLLMMode(promptSnapshot: string, languageSnapshot: string, run: SubtitleRun): Promise<boolean> {
    const file = await awaitRun(
      selectSingleFile(['mp3', 'ogg', 'wav', 'flac', 'mp4', 'webm', 'mkv', 'avi', 'mov']),
      run,
    )

    if (!file) {
      return false
    }
    requireCurrentRun(run)

    const videos = ['mp4', 'webm', 'mkv', 'avi', 'mov']

    const ext = file.name.split('.').pop()

    fileB64 = `data:${
      videos.includes(ext) ? 'video' : 'audio'
    }/${ext};base64,${Buffer.from(file.data).toString('base64')}`

    const media = {
      type: videos.includes(ext) ? 'video' : 'audio',
      base64: fileB64,
    } as const

    let time = ''

    if (promptSnapshot.includes('{{slot::time}}')) {
      const video = document.createElement('video')
      let d = Number.NaN
      try {
        video.src = fileB64
        video.preload = 'metadata'
        video.muted = true
        await awaitRun(video.play(), run)
        d = video.duration
      } finally {
        video.pause()
        video.remove()
        video.src = ''
      }
      if (isNaN(d)) {
        time = 'unknown'
      } else {
        time = `${Math.floor(d / 60)}:${Math.floor(d % 60)}`
      }
    }

    const v = await awaitRun(
      requestChatData(
        {
          formated: [
            {
              role: 'user',
              content: risuChatParser(promptSnapshot)
                .replace(/{{slot}}/g, languageSnapshot)
                .replace(/{{slot::time}}/g, time),
              multimodals: [media],
            },
          ],
          bias: {},
          useStreaming: true,
        },
        'translate',
        run.controller.signal,
      ),
      run,
    )
    requireCurrentRun(run)

    if (v.type === 'multiline') {
      alertError(v.result[0][1])
      return false
    }

    if (v.type !== 'streaming') {
      alertError(v.result)
      return false
    }

    const reader = v.result.getReader() as SubtitleStreamReader
    run.reader = reader

    try {
      while (true) {
        const { done, value } = await awaitRun(reader.read(), run)
        requireCurrentRun(run)
        if (done) {
          break
        }
        const firstKey = Object.keys(value)[0]

        outputText = value[firstKey]
      }
    } finally {
      if (run.reader === reader) run.reader = null
      try {
        reader.releaseLock?.()
      } catch {
        // Cancellation may still be settling while the component unmounts.
      }
    }

    requireCurrentRun(run)
    const extracted = outputText.matchAll(/```(web)?(vtt)?\n(.*?)\n```/gs)

    let latest = ''
    for (const match of extracted) {
      latest = match[3].trim()
    }

    vobj = convertTransToObj(latest)
    outputText = makeWebVtt(vobj)
    vttB64 = `data:text/vtt;base64,${Buffer.from(outputText).toString('base64')}`

    if (isCurrentRun(run)) {
      const audio = new Audio(sendSound)
      audio.play().catch(() => {})
    }
    return true
  }

  async function runWhisperMode(
    runMode: 'whisper' | 'whisperLocal',
    promptSnapshot: string,
    languageSnapshot: string,
    sourceLanguageSnapshot: string | null,
    run: SubtitleRun,
  ): Promise<boolean> {
    const files = await awaitRun(
      selectFileByDom(['mp3', 'ogg', 'wav', 'flac', 'mp4', 'webm', 'mkv', 'avi', 'mov']),
      run,
    )

    const file = files?.[0]

    let requestFile: File = null

    if (!file) {
      return false
    }
    requireCurrentRun(run)
    const videos = ['mp4', 'webm', 'mkv', 'avi', 'mov']

    const ext = file.name.split('.').pop()
    if (videos.includes(ext)) {
      let duration = 0
      const d = await awaitRun(probeVideoDuration(file), run)
      requireCurrentRun(run)
      if (isNaN(d)) {
        alertError(language.errors.subtitleVideoDurationMissing)
        return false
      }
      duration = d

      outputText = 'Converting video to audio...\n\n'
      const audioBuffer = await awaitRun(decodeAudioFileWithTemporaryContext(file), run)

      const [left, right] = stereoAudioChannels(audioBuffer)

      const leftInt16 = new Int16Array(left.length)
      const rightInt16 = new Int16Array(right.length)

      for (let i = 0; i < left.length; i++) {
        if (i % 16384 === 0) requireCurrentRun(run)
        leftInt16[i] = left[i] * 0x7fff
        rightInt16[i] = right[i] * 0x7fff
      }

      const lamejs = await awaitRun(import('@breezystack/lamejs'), run)
      const mp3encoder = new lamejs.Mp3Encoder(2, audioBuffer.sampleRate, 128)
      const enc = new AppendableBuffer()

      for (let pointer = 0; pointer < leftInt16.length; pointer += 1152) {
        requireCurrentRun(run)
        enc.append(
          mp3encoder.encodeBuffer(
            leftInt16.subarray(pointer, pointer + 1152),
            rightInt16.subarray(pointer, pointer + 1152),
          ),
        )
        if (pointer % 115200 === 0) {
          outputText = `Converting  video to audio... ${((pointer / leftInt16.length) * 100).toFixed(2)}%\n`
          await awaitRun(sleep(1), run)
        }
      }
      enc.append(mp3encoder.flush())

      const file2 = new File([asBuffer(enc.buffer)], 'audio.mp3', {
        type: 'audio/mp3',
      })

      outputText = 'Transcribing audio...\n\n'
      requestFile = file2
    } else {
      requestFile = file
    }

    if (runMode === 'whisperLocal') {
      let transcriber: LocalTranscriber | null = null
      try {
        const { pipeline } = await awaitRun(import('@huggingface/transformers'), run)
        requireCurrentRun(run)
        let stats: {
          [key: string]: {
            name: string
            status: string
            file: string
            progress?: number
          }
        } = {}

        const device = 'gpu' in navigator ? 'webgpu' : 'wasm'
        const createTranscriber = pipeline as unknown as (
          task: string,
          model: string,
          options: {
            device: string
            progress_callback: (progress: PipelineProgress) => void
            dtype: string
          },
        ) => Promise<LocalTranscriber>

        transcriber = (await awaitRun(
          createTranscriber('automatic-speech-recognition', 'onnx-community/whisper-large-v3-turbo_timestamped', {
            device: device,
            progress_callback: (progress) => {
              if (
                isCurrentRun(run) &&
                typeof progress.name === 'string' &&
                typeof progress.file === 'string' &&
                typeof progress.status === 'string'
              ) {
                stats[progress.name + progress.file] = {
                  name: progress.name,
                  status: progress.status,
                  file: progress.file,
                  progress: progress.progress,
                }
                outputText = Object.values(stats)
                  .map((v) => `${v.name}-${v.file}: ${v.status} ${v.progress ? `[${v.progress.toFixed(2)}%]` : ''}`)
                  .join('\n')
              }
            },
            dtype: 'q8',
          }),
          run,
          (latePipeline) => disposePipeline(latePipeline as DisposablePipeline),
        )) as LocalTranscriber
        requireCurrentRun(run)
        run.pipeline = transcriber

        const audioBuffer = await awaitRun(decodeAudioFileWithTemporaryContext(requestFile), run)
        const combined = new Float32Array(audioBuffer.getChannelData(0).length)
        for (let j = 0; j < audioBuffer.getChannelData(0).length; j++) {
          if (j % 16384 === 0) requireCurrentRun(run)
          for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
            combined[j] += audioBuffer.getChannelData(i)[j]
          }

          if (combined[j] > 1) {
            combined[j] = 1
          }
          if (combined[j] < -1) {
            combined[j] = -1
          }
        }

        outputText = 'Transcribing... (This may take a while. Do not close the tab.)'
        if (device !== 'webgpu') {
          outputText += `\nYour browser or OS do not support WebGPU, so the transcription may be slower.`
        }
        await awaitRun(sleep(10), run)
        const res1 = await awaitRun(
          transcriber(combined, {
            return_timestamps: true,
            language: sourceLanguageSnapshot,
          }),
          run,
        )
        requireCurrentRun(run)
        const res2 = Array.isArray(res1) ? res1[0] : res1
        const chunks = res2.chunks

        outputText = 'WEBVTT\n\n'

        for (const chunk of chunks) {
          requireCurrentRun(run)
          outputText += `${chunk.timestamp[0]} --> ${chunk.timestamp[1]}\n${chunk.text}\n\n`
        }
      } catch (error) {
        if (isAbortError(error)) throw error
        alertError(error)
        return false
      } finally {
        if (run.pipeline === transcriber) run.pipeline = null
        disposePipeline(transcriber)
      }
    } else {
      const transcription = await awaitRun(requestOpenAITranscription(requestFile, run.controller.signal), run)
      requireCurrentRun(run)
      outputText = transcription
    }

    const v = await awaitRun(
      requestChatData(
        {
          formated: [
            {
              role: 'user',
              content: risuChatParser(promptSnapshot)
                .replace(/{{slot}}/g, languageSnapshot)
                .replace(/{{slot::data}}/g, outputText),
            },
          ],
          bias: {},
          useStreaming: true,
        },
        'translate',
        run.controller.signal,
      ),
      run,
    )
    requireCurrentRun(run)

    if (v.type === 'multiline') {
      alertError(v.result[0][1])
      return false
    }

    if (v.type !== 'streaming') {
      alertError(v.result)
      return false
    }

    const reader = v.result.getReader() as SubtitleStreamReader
    run.reader = reader

    try {
      while (true) {
        const { done, value } = await awaitRun(reader.read(), run)
        requireCurrentRun(run)
        if (done) {
          break
        }
        const firstKey = Object.keys(value)[0]

        outputText = value[firstKey]
      }
    } finally {
      if (run.reader === reader) run.reader = null
      try {
        reader.releaseLock?.()
      } catch {
        // Cancellation may still be settling while the component unmounts.
      }
    }
    requireCurrentRun(run)
    if (!outputText.trim().endsWith('```')) {
      outputText = outputText.trim() + '\n```'
    }

    const extracted = outputText.matchAll(/```(web)?(vtt)?\n(.*?)\n```/gs)

    let latest = ''
    for (const match of extracted) {
      latest = match[3].trim()
    }

    const fileBuffer = await awaitRun(file.arrayBuffer(), run)
    requireCurrentRun(run)
    outputText = latest
    vttB64 = `data:text/vtt;base64,${Buffer.from(outputText).toString('base64')}`
    fileB64 = `data:${subtitlePreviewMimeType(file)};base64,${Buffer.from(fileBuffer).toString('base64')}`
    vobj = convertWebVTTtoObj(outputText)

    if (isCurrentRun(run)) {
      const audio = new Audio(sendSound)
      audio.play().catch(() => {})
    }
    return true
  }

  async function runSelectedMode(): Promise<void> {
    if (running) return

    trackedInputSignature = currentInputSignature()
    const runMode = mode
    const promptSnapshot = prompt
    const languageSnapshot = selLang
    const sourceLanguageSnapshot = sourceLang
    const run: SubtitleRun = {
      controller: new AbortController(),
      reader: null,
      pipeline: null,
    }
    activeRun = run
    running = true
    outputText = 'Loading...\n\n'
    fileB64 = ''
    vttB64 = ''
    vobj = []

    try {
      const completed =
        runMode === 'llm'
          ? await runLLMMode(promptSnapshot, languageSnapshot, run)
          : await runWhisperMode(runMode, promptSnapshot, languageSnapshot, sourceLanguageSnapshot, run)
      if (isCurrentRun(run)) {
        if (completed) resultLanguage = languageSnapshot
        else resetOutput()
      }
    } catch (error) {
      if (isCurrentRun(run) && !isAbortError(error)) {
        resetOutput()
        alertError(error)
      }
    } finally {
      if (activeRun === run) {
        activeRun = null
        running = false
      }
    }
  }

  function resetOutput(): void {
    outputText = ''
    fileB64 = ''
    vttB64 = ''
    vobj = []
    resultLanguage = ''
  }

  type TranscribeObj = {
    start: string
    end: string
    text: string
  }

  function convertTransToObj(r: string) {
    const lines = r
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v)
    const obj: TranscribeObj[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('[')) {
        let [time, ...text] = line.split(']')
        time = time.slice(1)
        if (obj.length > 0) {
          obj[obj.length - 1].end = time + '.000'
        }
        obj.push({
          start: time + '.000',
          end: '',
          text: text.join(' '),
        })
      }
    }
    if (obj.length > 0) {
      obj[obj.length - 1].end = '99:99.000'
    }
    return obj
  }

  function convertWebVTTtoObj(r: string) {
    const chunks = r
      .split('\n\n')
      .map((v) => v.trim())
      .filter((v) => v)
    const obj: TranscribeObj[] = []
    for (const chunk of chunks) {
      if (chunk.startsWith('WEBVTT')) {
        continue
      }
      const [time, ...text] = chunk.split('\n')
      const [start, end] = time.split(' --> ')
      obj.push({
        start: start,
        end: end,
        text: text.join('\n'),
      })
    }
    return obj
  }

  function makeWebVtt(obj: TranscribeObj[]) {
    let vtt = 'WEBVTT\n\n'

    for (const line of obj) {
      vtt += `${line.start} --> ${line.end}\n${line.text}\n\n`
    }

    return vtt
  }

  function webVttToSrt() {
    const srt = outputText
      .replace('WEBVTT', '')
      .trim()
      .split('\n\n')
      .map((v, i) => {
        const [time, ...text] = v.split('\n')
        const [start, end] = time.split(' --> ')
        return `${i + 1}\n${start.replace('.', ',')} --> ${end.replace('.', ',')}\n${text.join('\n')}`
      })
    return srt
  }

  type WaveOptions = {
    isFloat: boolean
    numChannels: number
    sampleRate: number
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.subtitles}</h2>

{#if mode === 'whisperLocal'}
  <span class="text-textcolor text-lg mt-4">{language.sourceLanguage}</span>
  <SelectInput
    value={sourceLang === null ? 'auto' : sourceLang}
    ariaLabel={language.sourceLanguage}
    onchange={(event) => {
      sourceLang = event.currentTarget.value === 'auto' ? null : event.currentTarget.value
    }}>
    <OptionInput value="auto">Auto</OptionInput>
    {#each getLanguageCodes() as lang}
      <OptionInput value={lang.code}>{lang.name}</OptionInput>
    {/each}
  </SelectInput>
{/if}

<span class="text-textcolor text-lg mt-4">{language.destinationLanguage}</span>
<TextInput bind:value={selLang} ariaLabel={language.destinationLanguage} />

<span class="text-textcolor text-lg mt-4">{language.prompt}</span>
<TextAreaInput bind:value={prompt} ariaLabel={language.prompt} />

<span class="text-textcolor text-lg mt-4">{language.type}</span>
<SelectInput
  bind:value={mode}
  ariaLabel={language.type}
  onchange={(e) => {
    const selectedMode = e.currentTarget.value as typeof mode
    mode = selectedMode
    if (selectedMode === 'llm') {
      prompt = LLMModePrompt
    }
    if (selectedMode === 'whisper' || selectedMode === 'whisperLocal') {
      prompt = WhisperModePrompt
    }
  }}>
  <OptionInput value="llm">LLM</OptionInput>
  <OptionInput value="whisper">Whisper</OptionInput>
  <OptionInput value="whisperLocal">Whisper Local</OptionInput>
</SelectInput>

{#if !(modelInfo.flags.includes(LLMFlags.hasAudioInput) && modelInfo.flags.includes(LLMFlags.hasVideoInput)) && mode === 'llm'}
  <span class="text-draculared text-lg mt-4">{language.subtitlesWarning1}</span>
{/if}
{#if !(modelInfo.flags.includes(LLMFlags.hasStreaming) && getDatabase().useStreaming)}
  <span class="text-draculared text-lg mt-4">{language.subtitlesWarning2}</span>
{/if}
{#if !('gpu' in navigator) && mode === 'whisperLocal'}
  <span class="text-draculared text-lg mt-4">{language.noWebGPU}</span>
{/if}

{#if !outputText}
  <Button className="mt-4" disabled={running} onclick={runSelectedMode}>
    {language.run}
  </Button>
{:else if vttB64 && fileB64}
  <details class="mt-4">
    <pre>{outputText}</pre>
  </details>
{:else}
  <pre>{outputText}</pre>
{/if}

{#if vttB64 && fileB64}
  <div class="mt-4">
    {#key vttB64}
      <video controls src={fileB64} class="w-full">
        <track default kind="captions" src={vttB64} srclang={resultLanguage || 'en'} />
      </video>
    {/key}
  </div>

  <span class="text-textcolor text-lg mt-4">{language.download}</span>

  <Button className="mt-4" onclick={resetOutput}>
    {language.reset}
  </Button>

  <Button
    className="mt-4"
    onclick={async () => {
      const selection = await alertSelect(['WebVTT', 'SRT'])
      if (selection === null) return
      const sel = Number(selection)

      // WebVTT
      if (sel === 0) {
        downloadFile('subtitle.vtt', outputText)
        return
      }

      // SRT
      if (sel === 1) {
        downloadFile('subtitle.srt', webVttToSrt().join('\n\n'))
        return
      }
    }}>
    {language.download}
  </Button>
{/if}
