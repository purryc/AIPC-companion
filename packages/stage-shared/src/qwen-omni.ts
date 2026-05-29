export type QwenOmniRegion = 'intl-singapore' | 'cn-beijing'

export type QwenOmniConversationMode = 'classic' | 'qwen-omni'

export type QwenOmniCommandKind = 'chat' | 'prototype' | 'email' | 'gmail-draft' | 'calendar-event' | 'calendar-update' | 'calendar-delete'

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

export interface QwenOmniGmailDraftPlan {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  summary: string
  missing: string[]
}

export interface QwenOmniGmailDraftRequestPayload {
  config: QwenOmniConfig
  prompt: string
  account?: string
}

export interface QwenOmniGmailDraftResult extends QwenOmniGmailDraftPlan {
  ok: boolean
  draftId?: string
  webUrl?: string
  raw?: string
  error?: string
}

export interface QwenOmniCalendarEventPlan {
  title: string
  from: string
  to: string
  timezone: string
  attendees: string[]
  location?: string
  description?: string
  withMeet: boolean
  summary: string
  missing: string[]
}

export interface QwenOmniCalendarEventRequestPayload {
  config: QwenOmniConfig
  prompt: string
  account?: string
  calendarId?: string
  dryRun?: boolean
}

export interface QwenOmniCalendarEventResult extends QwenOmniCalendarEventPlan {
  ok: boolean
  calendarId: string
  dryRun: boolean
  eventId?: string
  htmlLink?: string
  raw?: string
  error?: string
}

export interface QwenOmniCalendarEventContext {
  calendarId: string
  eventId: string
  title: string
  from?: string
  to?: string
  timezone?: string
  location?: string
  description?: string
  htmlLink?: string
}

export interface QwenOmniCalendarEventUpdatePlan {
  calendarId: string
  eventId: string
  title?: string
  from?: string
  to?: string
  timezone?: string
  location?: string
  description?: string
  attendees: string[]
  addAttendees: string[]
  withMeet?: boolean
  summary: string
  missing: string[]
}

export interface QwenOmniCalendarEventUpdateRequestPayload {
  config: QwenOmniConfig
  prompt: string
  account?: string
  calendarId?: string
  recentEvent?: QwenOmniCalendarEventContext
  dryRun?: boolean
}

export interface QwenOmniCalendarEventUpdateResult extends QwenOmniCalendarEventUpdatePlan {
  ok: boolean
  dryRun: boolean
  htmlLink?: string
  raw?: string
  error?: string
}

export interface QwenOmniCalendarEventDeletePlan {
  calendarId: string
  eventId: string
  title: string
  from?: string
  to?: string
  summary: string
  missing: string[]
}

export interface QwenOmniCalendarEventDeleteRequestPayload {
  config: QwenOmniConfig
  prompt: string
  account?: string
  calendarId?: string
  recentEvent?: QwenOmniCalendarEventContext
  dryRun?: boolean
}

export interface QwenOmniCalendarEventDeleteResult extends QwenOmniCalendarEventDeletePlan {
  ok: boolean
  dryRun: boolean
  raw?: string
  error?: string
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

const SCREEN_EMAIL_KEYWORDS = [
  '看这封邮件',
  '帮我回复',
  '写到这里',
  '写封回复',
  '回复这封',
  'reply this',
  'email reply',
  'gmail reply',
]

const GMAIL_DRAFT_KEYWORDS = [
  '写邮件',
  '写封邮件',
  '帮我写邮件',
  '邮件草稿',
  '创建邮件草稿',
  '发邮件',
  '发一封邮件',
  'compose email',
  'email draft',
  'write an email',
  'draft an email',
]

const CALENDAR_EVENT_KEYWORDS = [
  '加日程',
  '创建日程',
  '加到日历',
  '写到日历',
  '安排会议',
  '创建会议',
  '日历',
  '会议',
  '约会',
  'calendar',
  'schedule',
  'meeting',
  'create event',
]

const CALENDAR_UPDATE_KEYWORDS = [
  '修改日程',
  '编辑日程',
  '更新日程',
  '改日程',
  '修改日历',
  '编辑日历',
  '更新日历',
  '修改会议',
  '编辑会议',
  '更新会议',
  '改会议',
  '改一下日程',
  '改一下会议',
  'rename event',
  'update event',
  'edit event',
  'change event',
  'update calendar',
  'edit calendar',
]

const CALENDAR_DELETE_KEYWORDS = [
  '删除日程',
  '删掉日程',
  '取消日程',
  '删除会议',
  '删掉会议',
  '取消会议',
  '删除约会',
  '删掉约会',
  '取消约会',
  'delete event',
  'remove event',
  'delete meeting',
  'remove meeting',
  'cancel meeting',
]

const NON_CALENDAR_REWRITE_KEYWORDS = [
  '句子',
  '文案',
  '文本',
  '代码',
  '邮件',
  '草稿',
  '翻译',
  'english',
  'email',
  'reply',
]

const NON_CALENDAR_DELETE_KEYWORDS = [
  '句子',
  '文案',
  '文本',
  '代码',
  '邮件',
  '草稿',
  '消息',
  '记录',
  'file',
  'email',
  'draft',
  'message',
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

  if (SCREEN_EMAIL_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'email'

  if (CALENDAR_DELETE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'calendar-delete'

  if (
    /删|取消|delete|remove|cancel/i.test(normalized)
    && (
      /日程|日历|会议|约会|calendar|event|meeting|schedule/i.test(normalized)
      || /(?:今天|明天|后天|上午|中午|下午|晚上|今晚|\d+\s*点|[一二三四五六七八九十两]+\s*点).{0,12}会/.test(normalized)
    )
    && !NON_CALENDAR_DELETE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()))
  ) {
    return 'calendar-delete'
  }

  if (CALENDAR_UPDATE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'calendar-update'

  if (
    /(?:把|将).{1,40}(?:改成|改为|换成|换为).{1,40}/.test(normalized)
    && !NON_CALENDAR_REWRITE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()))
  ) {
    return 'calendar-update'
  }

  if (CALENDAR_EVENT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'calendar-event'

  if (GMAIL_DRAFT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase())))
    return 'gmail-draft'

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

function stringListField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (Array.isArray(value))
    return stringArrayField(value)

  if (typeof value !== 'string')
    return []

  return value
    .split(/[,;，；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function booleanField(record: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = record[key]
  return typeof value === 'boolean' ? value : fallback
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

export function parseQwenOmniGmailDraftPlanResponse(text: string): QwenOmniGmailDraftPlan {
  const record = parseObjectFromJsonText(text)

  return {
    to: stringListField(record, 'to'),
    cc: stringListField(record, 'cc'),
    bcc: stringListField(record, 'bcc'),
    subject: stringField(record, 'subject'),
    body: stringField(record, 'body'),
    summary: stringField(record, 'summary'),
    missing: stringListField(record, 'missing'),
  }
}

export function parseQwenOmniCalendarEventPlanResponse(text: string): QwenOmniCalendarEventPlan {
  const record = parseObjectFromJsonText(text)

  return {
    title: stringField(record, 'title'),
    from: stringField(record, 'from'),
    to: stringField(record, 'to'),
    timezone: stringField(record, 'timezone'),
    attendees: stringListField(record, 'attendees'),
    location: stringField(record, 'location') || undefined,
    description: stringField(record, 'description') || undefined,
    withMeet: booleanField(record, 'withMeet'),
    summary: stringField(record, 'summary'),
    missing: stringListField(record, 'missing'),
  }
}

export function parseQwenOmniCalendarEventUpdatePlanResponse(text: string): QwenOmniCalendarEventUpdatePlan {
  const record = parseObjectFromJsonText(text)

  return {
    calendarId: stringField(record, 'calendarId'),
    eventId: stringField(record, 'eventId'),
    title: stringField(record, 'title') || undefined,
    from: stringField(record, 'from') || undefined,
    to: stringField(record, 'to') || undefined,
    timezone: stringField(record, 'timezone') || undefined,
    location: stringField(record, 'location') || undefined,
    description: stringField(record, 'description') || undefined,
    attendees: stringListField(record, 'attendees'),
    addAttendees: stringListField(record, 'addAttendees'),
    withMeet: booleanField(record, 'withMeet') || undefined,
    summary: stringField(record, 'summary'),
    missing: stringListField(record, 'missing'),
  }
}

export function parseQwenOmniCalendarEventDeletePlanResponse(text: string): QwenOmniCalendarEventDeletePlan {
  const record = parseObjectFromJsonText(text)

  return {
    calendarId: stringField(record, 'calendarId'),
    eventId: stringField(record, 'eventId'),
    title: stringField(record, 'title'),
    from: stringField(record, 'from') || undefined,
    to: stringField(record, 'to') || undefined,
    summary: stringField(record, 'summary'),
    missing: stringListField(record, 'missing'),
  }
}
