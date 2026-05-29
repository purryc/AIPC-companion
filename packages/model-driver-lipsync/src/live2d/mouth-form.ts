export type VowelKey = 'A' | 'E' | 'I' | 'O' | 'U'

export function getMouthFormFromVowelWeights(weights: Record<VowelKey, number>): number {
  const wide = Math.max(weights.E, weights.I, weights.A * 0.35)
  const round = Math.max(weights.O, weights.U)
  const total = wide + round
  if (total <= 0.001)
    return 0

  return Math.max(-1, Math.min(1, (wide - round) / total))
}
