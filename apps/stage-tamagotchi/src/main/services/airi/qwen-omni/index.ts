import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenOmniConfig,
  QwenOmniEmailDraftRequestPayload,
  QwenOmniEmailDraftResult,
  QwenOmniPrototypeRequestPayload,
  QwenOmniPrototypeResult,
  QwenOmniRealtimeEvent,
} from '@proj-airi/stage-shared'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'

import WebSocket from 'ws'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  normalizeQwenOmniConfig,
  parseQwenOmniEmailDraftResponse,
  parseQwenOmniPrototypeResponse,
  parseQwenOmniRealtimeProviderEvent,
  resolveQwenOmniEndpoints,
} from '@proj-airi/stage-shared'
import { clipboard } from 'electron'
import { isMacOS } from 'std-env'

import {
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
  defineInvokeHandler(params.context, qwenOmniPasteText, payload => pasteTextIntoFocusedInput(payload.text))
}
