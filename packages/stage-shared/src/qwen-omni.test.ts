import { describe, expect, it } from 'vitest'

import {
  normalizeQwenOmniConfig,
  parseQwenOmniCalendarEventDeletePlanResponse,
  parseQwenOmniCalendarEventPlanResponse,
  parseQwenOmniCalendarEventUpdatePlanResponse,
  parseQwenOmniEmailDraftResponse,
  parseQwenOmniGmailDraftPlanResponse,
  parseQwenOmniPrototypeResponse,
  parseQwenOmniRealtimeProviderEvent,
  QWEN_OMNI_DEFAULT_CONFIG,
  resolveQwenOmniEndpoints,
  resolveQwenOmniVoiceReconcile,
  routeQwenOmniCommand,
  sanitizeQwenOmniPrototypeHtml,
  shouldRunQwenOmniCommandForFinalTranscript,
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
    expect(routeQwenOmniCommand('帮我写邮件给 alex@example.com 说明今天会晚点回复')).toBe('gmail-draft')
    expect(routeQwenOmniCommand('帮我明天下午三点加日程，和 alex@example.com 开会')).toBe('calendar-event')
    expect(routeQwenOmniCommand('帮我修改会议标题，把 A 大改成 Ada')).toBe('calendar-update')
    expect(routeQwenOmniCommand('把 A 大换为人名 Ada')).toBe('calendar-update')
    expect(routeQwenOmniCommand('把下午5点的会删了')).toBe('calendar-delete')
    expect(routeQwenOmniCommand('删除明天三点的会议')).toBe('calendar-delete')
    expect(routeQwenOmniCommand('把这句文案改成英文')).toBe('chat')
    expect(routeQwenOmniCommand('把这句文案删了')).toBe('chat')
    expect(routeQwenOmniCommand('今天我们聊点轻松的')).toBe('chat')
  })

  it('resolves Qwen Omni voice reconcile actions without duplicate starts', () => {
    expect(resolveQwenOmniVoiceReconcile({
      state: 'idle',
      enabled: false,
      qwenModeEnabled: false,
      configured: true,
      hasStream: false,
      streamRevision: 0,
      sessionActive: false,
      inputAttached: false,
    }, {
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: false,
      streamRevision: 0,
    })).toEqual({
      state: 'acquiring-mic',
      actions: ['wait-for-mic'],
    })

    expect(resolveQwenOmniVoiceReconcile({
      state: 'idle',
      enabled: false,
      qwenModeEnabled: false,
      configured: true,
      hasStream: false,
      streamRevision: 0,
      sessionActive: false,
      inputAttached: false,
    }, {
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
    })).toEqual({
      state: 'connecting',
      actions: ['connect-realtime', 'attach-input'],
    })

    expect(resolveQwenOmniVoiceReconcile({
      state: 'streaming',
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
      sessionActive: true,
      inputAttached: true,
    }, {
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
    })).toEqual({
      state: 'streaming',
      actions: [],
    })

    expect(resolveQwenOmniVoiceReconcile({
      state: 'streaming',
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
      sessionActive: true,
      inputAttached: true,
    }, {
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 2,
    })).toEqual({
      state: 'streaming',
      actions: ['attach-input'],
    })

    expect(resolveQwenOmniVoiceReconcile({
      state: 'streaming',
      enabled: true,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
      sessionActive: true,
      inputAttached: true,
    }, {
      enabled: false,
      qwenModeEnabled: true,
      configured: true,
      hasStream: true,
      streamRevision: 1,
    })).toEqual({
      state: 'closing',
      actions: ['close-realtime'],
    })
  })

  it('only runs side-effect commands for final unique transcripts', () => {
    expect(shouldRunQwenOmniCommandForFinalTranscript({
      final: false,
      text: '帮我明天下午三点加日程',
      command: 'calendar-event',
      turnId: 'turn-1',
      previousTurnId: '',
      previousText: '',
      previousCommand: 'chat',
      previousExecutedAt: 0,
      now: 10_000,
    })).toBe(false)

    expect(shouldRunQwenOmniCommandForFinalTranscript({
      final: true,
      text: '帮我明天下午三点加日程',
      command: 'calendar-event',
      turnId: 'turn-1',
      previousTurnId: '',
      previousText: '',
      previousCommand: 'chat',
      previousExecutedAt: 0,
      now: 10_000,
    })).toBe(true)

    expect(shouldRunQwenOmniCommandForFinalTranscript({
      final: true,
      text: '帮我明天下午三点加日程',
      command: 'calendar-event',
      turnId: 'turn-1',
      previousTurnId: 'turn-1',
      previousText: '帮我明天下午三点加日程',
      previousCommand: 'calendar-event',
      previousExecutedAt: 10_000,
      now: 10_200,
    })).toBe(false)

    expect(shouldRunQwenOmniCommandForFinalTranscript({
      final: true,
      text: '帮我明天下午三点加日程。',
      command: 'calendar-event',
      turnId: 'turn-2',
      previousTurnId: 'turn-1',
      previousText: '帮我明天下午三点加日程',
      previousCommand: 'calendar-event',
      previousExecutedAt: 10_000,
      now: 10_400,
    })).toBe(false)

    expect(shouldRunQwenOmniCommandForFinalTranscript({
      final: true,
      text: '你好',
      command: 'chat',
      turnId: 'turn-3',
      previousTurnId: 'turn-2',
      previousText: '帮我明天下午三点加日程',
      previousCommand: 'calendar-event',
      previousExecutedAt: 10_000,
      now: 20_000,
    })).toBe(false)
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

  it('parses Gmail draft plan JSON', () => {
    const parsed = parseQwenOmniGmailDraftPlanResponse('{"to":["alex@example.com"],"cc":"","bcc":[],"subject":"Quick update","body":"I will reply later today.","summary":"Draft a short update.","missing":[]}')
    expect(parsed.to).toEqual(['alex@example.com'])
    expect(parsed.cc).toEqual([])
    expect(parsed.subject).toBe('Quick update')
    expect(parsed.body).toContain('reply later')
  })

  it('parses calendar event plan JSON', () => {
    const parsed = parseQwenOmniCalendarEventPlanResponse('{"title":"Project sync","from":"2026-05-30T15:00:00-04:00","to":"2026-05-30T15:30:00-04:00","timezone":"America/Toronto","attendees":["alex@example.com"],"location":"Google Meet","description":"Discuss prototype.","withMeet":true,"summary":"Create a 30-minute sync.","missing":[]}')
    expect(parsed.title).toBe('Project sync')
    expect(parsed.attendees).toEqual(['alex@example.com'])
    expect(parsed.withMeet).toBe(true)
    expect(parsed.from).toContain('2026-05-30T15:00:00')
  })

  it('parses calendar event update plan JSON', () => {
    const parsed = parseQwenOmniCalendarEventUpdatePlanResponse('{"calendarId":"primary","eventId":"event-1","title":"Meeting with Ada","from":"","to":"","timezone":"America/Toronto","location":"","description":"","attendees":[],"addAttendees":[],"withMeet":false,"summary":"Rename the meeting.","missing":[]}')
    expect(parsed.calendarId).toBe('primary')
    expect(parsed.eventId).toBe('event-1')
    expect(parsed.title).toBe('Meeting with Ada')
    expect(parsed.attendees).toEqual([])
    expect(parsed.withMeet).toBeUndefined()
  })

  it('parses calendar event delete plan JSON', () => {
    const parsed = parseQwenOmniCalendarEventDeletePlanResponse('{"calendarId":"primary","eventId":"event-1","title":"A meeting","from":"2026-05-29T17:00:00-04:00","to":"2026-05-29T18:00:00-04:00","summary":"Delete the 5pm meeting.","missing":[]}')
    expect(parsed.calendarId).toBe('primary')
    expect(parsed.eventId).toBe('event-1')
    expect(parsed.title).toBe('A meeting')
    expect(parsed.from).toContain('17:00:00')
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
