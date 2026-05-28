import { describe, expect, it } from 'vitest'

import { filterTranscriptionByConfidence, hearingErrorMessage } from './hearing'

describe('filterTranscriptionByConfidence', () => {
  const segments = [
    { text: 'Hello ', avg_logprob: -0.3 },
    { text: 'world ', avg_logprob: -1.2 },
    { text: 'gibberish', avg_logprob: -2.5 },
  ]

  it('keeps all segments when threshold is very low', () => {
    expect(filterTranscriptionByConfidence(segments, -3)).toBe('Hello world gibberish')
  })

  it('filters out low-confidence segments', () => {
    expect(filterTranscriptionByConfidence(segments, -1)).toBe('Hello')
  })

  it('filters out all segments when threshold is 0', () => {
    expect(filterTranscriptionByConfidence(segments, 0)).toBe('')
  })

  it('returns empty string for empty segments', () => {
    expect(filterTranscriptionByConfidence([], -1)).toBe('')
  })

  it('trims whitespace from result', () => {
    expect(filterTranscriptionByConfidence([{ text: '  hello  ', avg_logprob: -0.5 }], -1)).toBe('hello')
  })
})

describe('hearingErrorMessage', () => {
  it('explains raw numeric provider errors', () => {
    expect(hearingErrorMessage(26)).toContain('numeric error code 26')
  })

  it('adds transcription context', () => {
    const message = hearingErrorMessage(26, {
      providerId: 'app-local-audio-transcription',
      model: 'whispercpp-local',
      recording: new Blob(['abc'], { type: 'audio/wav' }),
    })

    expect(message).toContain('provider: app-local-audio-transcription')
    expect(message).toContain('model: whispercpp-local')
    expect(message).toContain('recording: 3 bytes, audio/wav')
  })

  it('includes useful fields from object errors without leaking secrets', () => {
    const message = hearingErrorMessage({
      message: 'Provider rejected request',
      status: 400,
      code: 'bad_request',
      apiKey: 'sk-test',
    })

    expect(message).toContain('Provider rejected request')
    expect(message).toContain('"status": 400')
    expect(message).toContain('"code": "bad_request"')
    expect(message).toContain('[redacted]')
    expect(message).not.toContain('sk-test')
  })

  it('adds a clearer hint for generic fetch failures', () => {
    expect(hearingErrorMessage(new Error('Failed to fetch'))).toContain('browser console')
  })
})
