import { describe, expect, it } from 'vitest'

import {
  calculatePcm16MouthFrames,
  calculatePcm16MouthOpen,
  calculatePcm16Rms,
  estimatePcm16MouthForm,
  normalizePcm16RmsToMouthOpen,
  pcm16BytesToFloat32,
  schedulePcmChunk,
} from './pcm-playback'

describe('qwen omni pcm playback helpers', () => {
  it('converts little-endian PCM16 bytes to float samples', () => {
    const bytes = new Uint8Array([0x00, 0x80, 0x00, 0x00, 0xFF, 0x7F])
    expect(Array.from(pcm16BytesToFloat32(bytes))).toEqual([-1, 0, 1])
  })

  it('calculates a normalized rms level', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0xFF, 0x7F])
    expect(calculatePcm16Rms(bytes)).toBeGreaterThan(0)
    expect(calculatePcm16Rms(new Uint8Array())).toBe(0)
  })

  it('maps pcm rms to a Live2D mouth-open value with a noise gate', () => {
    expect(normalizePcm16RmsToMouthOpen(0.001)).toBe(0)
    expect(normalizePcm16RmsToMouthOpen(0.08)).toBeGreaterThan(normalizePcm16RmsToMouthOpen(0.02))
    expect(normalizePcm16RmsToMouthOpen(1)).toBeLessThanOrEqual(0.85)
  })

  it('calculates mouth-open from pcm bytes', () => {
    const silence = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    const loud = new Uint8Array([0xFF, 0x7F, 0x00, 0x80])
    expect(calculatePcm16MouthOpen(silence)).toBe(0)
    expect(calculatePcm16MouthOpen(loud)).toBeGreaterThan(0)
  })

  it('estimates mouth form from pcm texture', () => {
    const buzzy = new Float32Array([0.8, -0.8, 0.8, -0.8, 0.8, -0.8])
    const smooth = new Float32Array([0.4, 0.42, 0.44, 0.42, 0.4, 0.38])
    expect(estimatePcm16MouthForm(buzzy, 0, buzzy.length, 0.8)).toBeGreaterThan(estimatePcm16MouthForm(smooth, 0, smooth.length, 0.4))
  })

  it('splits pcm into timed mouth frames', () => {
    const bytes = new Uint8Array(8)
    bytes.set([0xFF, 0x7F], 0)
    bytes.set([0x00, 0x80], 2)
    bytes.set([0x00, 0x00], 4)
    bytes.set([0x00, 0x00], 6)

    const frames = calculatePcm16MouthFrames(bytes, { sampleRate: 2, frameMs: 1000 })

    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ startTime: 0, endTime: 1 })
    expect(frames[0]).toHaveProperty('mouthForm')
    expect(frames[0]!.mouthOpen).toBeGreaterThan(frames[1]!.mouthOpen)
  })

  it('schedules chunks after the existing queue', () => {
    expect(schedulePcmChunk(10, 8, 0.5)).toEqual({ startTime: 10, endTime: 10.5 })
    expect(schedulePcmChunk(10, 12, 0.5)).toEqual({ startTime: 12, endTime: 12.5 })
  })
})
