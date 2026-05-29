export interface PcmScheduleResult {
  startTime: number
  endTime: number
}

export interface PcmMouthOpenOptions {
  gain?: number
  exponent?: number
  max?: number
  noiseFloor?: number
}

export interface PcmMouthFrame extends PcmScheduleResult {
  mouthForm: number
  mouthOpen: number
}

export interface PcmMouthFramesOptions extends PcmMouthOpenOptions {
  sampleRate?: number
  frameMs?: number
}

export function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const output = new Float32Array(sampleCount)

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = view.getInt16(i * 2, true)
    output[i] = sample < 0 ? sample / 0x8000 : sample / 0x7FFF
  }

  return output
}

export function calculatePcm16Rms(bytes: Uint8Array): number {
  const samples = pcm16BytesToFloat32(bytes)
  if (samples.length === 0)
    return 0

  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }

  return Math.min(1, Math.sqrt(sum / samples.length) * 4)
}

export function normalizePcm16RmsToMouthOpen(rms: number, options: PcmMouthOpenOptions = {}): number {
  const noiseFloor = options.noiseFloor ?? 0.012
  const gain = options.gain ?? 6
  const exponent = options.exponent ?? 0.72
  const max = options.max ?? 0.85

  if (!Number.isFinite(rms) || rms <= noiseFloor)
    return 0

  const normalized = Math.min(1, Math.max(0, (rms - noiseFloor) * gain))
  return Math.min(max, normalized ** exponent)
}

export function calculatePcm16MouthOpen(bytes: Uint8Array, options: PcmMouthOpenOptions = {}): number {
  const samples = pcm16BytesToFloat32(bytes)
  if (samples.length === 0)
    return 0

  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }

  return normalizePcm16RmsToMouthOpen(Math.sqrt(sum / samples.length), options)
}

export function estimatePcm16MouthForm(samples: Float32Array, start: number, end: number, rms: number): number {
  if (end - start < 2 || rms <= 0.012)
    return 0

  let zeroCrossings = 0
  let previous = samples[start] ?? 0
  for (let i = start + 1; i < end; i += 1) {
    const current = samples[i] ?? 0
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0))
      zeroCrossings += 1
    previous = current
  }

  const crossingRatio = zeroCrossings / Math.max(1, end - start - 1)
  const wide = Math.min(1, crossingRatio * 16)
  const round = Math.min(1, Math.max(0, rms - 0.04) * 5)
  return Math.max(-0.75, Math.min(0.75, wide * 0.65 - round * 0.55))
}

export function calculatePcm16MouthFrames(bytes: Uint8Array, options: PcmMouthFramesOptions = {}): PcmMouthFrame[] {
  const sampleRate = options.sampleRate ?? 24000
  const frameMs = options.frameMs ?? 40
  const samples = pcm16BytesToFloat32(bytes)
  if (samples.length === 0 || sampleRate <= 0)
    return []

  const samplesPerFrame = Math.max(1, Math.round(sampleRate * frameMs / 1000))
  const frames: PcmMouthFrame[] = []

  for (let frameStart = 0; frameStart < samples.length; frameStart += samplesPerFrame) {
    const frameEnd = Math.min(samples.length, frameStart + samplesPerFrame)
    let sum = 0
    for (let i = frameStart; i < frameEnd; i += 1) {
      const sample = samples[i] ?? 0
      sum += sample * sample
    }

    const startTime = frameStart / sampleRate
    const endTime = frameEnd / sampleRate
    const rms = Math.sqrt(sum / Math.max(1, frameEnd - frameStart))
    frames.push({
      startTime,
      endTime,
      mouthForm: estimatePcm16MouthForm(samples, frameStart, frameEnd, rms),
      mouthOpen: normalizePcm16RmsToMouthOpen(rms, options),
    })
  }

  return frames
}

export function schedulePcmChunk(currentTime: number, queuedUntil: number, duration: number): PcmScheduleResult {
  const startTime = Math.max(currentTime, queuedUntil)
  return {
    startTime,
    endTime: startTime + Math.max(0, duration),
  }
}
