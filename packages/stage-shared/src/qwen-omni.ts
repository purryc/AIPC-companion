export type QwenOmniRegion = 'intl-singapore' | 'cn-beijing'

export type QwenOmniConversationMode = 'classic' | 'qwen-omni'

export type QwenOmniCommandKind = 'chat' | 'prototype' | 'email'

export interface QwenOmniConfig {
  apiKey: string
  region: QwenOmniRegion
  httpModel: string
  realtimeModel: string
  voice: string
  inputTranscriptionModel: string
  vadThreshold: number
  vadPrefixPaddingMs: number
  vadSilenceDurationMs: number
}

export interface QwenOmniEndpointConfig {
  compatibleBaseUrl: string
  realtimeUrl: string
}

export interface QwenOmniRealtimeStartPayload {
  config: QwenOmniConfig
  instructions?: string
}

export interface QwenOmniAudioPayload {
  pcm16: Uint8Array
}

export interface QwenOmniImagePayload {
  imageBase64: string
}

export interface QwenOmniTextPayload {
  text: string
}

export type QwenOmniRealtimeEvent
  = | { type: 'session-created' }
    | { type: 'session-updated' }
    | { type: 'response-created' }
    | { type: 'response-done' }
    | { type: 'speech-started' }
    | { type: 'speech-stopped' }
    | { type: 'input-transcript-delta', text: string, stash: string }
    | { type: 'input-transcript', text: string }
    | { type: 'text-delta', text: string }
    | { type: 'audio-delta', pcm16: Uint8Array, sampleRate: 24000 }
    | { type: 'error', message: string, fatal?: boolean }
    | { type: 'debug', message: string }

export interface QwenOmniPrototypeSpec {
  title: string
  userGoal: string
  screens: Array<{
    name: string
    purpose: string
    keyElements: string[]
  }>
  interactions: string[]
  assumptions: string[]
}

export interface QwenOmniPrototypeResult {
  title: string
  summary: string
  spec: QwenOmniPrototypeSpec
  html: string
}

export interface QwenOmniPrototypeRequestPayload {
  config: QwenOmniConfig
  prompt: string
  imageDataUrl: string
}

export interface QwenOmniEmailDraftResult {
  subject?: string
  summary: string
  draft: string
}

export interface QwenOmniEmailDraftRequestPayload {
  config: QwenOmniConfig
  prompt: string
  imageDataUrl: string
}

export interface QwenOmniPasteTextPayload {
  text: string
}

export interface QwenOmniPasteTextResult {
  ok: boolean
  error?: string
}

const QWEN_OMNI_ENDPOINTS = {
  'intl-singapore': {
    compatibleBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    realtimeUrl: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime',
  },
  'cn-beijing': {
    compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    realtimeUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  },
} as const satisfies Record<QwenOmniRegion, QwenOmniEndpointConfig>

export const QWEN_OMNI_DEFAULT_CONFIG = {
  apiKey: '',
  region: 'intl-singapore',
  httpModel: 'qwen3.5-omni-flash',
  realtimeModel: 'qwen3.5-omni-plus-realtime',
  voice: 'Tina',
  inputTranscriptionModel: 'gummy-realtime-v1',
  vadThreshold: 0.5,
  vadPrefixPaddingMs: 500,
  vadSilenceDurationMs: 900,
} as const satisfies QwenOmniConfig

const PROTOTYPE_KEYWORDS = [
  '看这个草图',
  '生成原型',
  '做个 demo',
  '做个demo',
  'prototype',
  'wireframe',
  'sketch',
]

const EMAIL_KEYWORDS = [
  '看这封邮件',
  '帮我回复',
  '写到这里',
  '写封回复',
  '回复这封',
  'gmail',
  'email',
  'reply',
]

export function resolveQwenOmniEndpoints(region: QwenOmniRegion): QwenOmniEndpointConfig {
  return QWEN_OMNI_ENDPOINTS[region]
}

export function normalizeQwenOmniConfig(config: Partial<QwenOmniConfig>): QwenOmniConfig {
  const realtimeModel = config.realtimeModel?.trim()
  const voice = config.voice?.trim()

  return {
    ...QWEN_OMNI_DEFAULT_CONFIG,
    ...config,
    apiKey: config.apiKey?.trim() ?? QWEN_OMNI_DEFAULT_CONFIG.apiKey,
    httpModel: config.httpModel?.trim() || QWEN_OMNI_DEFAULT_CONFIG.httpModel,
    realtimeModel: realtimeModel === 'qwen3.5-omni-flash-realtime'
      ? QWEN_OMNI_DEFAULT_CONFIG.realtimeModel
      : realtimeModel || QWEN_OMNI_DEFAULT_CONFIG.realtimeModel,
    voice: voice === 'Sunnybobi'
      ? QWEN_OMNI_DEFAULT_CONFIG.voice
      : voice || QWEN_OMNI_DEFAULT_CONFIG.voice,
    inputTranscriptionModel: config.inputTranscriptionModel?.trim() || QWEN_OMNI_DEFAULT_CONFIG.inputTranscriptionModel,
  }
}

export function routeQwenOmniCommand(text: string): QwenOmniCommandKind {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized)
    return 'chat'

  if (PROTOTYPE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'prototype'

  if (EMAIL_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'email'

  return 'chat'
}

function rawStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1)
    bytes[i] = binary.charCodeAt(i)

  return bytes
}

function qwenRealtimeErrorMessage(record: Record<string, unknown>): string {
  const error = record.error
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>
    return rawStringField(errorRecord, 'message')
      ?? rawStringField(errorRecord, 'code')
      ?? JSON.stringify(errorRecord)
  }

  return rawStringField(record, 'message') ?? JSON.stringify(record)
}

function isFatalQwenRealtimeError(message: string): boolean {
  return /authorization|unauthorized|forbidden|api[-_ ]?key|invalid api|quota|model/i.test(message)
}

export function parseQwenOmniRealtimeProviderEvent(record: Record<string, unknown>): QwenOmniRealtimeEvent | undefined {
  const type = rawStringField(record, 'type')
  switch (type) {
    case 'session.created':
      return { type: 'session-created' }
    case 'session.updated':
      return { type: 'session-updated' }
    case 'response.created':
    case 'response.output_item.added':
      return { type: 'response-created' }
    case 'response.done':
    case 'response.output_item.done':
    case 'response.content_part.done':
      return { type: 'response-done' }
    case 'input_audio_buffer.speech_started':
      return { type: 'speech-started' }
    case 'input_audio_buffer.speech_stopped':
      return { type: 'speech-stopped' }
    case 'conversation.item.input_audio_transcription.delta':
    case 'conversation.item.input_audio_transcription.text':
      return {
        type: 'input-transcript-delta',
        text: rawStringField(record, 'text') ?? '',
        stash: rawStringField(record, 'stash') ?? '',
      }
    case 'conversation.item.input_audio_transcription.completed':
      return { type: 'input-transcript', text: rawStringField(record, 'transcript') ?? '' }
    case 'response.text.delta':
    case 'response.audio_transcript.delta':
      return { type: 'text-delta', text: rawStringField(record, 'delta') ?? '' }
    case 'response.text.done':
    case 'response.audio_transcript.done':
      return {
        type: 'text-delta',
        text: rawStringField(record, 'transcript') ?? rawStringField(record, 'text') ?? '',
      }
    case 'response.audio.delta': {
      const delta = rawStringField(record, 'delta')
      if (!delta)
        return undefined

      return { type: 'audio-delta', pcm16: base64ToUint8Array(delta), sampleRate: 24000 }
    }
    case 'error': {
      const message = qwenRealtimeErrorMessage(record)
      return { type: 'error', message, fatal: isFatalQwenRealtimeError(message) }
    }
    default:
      return undefined
  }
}

export function sanitizeQwenOmniPrototypeHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '')

  return withoutScripts.trim()
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function parseObjectFromJsonText(text: string): Record<string, unknown> {
  const cleaned = stripJsonFence(text)
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  }
  catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start)
      throw new Error('Qwen response did not contain a JSON object')

    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  }
}

function stringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value))
    return []

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
}

function parsePrototypeSpec(value: unknown, fallbackTitle: string): QwenOmniPrototypeSpec {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const screensValue = Array.isArray(record.screens) ? record.screens : []
  const screens = screensValue.map((screen, index) => {
    const screenRecord = screen && typeof screen === 'object' ? screen as Record<string, unknown> : {}
    return {
      name: stringField(screenRecord, 'name', `Screen ${index + 1}`),
      purpose: stringField(screenRecord, 'purpose'),
      keyElements: stringArrayField(screenRecord.keyElements),
    }
  })

  return {
    title: stringField(record, 'title', fallbackTitle),
    userGoal: stringField(record, 'userGoal'),
    screens,
    interactions: stringArrayField(record.interactions),
    assumptions: stringArrayField(record.assumptions),
  }
}

export function parseQwenOmniPrototypeResponse(text: string): QwenOmniPrototypeResult {
  const record = parseObjectFromJsonText(text)
  const title = stringField(record, 'title', 'Qwen Prototype')
  const html = sanitizeQwenOmniPrototypeHtml(stringField(record, 'html'))
  if (!html)
    throw new Error('Qwen response did not include prototype HTML')

  return {
    title,
    summary: stringField(record, 'summary'),
    spec: parsePrototypeSpec(record.spec, title),
    html,
  }
}

export function parseQwenOmniEmailDraftResponse(text: string): QwenOmniEmailDraftResult {
  const record = parseObjectFromJsonText(text)
  const draft = stringField(record, 'draft')
  if (!draft)
    throw new Error('Qwen response did not include an email draft')

  return {
    subject: stringField(record, 'subject') || undefined,
    summary: stringField(record, 'summary'),
    draft,
  }
}
