import { describe, expect, it } from 'vitest'

import { calculatePcm16Rms, pcm16BytesToFloat32, schedulePcmChunk } from './pcm-playback'

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

  it('schedules chunks after the existing queue', () => {
    expect(schedulePcmChunk(10, 8, 0.5)).toEqual({ startTime: 10, endTime: 10.5 })
    expect(schedulePcmChunk(10, 12, 0.5)).toEqual({ startTime: 12, endTime: 12.5 })
  })
})
