export interface PcmScheduleResult {
  startTime: number
  endTime: number
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

export function schedulePcmChunk(currentTime: number, queuedUntil: number, duration: number): PcmScheduleResult {
  const startTime = Math.max(currentTime, queuedUntil)
  return {
    startTime,
    endTime: startTime + Math.max(0, duration),
  }
}
