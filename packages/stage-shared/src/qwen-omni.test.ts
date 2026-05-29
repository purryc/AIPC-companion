import { describe, expect, it } from 'vitest'

import {
  normalizeQwenOmniConfig,
  parseQwenOmniEmailDraftResponse,
  parseQwenOmniPrototypeResponse,
  parseQwenOmniRealtimeProviderEvent,
  QWEN_OMNI_DEFAULT_CONFIG,
  resolveQwenOmniEndpoints,
  routeQwenOmniCommand,
  sanitizeQwenOmniPrototypeHtml,
} from './qwen-omni'

describe('qwen omni shared helpers', () => {
  it('maps Singapore and Beijing endpoints', () => {
    expect(resolveQwenOmniEndpoints('intl-singapore')).toEqual({
      compatibleBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      realtimeUrl: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime',
    })
    expect(resolveQwenOmniEndpoints('cn-beijing')).toEqual({
      compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      realtimeUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    })
  })

  it('normalizes the deprecated Qwen3.5 flash realtime alias to a valid realtime model', () => {
    expect(QWEN_OMNI_DEFAULT_CONFIG.realtimeModel).toBe('qwen3.5-omni-plus-realtime')
    expect(normalizeQwenOmniConfig({
      realtimeModel: 'qwen3.5-omni-flash-realtime',
    }).realtimeModel).toBe('qwen3.5-omni-plus-realtime')
  })

  it('normalizes the old non-Qwen3.5 realtime voice to the provider default', () => {
    expect(QWEN_OMNI_DEFAULT_CONFIG.voice).toBe('Tina')
    expect(normalizeQwenOmniConfig({
      voice: 'Sunnybobi',
    }).voice).toBe('Tina')
  })

  it('routes deterministic demo commands before normal chat', () => {
    expect(routeQwenOmniCommand('你看这个草图，帮我生成原型')).toBe('prototype')
    expect(routeQwenOmniCommand('看这封邮件，帮我回复并写到这里')).toBe('email')
    expect(routeQwenOmniCommand('今天我们聊点轻松的')).toBe('chat')
  })

  it('sanitizes prototype iframe payloads', () => {
    expect(sanitizeQwenOmniPrototypeHtml('<button onclick="alert(1)">OK</button><script>alert(1)</script>')).toBe('<button>OK</button>')
    expect(sanitizeQwenOmniPrototypeHtml('<a href="javascript:alert(1)">bad</a>')).toBe('<a>bad</a>')
  })

  it('parses prototype JSON from fenced responses', () => {
    const parsed = parseQwenOmniPrototypeResponse(`\`\`\`json
{
  "title": "Sketch Todo",
  "summary": "A compact todo prototype.",
  "spec": {
    "title": "Sketch Todo",
    "userGoal": "Capture tasks fast",
    "screens": [{ "name": "Main", "purpose": "List tasks", "keyElements": ["input", "list"] }],
    "interactions": ["Add task"],
    "assumptions": ["Single screen"]
  },
  "html": "<main><h1>Sketch Todo</h1></main>"
}
\`\`\``)

    expect(parsed.title).toBe('Sketch Todo')
    expect(parsed.spec.screens[0]?.keyElements).toEqual(['input', 'list'])
    expect(parsed.html).toContain('<main>')
  })

  it('parses email draft JSON', () => {
    const parsed = parseQwenOmniEmailDraftResponse('{"subject":"Re: Demo","summary":"Positive reply","draft":"Thanks, I can join tomorrow."}')
    expect(parsed.subject).toBe('Re: Demo')
    expect(parsed.draft).toContain('tomorrow')
  })

  it('parses realtime provider lifecycle and delta events', () => {
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'session.created' })).toEqual({ type: 'session-created' })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'session.updated' })).toEqual({ type: 'session-updated' })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello' })).toEqual({
      type: 'input-transcript',
      text: 'hello',
    })
    expect(parseQwenOmniRealtimeProviderEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      text: '你',
      stash: '好',
    })).toEqual({
      type: 'input-transcript-delta',
      text: '你',
      stash: '好',
    })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'response.output_item.added' })).toEqual({
      type: 'response-created',
    })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'response.output_item.done' })).toEqual({
      type: 'response-done',
    })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'response.content_part.done' })).toEqual({
      type: 'response-done',
    })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'response.text.delta', delta: 'hi' })).toEqual({
      type: 'text-delta',
      text: 'hi',
    })
    expect(parseQwenOmniRealtimeProviderEvent({ type: 'response.audio_transcript.done', transcript: '你好，我在这里。' })).toEqual({
      type: 'text-delta',
      text: '你好，我在这里。',
    })

    const audio = parseQwenOmniRealtimeProviderEvent({ type: 'response.audio.delta', delta: 'AQID' })
    expect(audio?.type).toBe('audio-delta')
    expect(audio?.type === 'audio-delta' ? Array.from(audio.pcm16) : []).toEqual([1, 2, 3])
  })

  it('marks credential and quota realtime errors as fatal', () => {
    expect(parseQwenOmniRealtimeProviderEvent({
      type: 'error',
      error: { message: 'Unauthorized API key' },
    })).toEqual({
      type: 'error',
      message: 'Unauthorized API key',
      fatal: true,
    })

    expect(parseQwenOmniRealtimeProviderEvent({
      type: 'error',
      error: { message: 'Temporary network failure' },
    })).toEqual({
      type: 'error',
      message: 'Temporary network failure',
      fatal: false,
    })
  })
})
