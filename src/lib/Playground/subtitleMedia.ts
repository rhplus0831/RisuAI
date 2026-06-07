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
