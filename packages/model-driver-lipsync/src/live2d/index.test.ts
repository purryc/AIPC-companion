import { describe, expect, it } from 'vitest'

import { getMouthFormFromVowelWeights } from './mouth-form'

describe('live2d lip sync mouth form', () => {
  it('maps E/I-heavy vowels to a wide mouth form', () => {
    expect(getMouthFormFromVowelWeights({ A: 0.1, E: 0.8, I: 0.6, O: 0, U: 0 })).toBeGreaterThan(0)
  })

  it('maps O/U-heavy vowels to a round mouth form', () => {
    expect(getMouthFormFromVowelWeights({ A: 0.1, E: 0, I: 0, O: 0.8, U: 0.6 })).toBeLessThan(0)
  })

  it('keeps silence neutral', () => {
    expect(getMouthFormFromVowelWeights({ A: 0, E: 0, I: 0, O: 0, U: 0 })).toBe(0)
  })
})
