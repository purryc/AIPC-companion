import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenOmniCalendarEventContext,
  QwenOmniCalendarEventDeleteRequestPayload,
  QwenOmniCalendarEventDeleteResult,
  QwenOmniCalendarEventRequestPayload,
  QwenOmniCalendarEventResult,
  QwenOmniCalendarEventUpdateRequestPayload,
  QwenOmniCalendarEventUpdateResult,
  QwenOmniConfig,
  QwenOmniEmailDraftRequestPayload,
  QwenOmniEmailDraftResult,
  QwenOmniGmailDraftRequestPayload,
  QwenOmniGmailDraftResult,
  QwenOmniPrototypeRequestPayload,
  QwenOmniPrototypeResult,
  QwenOmniRealtimeEvent,
} from '@proj-airi/stage-shared'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

import WebSocket from 'ws'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  normalizeQwenOmniConfig,
  parseQwenOmniCalendarEventDeletePlanResponse,
  parseQwenOmniCalendarEventPlanResponse,
  parseQwenOmniCalendarEventUpdatePlanResponse,
  parseQwenOmniEmailDraftResponse,
  parseQwenOmniGmailDraftPlanResponse,
  parseQwenOmniPrototypeResponse,
  parseQwenOmniRealtimeProviderEvent,
  resolveQwenOmniEndpoints,
} from '@proj-airi/stage-shared'
import { clipboard } from 'electron'
import { isMacOS } from 'std-env'

import {
  qwenOmniCreateCalendarEvent,
  qwenOmniCreateGmailDraft,
  qwenOmniDeleteCalendarEvent,
  qwenOmniDraftEmail,
  qwenOmniGeneratePrototype,
  qwenOmniPasteText,
  qwenOmniRealtimeAppendAudio,
  qwenOmniRealtimeAppendImage,
  qwenOmniRealtimeCancel,
  qwenOmniRealtimeClose,
  qwenOmniRealtimeEvent,
  qwenOmniRealtimeSendText,
  qwenOmniRealtimeStart,
  qwenOmniUpdateCalendarEvent,
} from '../../../../shared/eventa'

type MainEventaContext = ReturnType<typeof createContext>['context']

interface RealtimeSessionState {
  context: MainEventaContext
  socket?: WebSocket
  ready?: Promise<void>
  resolveReady?: () => void
  rejectReady?: (error: Error) => void
  readyResolved: boolean
  audioAppended: boolean
}

interface CompatibleChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface CompatibleChatMessage {
  role: 'system' | 'user'
  content: string | CompatibleChatContentPart[]
}

interface CompatibleChatResponseChoice {
  message?: {
    content?: unknown
  }
}

interface CompatibleChatResponse {
  choices?: CompatibleChatResponseChoice[]
  error?: {
    message?: string
  }
}

const DEFAULT_INSTRUCTIONS = [
  'You are AIRI, a warm desktop companion.',
  'Reply conversationally and concisely.',
  'When the user asks you to inspect a sketch, screen, or email, wait for the app workflow instead of inventing unseen details.',
  'When the user asks to create Gmail drafts, write email, add, update, or delete calendar events, record schedules, or create reminders, do not claim completion; the desktop app will handle the native action.',
].join('\n')

const QUIET_REALTIME_EVENTS = new Set([
  'conversation.item.created',
  'input_audio_buffer.committed',
  'response.content_part.added',
  'response.audio.done',
])

const PROTOTYPE_SYSTEM_PROMPT = [
  'You convert one screenshot or sketch into a small interactive prototype.',
  'Return only valid JSON with keys: title, summary, spec, html.',
  'spec must contain title, userGoal, screens, interactions, assumptions.',
  'html must be a complete single-page HTML document using inline CSS and minimal inline JavaScript only if essential.',
  'Do not include external network assets. Do not include markdown fences.',
].join('\n')

const EMAIL_SYSTEM_PROMPT = [
  'You inspect the visible email or Gmail reply context and draft a reply.',
  'Return only valid JSON with keys: subject, summary, draft.',
  'The draft must be ready to paste into the focused reply box.',
  'Never include instructions to send the email.',
  'If visual context is incomplete, write a cautious, editable draft and mention the assumption in summary.',
].join('\n')

const GMAIL_DRAFT_SYSTEM_PROMPT = [
  'You turn a user request into a Gmail draft.',
  'Return only valid JSON with keys: to, cc, bcc, subject, body, summary, missing.',
  'to, cc, bcc, and missing must be arrays of strings.',
  'Only include recipient email addresses that are explicitly present in the user request.',
  'If the user gives only a name without an email address, leave to empty and add "recipient email" to missing.',
  'Never send email. This workflow creates a Gmail draft only.',
].join('\n')

const CALENDAR_EVENT_SYSTEM_PROMPT = [
  'You turn a user request into a Google Calendar event.',
  'Return only valid JSON with keys: title, from, to, timezone, attendees, location, description, withMeet, summary, missing.',
  'from and to must be RFC3339 timestamps with timezone offsets.',
  'attendees and missing must be arrays of strings.',
  'Only include attendee email addresses explicitly present in the user request.',
  'If the user asks for Google Meet or video call, set withMeet to true.',
  'If duration is missing, use 30 minutes for calls or meetings and 1 hour for general events, then mention that assumption in summary.',
  'If date, start time, or title cannot be inferred, add the missing field name to missing.',
].join('\n')

const CALENDAR_EVENT_UPDATE_SYSTEM_PROMPT = [
  'You update one existing Google Calendar event from the user request.',
  'Return only valid JSON with keys: calendarId, eventId, title, from, to, timezone, location, description, attendees, addAttendees, withMeet, summary, missing.',
  'Use provided candidates to identify the target event. Prefer recentEvent when the user says "刚才", "这个", or gives only a title/text replacement.',
  'If the user asks to replace text in a title, return the complete new title in title.',
  'Do not invent attendee emails. If only a person name is provided, update title or description, not attendees.',
  'Leave fields empty when they should not change.',
  'If no target event can be identified, leave eventId empty and add "target event" to missing.',
].join('\n')

const CALENDAR_EVENT_DELETE_SYSTEM_PROMPT = [
  'You delete one existing Google Calendar event from the user request.',
  'Return only valid JSON with keys: calendarId, eventId, title, from, to, summary, missing.',
  'Use provided candidateEvents to identify the target event. Match by date, time, and title.',
  'Prefer exact time matches such as "下午5点" = 17:00 local time.',
  'Only choose an eventId when exactly one candidate clearly matches the user request.',
  'If no unique target event can be identified, leave eventId empty and add "target event" to missing.',
].join('\n')

const DEFAULT_CALENDAR_ID = 'primary'
const GOG_DEFAULT_PATH = '/opt/homebrew/bin/gog'

let realtimeSession: RealtimeSessionState | undefined
let realtimeStartPromise: Promise<void> | undefined
let realtimeEventId = 0

function createReadyPromise(state: RealtimeSessionState) {
  state.readyResolved = false
  state.ready = new Promise<void>((resolve, reject) => {
    state.resolveReady = resolve
    state.rejectReady = reject
  })
}

function emitRealtimeForSession(session: RealtimeSessionState | undefined, event: QwenOmniRealtimeEvent) {
  session?.context.emit(qwenOmniRealtimeEvent, event)
}

function safeJsonParse(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  }
  catch {
    return undefined
  }
}

function safeJsonParseUnknown(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return undefined
  }
}

function localRuntimeContext() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'

  return [
    `Current date/time: ${new Date().toISOString()}`,
    `Local timezone: ${timezone}`,
  ].join('\n')
}

function resolveGogBin() {
  const configured = process.env.GOG_BIN?.trim()
  if (configured)
    return configured

  return existsSync(GOG_DEFAULT_PATH) ? GOG_DEFAULT_PATH : 'gog'
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function findNestedStringField(value: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys.map(key => key.toLowerCase()))

  function visit(current: unknown): string | undefined {
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item)
        if (found)
          return found
      }
      return undefined
    }

    if (!current || typeof current !== 'object')
      return undefined

    const record = current as Record<string, unknown>
    for (const [key, item] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof item === 'string' && item.trim())
        return item.trim()
    }

    for (const item of Object.values(record)) {
      const found = visit(item)
      if (found)
        return found
    }

    return undefined
  }

  return visit(value)
}

function clippedRawOutput(stdout: string, stderr: string) {
  const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
  return raw ? raw.slice(0, 5000) : undefined
}

function gogBaseArgs(account?: string) {
  const trimmedAccount = account?.trim()
  return [
    '--json',
    '--results-only',
    '--no-input',
    ...(trimmedAccount ? ['--account', trimmedAccount] : []),
  ]
}

function runGog(args: string[], timeout = 30000): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(resolveGogBin(), args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const details = [errorMessageFrom(error), stderr.trim(), stdout.trim()]
          .filter(Boolean)
          .join('\n')
        reject(new Error(details || 'gog command failed'))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

function resolveReadyForSession(session: RealtimeSessionState) {
  if (session.readyResolved)
    return

  session.readyResolved = true
  session.resolveReady?.()
}

function sendRealtimeJsonToSession(session: RealtimeSessionState | undefined, payload: Record<string, unknown>) {
  const socket = session?.socket
  if (!socket || socket.readyState !== WebSocket.OPEN)
    throw new Error('Qwen Omni realtime session is not open')

  socket.send(JSON.stringify({
    event_id: `event_${Date.now()}_${realtimeEventId += 1}`,
    ...payload,
  }))
}

function sendRealtimeJson(payload: Record<string, unknown>) {
  sendRealtimeJsonToSession(realtimeSession, payload)
}

function configureRealtimeSession(session: RealtimeSessionState, config: QwenOmniConfig, instructions?: string) {
  sendRealtimeJsonToSession(session, {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      voice: config.voice,
      instructions: instructions?.trim() || DEFAULT_INSTRUCTIONS,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      input_audio_transcription: {
        model: config.inputTranscriptionModel,
      },
      turn_detection: {
        type: 'server_vad',
        threshold: config.vadThreshold,
        prefix_padding_ms: config.vadPrefixPaddingMs,
        silence_duration_ms: config.vadSilenceDurationMs,
      },
    },
  })
}

function handleRealtimeMessage(session: RealtimeSessionState, data: WebSocket.RawData) {
  if (session !== realtimeSession)
    return

  const text = typeof data === 'string' ? data : data.toString('utf8')
  const record = safeJsonParse(text)
  if (!record)
    return

  const event = parseQwenOmniRealtimeProviderEvent(record)
  if (!event) {
    const type = typeof record.type === 'string' ? record.type : undefined
    if (!type || !QUIET_REALTIME_EVENTS.has(type)) {
      console.info('[qwen-omni] unhandled realtime event', {
        type,
        keys: Object.keys(record),
      })
    }
    return
  }

  if (event.type === 'session-updated')
    resolveReadyForSession(session)
  if (event.type === 'session-created')
    resolveReadyForSession(session)
  if (event.type === 'error')
    session.rejectReady?.(new Error(event.message))

  emitRealtimeForSession(session, event)
}

async function closeRealtimeSession() {
  const session = realtimeSession
  realtimeSession = undefined

  if (!session?.socket)
    return

  if (session.socket.readyState === WebSocket.OPEN) {
    session.socket.close(1000, 'Closed by AIRI')
    return
  }

  session.socket.terminate()
}

async function startRealtimeSession(context: MainEventaContext, configInput: QwenOmniConfig, instructions?: string) {
  if (realtimeSession?.readyResolved && realtimeSession.socket?.readyState === WebSocket.OPEN)
    return

  if (realtimeStartPromise)
    return await realtimeStartPromise

  realtimeStartPromise = startRealtimeSessionInner(context, configInput, instructions)
  try {
    await realtimeStartPromise
  }
  finally {
    realtimeStartPromise = undefined
  }
}

async function startRealtimeSessionInner(context: MainEventaContext, configInput: QwenOmniConfig, instructions?: string) {
  const config = normalizeQwenOmniConfig(configInput)
  if (!config.apiKey)
    throw new Error('DashScope API key is required for Qwen Omni realtime mode')

  await closeRealtimeSession()

  const endpoints = resolveQwenOmniEndpoints(config.region)
  const state: RealtimeSessionState = {
    context,
    readyResolved: false,
    audioAppended: false,
  }
  createReadyPromise(state)
  realtimeSession = state

  const realtimeUrl = `${endpoints.realtimeUrl}?model=${encodeURIComponent(config.realtimeModel)}`
  console.info('[qwen-omni] opening realtime socket', {
    region: config.region,
    model: config.realtimeModel,
    voice: config.voice,
  })

  const socket = new WebSocket(realtimeUrl, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    handshakeTimeout: 10000,
  })
  state.socket = socket

  socket.on('open', () => {
    console.info('[qwen-omni] realtime socket open')
    try {
      configureRealtimeSession(state, config, instructions)
    }
    catch (error) {
      state.rejectReady?.(error instanceof Error ? error : new Error(errorMessageFrom(error) ?? String(error)))
    }
  })

  socket.on('message', data => handleRealtimeMessage(state, data))

  socket.on('error', (error) => {
    const message = errorMessageFrom(error) ?? 'Qwen Omni realtime socket failed'
    console.error('[qwen-omni] realtime socket error', message)
    state.rejectReady?.(new Error(message))
    emitRealtimeForSession(state, { type: 'error', message, fatal: true })
  })

  socket.on('unexpected-response', (_request, response) => {
    const message = `Qwen Omni realtime socket handshake failed (${response.statusCode} ${response.statusMessage ?? ''})`
    console.error('[qwen-omni] realtime socket unexpected response', message)
    state.rejectReady?.(new Error(message))
    emitRealtimeForSession(state, { type: 'error', message, fatal: true })
  })

  socket.on('close', (code, reason) => {
    if (realtimeSession !== state)
      return

    const closeMessage = `Qwen Omni realtime socket closed (${code})${reason.length ? `: ${reason.toString()}` : ''}`
    console.warn('[qwen-omni] realtime socket closed', closeMessage)
    state.rejectReady?.(new Error(closeMessage))
    if (code !== 1000) {
      emitRealtimeForSession(state, {
        type: 'error',
        message: closeMessage,
        fatal: false,
      })
    }
    realtimeSession = undefined
  })

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Timed out waiting for Qwen Omni realtime session')), 10000)
  })

  try {
    await Promise.race([state.ready, timeout])
  }
  catch (error) {
    if (realtimeSession === state)
      await closeRealtimeSession()
    else if (state.socket?.readyState === WebSocket.OPEN)
      state.socket.close(1000, 'Closed by AIRI')
    else
      state.socket?.terminate()
    throw error
  }
}

function appendRealtimeAudio(pcm16: Uint8Array) {
  if (pcm16.byteLength === 0)
    return

  if (!realtimeSession)
    throw new Error('Qwen Omni realtime session is not open')

  realtimeSession.audioAppended = true
  sendRealtimeJson({
    type: 'input_audio_buffer.append',
    audio: Buffer.from(pcm16).toString('base64'),
  })
}

function appendRealtimeImage(imageBase64: string) {
  if (!realtimeSession?.audioAppended) {
    emitRealtimeForSession(realtimeSession, {
      type: 'debug',
      message: 'Skipped realtime image append before the first audio chunk; DashScope rejects image-before-audio turns.',
    })
    return
  }

  sendRealtimeJson({
    type: 'input_image_buffer.append',
    image: imageBase64,
  })
}

function sendRealtimeText(text: string) {
  const trimmed = text.trim()
  if (!trimmed)
    return

  sendRealtimeJson({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: trimmed,
        },
      ],
    },
  })
  sendRealtimeJson({
    type: 'response.create',
    response: {
      modalities: ['text', 'audio'],
    },
  })
}

function cancelRealtimeResponse() {
  try {
    sendRealtimeJson({ type: 'response.cancel' })
  }
  catch {
    // If the provider has no active response, cancel is best-effort.
  }
}

function compatibleContentFromResponse(response: CompatibleChatResponse): string {
  if (response.error?.message)
    throw new Error(response.error.message)

  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string')
    return content

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as Record<string, unknown>).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    }).join('')
  }

  throw new Error('Qwen response did not contain assistant content')
}

async function callQwenCompatible(configInput: QwenOmniConfig, messages: CompatibleChatMessage[]): Promise<string> {
  const config = normalizeQwenOmniConfig(configInput)
  if (!config.apiKey)
    throw new Error('DashScope API key is required for Qwen Omni HTTP mode')

  const endpoints = resolveQwenOmniEndpoints(config.region)
  const response = await fetch(`${endpoints.compatibleBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.httpModel,
      messages,
      temperature: 0.2,
    }),
  })

  const body = await response.json() as CompatibleChatResponse
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Qwen compatible HTTP request failed with ${response.status}`)
  }

  return compatibleContentFromResponse(body)
}

async function generatePrototype(payload: QwenOmniPrototypeRequestPayload): Promise<QwenOmniPrototypeResult> {
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: PROTOTYPE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            payload.prompt,
            'Generate a usable prototype from the visible sketch or screen. Prefer simple, inspectable HTML/CSS.',
          ].join('\n\n'),
        },
        {
          type: 'image_url',
          image_url: { url: payload.imageDataUrl },
        },
      ],
    },
  ])

  return parseQwenOmniPrototypeResponse(content)
}

async function draftEmail(payload: QwenOmniEmailDraftRequestPayload): Promise<QwenOmniEmailDraftResult> {
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: EMAIL_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            payload.prompt,
            'Read the visible Gmail/email context and draft a reply for the currently focused reply box.',
          ].join('\n\n'),
        },
        {
          type: 'image_url',
          image_url: { url: payload.imageDataUrl },
        },
      ],
    },
  ])

  return parseQwenOmniEmailDraftResponse(content)
}

async function createGmailDraft(payload: QwenOmniGmailDraftRequestPayload): Promise<QwenOmniGmailDraftResult> {
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: [GMAIL_DRAFT_SYSTEM_PROMPT, localRuntimeContext()].join('\n\n') },
    {
      role: 'user',
      content: [
        payload.prompt,
        'Create a Gmail draft from this request. Do not send it.',
      ].join('\n\n'),
    },
  ])

  const plan = parseQwenOmniGmailDraftPlanResponse(content)
  const missing = uniqueNonEmpty([
    ...plan.missing,
    plan.to.length ? undefined : 'recipient email',
    plan.subject ? undefined : 'subject',
    plan.body ? undefined : 'body',
  ])

  if (missing.length > 0) {
    return {
      ...plan,
      missing,
      ok: false,
      summary: plan.summary || `还需要补充：${missing.join('、')}`,
      error: `Missing required Gmail draft fields: ${missing.join(', ')}`,
    }
  }

  const args = [
    ...gogBaseArgs(payload.account),
    '--gmail-no-send',
    'gmail',
    'drafts',
    'create',
    '--to',
    plan.to.join(','),
    ...(plan.cc.length ? ['--cc', plan.cc.join(',')] : []),
    ...(plan.bcc.length ? ['--bcc', plan.bcc.join(',')] : []),
    '--subject',
    plan.subject,
    '--body',
    plan.body,
  ]
  console.info('[qwen-omni:gog] creating Gmail draft', {
    recipients: plan.to.length,
    hasCc: plan.cc.length > 0,
    hasBcc: plan.bcc.length > 0,
    subject: plan.subject,
  })
  const { stdout, stderr } = await runGog(args)
  const parsed = safeJsonParseUnknown(stdout)

  return {
    ...plan,
    ok: true,
    missing: [],
    draftId: findNestedStringField(parsed, ['id', 'draftId', 'draft_id', 'messageId', 'message_id']),
    webUrl: findNestedStringField(parsed, ['webUrl', 'web_url', 'url', 'link']),
    raw: clippedRawOutput(stdout, stderr),
  }
}

async function createCalendarEvent(payload: QwenOmniCalendarEventRequestPayload): Promise<QwenOmniCalendarEventResult> {
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: [CALENDAR_EVENT_SYSTEM_PROMPT, localRuntimeContext()].join('\n\n') },
    {
      role: 'user',
      content: [
        payload.prompt,
        'Create a Google Calendar event from this request. Do not email attendees unless the CLI explicitly does so; the app will pass send-updates=none.',
      ].join('\n\n'),
    },
  ])

  const plan = parseQwenOmniCalendarEventPlanResponse(content)
  const missing = uniqueNonEmpty([
    ...plan.missing,
    plan.title ? undefined : 'title',
    plan.from ? undefined : 'from',
    plan.to ? undefined : 'to',
  ])
  const calendarId = payload.calendarId?.trim() || DEFAULT_CALENDAR_ID
  const dryRun = payload.dryRun ?? /预览|先看看|dry[- ]?run|不要创建|别创建/i.test(payload.prompt)

  if (missing.length > 0) {
    return {
      ...plan,
      calendarId,
      dryRun,
      missing,
      ok: false,
      summary: plan.summary || `还需要补充：${missing.join('、')}`,
      error: `Missing required calendar fields: ${missing.join(', ')}`,
    }
  }

  const args = [
    ...gogBaseArgs(payload.account),
    'calendar',
    'create',
    calendarId,
    '--summary',
    plan.title,
    '--from',
    plan.from,
    '--to',
    plan.to,
    ...(plan.timezone ? ['--start-timezone', plan.timezone, '--end-timezone', plan.timezone] : []),
    '--send-updates',
    'none',
    ...(plan.description ? ['--description', plan.description] : []),
    ...(plan.location ? ['--location', plan.location] : []),
    ...(plan.attendees.length ? ['--attendees', plan.attendees.join(',')] : []),
    ...(plan.withMeet ? ['--with-meet'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]
  console.info('[qwen-omni:gog] creating calendar event', {
    calendarId,
    title: plan.title,
    from: plan.from,
    to: plan.to,
    dryRun,
  })
  const { stdout, stderr } = await runGog(args)
  const parsed = safeJsonParseUnknown(stdout)

  return {
    ...plan,
    calendarId,
    dryRun,
    ok: true,
    missing: [],
    eventId: findNestedStringField(parsed, ['id', 'eventId', 'event_id']),
    htmlLink: findNestedStringField(parsed, ['htmlLink', 'html_link', 'link', 'url']),
    raw: clippedRawOutput(stdout, stderr),
  }
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function dateTimeFromGogDate(value: unknown): { value?: string, timezone?: string } {
  if (!value || typeof value !== 'object')
    return {}

  const record = value as Record<string, unknown>
  return {
    value: stringFromUnknown(record.dateTime) ?? stringFromUnknown(record.date),
    timezone: stringFromUnknown(record.timeZone),
  }
}

function calendarEventContextFromGogRecord(record: Record<string, unknown>, calendarId: string): QwenOmniCalendarEventContext | undefined {
  const eventId = stringFromUnknown(record.id) ?? stringFromUnknown(record.eventId) ?? stringFromUnknown(record.event_id)
  const title = stringFromUnknown(record.summary) ?? stringFromUnknown(record.title)
  if (!eventId || !title)
    return undefined

  const start = dateTimeFromGogDate(record.start)
  const end = dateTimeFromGogDate(record.end)

  return {
    calendarId,
    eventId,
    title,
    from: start.value,
    to: end.value,
    timezone: start.timezone ?? end.timezone,
    location: stringFromUnknown(record.location),
    description: stringFromUnknown(record.description),
    htmlLink: stringFromUnknown(record.htmlLink) ?? stringFromUnknown(record.html_link) ?? stringFromUnknown(record.link),
  }
}

function gogCalendarEventRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))

  if (!value || typeof value !== 'object')
    return []

  const record = value as Record<string, unknown>
  const nested = record.items ?? record.events ?? record.results
  return gogCalendarEventRecords(nested)
}

function dedupeCalendarCandidates(candidates: QwenOmniCalendarEventContext[]): QwenOmniCalendarEventContext[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.calendarId}:${candidate.eventId}`
    if (seen.has(key))
      return false

    seen.add(key)
    return true
  })
}

async function listCalendarActionCandidates(payload: { account?: string, calendarId?: string, recentEvent?: QwenOmniCalendarEventContext }): Promise<QwenOmniCalendarEventContext[]> {
  const calendarId = payload.calendarId?.trim() || payload.recentEvent?.calendarId || DEFAULT_CALENDAR_ID
  const candidates = payload.recentEvent ? [payload.recentEvent] : []

  try {
    const { stdout } = await runGog([
      ...gogBaseArgs(payload.account),
      'calendar',
      'events',
      calendarId,
      '--from',
      'today',
      '--days',
      '14',
      '--max',
      '20',
    ])
    const parsed = safeJsonParseUnknown(stdout)
    candidates.push(...gogCalendarEventRecords(parsed)
      .map(record => calendarEventContextFromGogRecord(record, calendarId))
      .filter((candidate): candidate is QwenOmniCalendarEventContext => Boolean(candidate)))
  }
  catch (error) {
    if (!payload.recentEvent)
      throw error
  }

  return dedupeCalendarCandidates(candidates)
}

function simpleTitleReplacementFromPrompt(prompt: string, event?: QwenOmniCalendarEventContext): string | undefined {
  if (!event?.title)
    return undefined

  const startIndexes = ['把', '将']
    .map(marker => prompt.indexOf(marker))
    .filter(index => index >= 0)
  const startIndex = startIndexes.length ? Math.min(...startIndexes) : -1
  const text = startIndex >= 0 ? prompt.slice(startIndex + 1) : prompt
  const operators = ['改成', '改为', '换成', '换为']
    .map(marker => ({ marker, index: text.indexOf(marker) }))
    .filter(item => item.index > 0)
    .sort((a, b) => a.index - b.index)
  const operator = operators[0]
  if (!operator)
    return undefined

  const from = text.slice(0, operator.index).trim()
  const to = text
    .slice(operator.index + operator.marker.length)
    .trim()
    .replace(/^人名\s*/, '')
    .split(/[，,。.!?！？]/)[0]
    ?.trim()
  if (!from || !to)
    return undefined

  if (event.title.includes(from))
    return event.title.replaceAll(from, to)

  const compactTitle = event.title.replace(/\s+/g, '')
  const compactFrom = from.replace(/\s+/g, '')
  if (!compactFrom || !compactTitle.includes(compactFrom))
    return undefined

  return compactTitle.replaceAll(compactFrom, to)
}

async function updateCalendarEvent(payload: QwenOmniCalendarEventUpdateRequestPayload): Promise<QwenOmniCalendarEventUpdateResult> {
  const candidates = await listCalendarActionCandidates(payload)
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: [CALENDAR_EVENT_UPDATE_SYSTEM_PROMPT, localRuntimeContext()].join('\n\n') },
    {
      role: 'user',
      content: [
        payload.prompt,
        `Default calendarId: ${payload.calendarId?.trim() || DEFAULT_CALENDAR_ID}`,
        `recentEvent: ${JSON.stringify(payload.recentEvent ?? null)}`,
        `candidateEvents: ${JSON.stringify(candidates)}`,
        'Update exactly one Google Calendar event. Do not send attendee notifications; the app will pass send-updates=none.',
      ].join('\n\n'),
    },
  ])

  const parsedPlan = parseQwenOmniCalendarEventUpdatePlanResponse(content)
  const calendarId = parsedPlan.calendarId || payload.recentEvent?.calendarId || payload.calendarId?.trim() || DEFAULT_CALENDAR_ID
  const target = candidates.find(candidate => candidate.calendarId === calendarId && candidate.eventId === parsedPlan.eventId)
    ?? payload.recentEvent
  const title = parsedPlan.title ?? simpleTitleReplacementFromPrompt(payload.prompt, target)
  const plan = {
    ...parsedPlan,
    calendarId,
    eventId: parsedPlan.eventId || payload.recentEvent?.eventId || '',
    title,
  }
  const dryRun = payload.dryRun ?? /预览|先看看|dry[- ]?run|不要修改|别修改/i.test(payload.prompt)
  const hasUpdates = Boolean(
    plan.title
    || plan.from
    || plan.to
    || plan.location
    || plan.description
    || plan.attendees.length
    || plan.addAttendees.length
    || plan.withMeet,
  )
  const missing = uniqueNonEmpty([
    ...plan.missing,
    plan.eventId ? undefined : 'target event',
    hasUpdates ? undefined : 'update field',
  ])

  if (missing.length > 0) {
    return {
      ...plan,
      dryRun,
      missing,
      ok: false,
      summary: plan.summary || `还需要补充：${missing.join('、')}`,
      error: `Missing required calendar update fields: ${missing.join(', ')}`,
    }
  }

  const args = [
    ...gogBaseArgs(payload.account),
    ...(dryRun ? ['--dry-run'] : []),
    'calendar',
    'update',
    plan.calendarId,
    plan.eventId,
    '--send-updates',
    'none',
    ...(plan.title ? ['--summary', plan.title] : []),
    ...(plan.from ? ['--from', plan.from] : []),
    ...(plan.to ? ['--to', plan.to] : []),
    ...(plan.timezone ? ['--start-timezone', plan.timezone, '--end-timezone', plan.timezone] : []),
    ...(plan.description ? ['--description', plan.description] : []),
    ...(plan.location ? ['--location', plan.location] : []),
    ...(plan.attendees.length ? ['--attendees', plan.attendees.join(',')] : []),
    ...(plan.addAttendees.length ? ['--add-attendee', plan.addAttendees.join(',')] : []),
    ...(plan.withMeet ? ['--with-meet'] : []),
  ]
  console.info('[qwen-omni:gog] updating calendar event', {
    calendarId: plan.calendarId,
    eventId: plan.eventId,
    title: plan.title,
    dryRun,
  })
  const { stdout, stderr } = await runGog(args)
  const parsed = safeJsonParseUnknown(stdout)

  return {
    ...plan,
    ok: true,
    dryRun,
    missing: [],
    htmlLink: findNestedStringField(parsed, ['htmlLink', 'html_link', 'link', 'url']) ?? target?.htmlLink,
    raw: clippedRawOutput(stdout, stderr),
  }
}

function localHourFromDateTime(value?: string): number | undefined {
  if (!value)
    return undefined

  const match = value.match(/T(\d{2}):/)
  const hour = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN
  return Number.isFinite(hour) ? hour : undefined
}

function requestedHourFromPrompt(prompt: string): number | undefined {
  const numericMatch = prompt.match(/(\d{1,2})\s*(?:点|:)/)
  let hour = numericMatch?.[1] ? Number.parseInt(numericMatch[1], 10) : Number.NaN

  if (!Number.isFinite(hour)) {
    const chineseHourMap: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12,
    }
    const chineseMatch = prompt.match(/(十[一二]?|[一二两三四五六七八九])\s*点/)
    hour = chineseMatch?.[1] ? chineseHourMap[chineseMatch[1]] ?? Number.NaN : Number.NaN
  }

  if (!Number.isFinite(hour))
    return undefined

  if (/下午|晚上|今晚/.test(prompt) && hour >= 1 && hour <= 11)
    return hour + 12
  if (/中午/.test(prompt) && hour >= 1 && hour <= 10)
    return hour + 12

  return hour
}

function deterministicDeleteCandidate(prompt: string, candidates: QwenOmniCalendarEventContext[]): QwenOmniCalendarEventContext | undefined {
  const requestedHour = requestedHourFromPrompt(prompt)
  if (requestedHour === undefined)
    return undefined

  const timeMatches = candidates.filter(candidate => localHourFromDateTime(candidate.from) === requestedHour)
  return timeMatches.length === 1 ? timeMatches[0] : undefined
}

async function deleteCalendarEvent(payload: QwenOmniCalendarEventDeleteRequestPayload): Promise<QwenOmniCalendarEventDeleteResult> {
  const candidates = await listCalendarActionCandidates(payload)
  const content = await callQwenCompatible(payload.config, [
    { role: 'system', content: [CALENDAR_EVENT_DELETE_SYSTEM_PROMPT, localRuntimeContext()].join('\n\n') },
    {
      role: 'user',
      content: [
        payload.prompt,
        `Default calendarId: ${payload.calendarId?.trim() || DEFAULT_CALENDAR_ID}`,
        `recentEvent: ${JSON.stringify(payload.recentEvent ?? null)}`,
        `candidateEvents: ${JSON.stringify(candidates)}`,
        'Delete exactly one Google Calendar event. Do not send attendee notifications; the app will pass send-updates=none.',
      ].join('\n\n'),
    },
  ])

  const parsedPlan = parseQwenOmniCalendarEventDeletePlanResponse(content)
  const deterministicTarget = deterministicDeleteCandidate(payload.prompt, candidates)
  const calendarId = parsedPlan.calendarId || deterministicTarget?.calendarId || payload.calendarId?.trim() || DEFAULT_CALENDAR_ID
  const target = candidates.find(candidate => candidate.calendarId === calendarId && candidate.eventId === parsedPlan.eventId)
    ?? deterministicTarget
  const plan = {
    ...parsedPlan,
    calendarId,
    eventId: parsedPlan.eventId || target?.eventId || '',
    title: parsedPlan.title || target?.title || '',
    from: parsedPlan.from || target?.from,
    to: parsedPlan.to || target?.to,
  }
  const dryRun = payload.dryRun ?? /预览|先看看|dry[- ]?run|不要删除|别删除/i.test(payload.prompt)
  const missing = uniqueNonEmpty([
    ...plan.missing,
    plan.eventId ? undefined : 'target event',
  ])

  if (missing.length > 0) {
    return {
      ...plan,
      dryRun,
      missing,
      ok: false,
      summary: plan.summary || `我还需要你补充要删除的是哪个日程。`,
      error: `Missing required calendar delete fields: ${missing.join(', ')}`,
    }
  }

  const args = [
    ...gogBaseArgs(payload.account),
    ...(dryRun ? ['--dry-run'] : []),
    '--force',
    'calendar',
    'delete',
    plan.calendarId,
    plan.eventId,
    '--send-updates',
    'none',
  ]
  console.info('[qwen-omni:gog] deleting calendar event', {
    calendarId: plan.calendarId,
    eventId: plan.eventId,
    title: plan.title,
    dryRun,
  })
  const { stdout, stderr } = await runGog(args)

  return {
    ...plan,
    ok: true,
    dryRun,
    missing: [],
    raw: clippedRawOutput(stdout, stderr),
  }
}

function pasteWithCommandV(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function pasteTextIntoFocusedInput(text: string) {
  clipboard.writeText(text)

  if (!isMacOS) {
    return {
      ok: false,
      error: 'Automatic paste is currently implemented for macOS only. The draft was copied to clipboard.',
    }
  }

  try {
    await pasteWithCommandV()
    return { ok: true }
  }
  catch (error) {
    return {
      ok: false,
      error: `${errorMessageFrom(error) ?? 'Failed to paste with Cmd+V'}. The draft was copied to clipboard; check macOS Accessibility permission for AIRI.`,
    }
  }
}

export function createQwenOmniService(params: { context: MainEventaContext }) {
  defineInvokeHandler(params.context, qwenOmniRealtimeStart, payload => startRealtimeSession(params.context, payload.config, payload.instructions))
  defineInvokeHandler(params.context, qwenOmniRealtimeAppendAudio, (payload) => {
    appendRealtimeAudio(payload.pcm16)
  })
  defineInvokeHandler(params.context, qwenOmniRealtimeAppendImage, (payload) => {
    appendRealtimeImage(payload.imageBase64)
  })
  defineInvokeHandler(params.context, qwenOmniRealtimeSendText, (payload) => {
    sendRealtimeText(payload.text)
  })
  defineInvokeHandler(params.context, qwenOmniRealtimeCancel, () => {
    cancelRealtimeResponse()
  })
  defineInvokeHandler(params.context, qwenOmniRealtimeClose, () => closeRealtimeSession())
  defineInvokeHandler(params.context, qwenOmniGeneratePrototype, payload => generatePrototype(payload))
  defineInvokeHandler(params.context, qwenOmniDraftEmail, payload => draftEmail(payload))
  defineInvokeHandler(params.context, qwenOmniCreateGmailDraft, payload => createGmailDraft(payload))
  defineInvokeHandler(params.context, qwenOmniCreateCalendarEvent, payload => createCalendarEvent(payload))
  defineInvokeHandler(params.context, qwenOmniUpdateCalendarEvent, payload => updateCalendarEvent(payload))
  defineInvokeHandler(params.context, qwenOmniDeleteCalendarEvent, payload => deleteCalendarEvent(payload))
  defineInvokeHandler(params.context, qwenOmniPasteText, payload => pasteTextIntoFocusedInput(payload.text))
}
