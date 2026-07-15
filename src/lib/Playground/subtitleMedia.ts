export async function probeVideoDuration(file: Blob): Promise<number> {
  const video = document.createElement('video')
  const videoURL = URL.createObjectURL(file)
  try {
    video.src = videoURL
    video.preload = 'metadata'
    video.muted = true
    await video.play()
    return video.duration
  } finally {
    video.pause()
    video.remove()
    URL.revokeObjectURL(videoURL)
  }
}

export async function decodeAudioFileWithTemporaryContext(file: Blob): Promise<AudioBuffer> {
  const audioContext = new AudioContext()
  try {
    return await audioContext.decodeAudioData(await file.arrayBuffer())
  } finally {
    await audioContext.close().catch(() => {
      /* ignore close failures after decode has already resolved or rejected */
    })
  }
}

export function stereoAudioChannels(
  audioBuffer: Pick<AudioBuffer, 'getChannelData' | 'numberOfChannels'>,
): [left: Float32Array, right: Float32Array] {
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left
  return [left, right]
}

const SUBTITLE_PREVIEW_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avi: 'video/x-msvideo',
  flac: 'audio/flac',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'video/webm',
}

export function subtitlePreviewMimeType(file: Pick<File, 'name' | 'type'>): string {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return SUBTITLE_PREVIEW_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
