import type { Live2DLipSync } from '@proj-airi/model-driver-lipsync'
import type { Profile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type {
  QwenOmniCalendarEventContext,
  QwenOmniCalendarEventDeleteResult,
  QwenOmniCalendarEventResult,
  QwenOmniCalendarEventUpdateResult,
  QwenOmniCommandKind,
  QwenOmniRealtimeEvent,
  QwenOmniTurnId,
  QwenOmniVoiceReconcileInput,
  QwenOmniVoiceRuntimeSnapshot,
  QwenOmniVoiceState,
} from '@proj-airi/stage-shared'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { createLive2DLipSync } from '@proj-airi/model-driver-lipsync'
import { wlipsyncProfile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import {
  resolveQwenOmniVoiceReconcile,
  routeQwenOmniCommand,
  shouldRunQwenOmniCommandForFinalTranscript,
} from '@proj-airi/stage-shared'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useQwenOmniStore as useQwenOmniConfigStore } from '@proj-airi/stage-ui/stores/modules/qwen-omni'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

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
  widgetsAdd,
} from '../../shared/eventa'
import { calculatePcm16MouthFrames, pcm16BytesToFloat32, schedulePcmChunk } from '../libs/qwen-omni/pcm-playback'

type CaptionChannelEvent
  = | { type: 'caption-speaker', text: string }
    | { type: 'caption-assistant', text: string }

interface QwenAudioInput {
  audioContext: AudioContext
  mediaStreamSource: MediaStreamAudioSourceNode
  silentGain: GainNode
  workletNode: AudioWorkletNode
}

interface QwenOmniDemoHandlers {
  captureScreenFrame?: () => Promise<string | null>
}

interface ReconcileVoiceInput {
  enabled: boolean
  qwenModeEnabled: boolean
  stream?: MediaStream
  streamRevision: number
}

interface VoiceDiagnosticEntry {
  at: number
  event: string
  state: QwenOmniVoiceState
  details?: Record<string, string | number | boolean | undefined>
}

function float32ToInt16(buffer: Float32Array) {
  const output = new Int16Array(buffer.length)
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.max(-1, Math.min(1, buffer[i] ?? 0))
    output[i] = value < 0 ? value * 0x8000 : value * 0x7FFF
  }

  return new Uint8Array(output.buffer.slice(0))
}

function assistantMessage(content: string): ChatHistoryItem {
  return {
    role: 'assistant',
    content,
    slices: [{ type: 'text', text: content }],
    tool_results: [],
    createdAt: Date.now(),
  }
}

function userMessage(content: string): ChatHistoryItem {
  return {
    role: 'user',
    content,
    createdAt: Date.now(),
  }
}

function errorHistoryMessage(content: string): ChatHistoryItem {
  return {
    role: 'error',
    content,
    createdAt: Date.now(),
  }
}

function isRealtimeSessionClosedError(message: string) {
  return /realtime session is not open|session is not open|socket.*not open/i.test(message)
}

function calendarContextFromCreateResult(result: QwenOmniCalendarEventResult): QwenOmniCalendarEventContext | undefined {
  if (!result.eventId)
    return undefined

  return {
    calendarId: result.calendarId,
    eventId: result.eventId,
    title: result.title,
    from: result.from,
    to: result.to,
    timezone: result.timezone,
    location: result.location,
    description: result.description,
    htmlLink: result.htmlLink,
  }
}

export const useTamagotchiQwenOmniStore = defineStore('stage-tamagotchi:qwen-omni', () => {
  const context = useElectronEventaContext()
  const startRealtime = useElectronEventaInvoke(qwenOmniRealtimeStart)
  const appendRealtimeAudio = useElectronEventaInvoke(qwenOmniRealtimeAppendAudio)
  const appendRealtimeImage = useElectronEventaInvoke(qwenOmniRealtimeAppendImage)
  const sendRealtimeText = useElectronEventaInvoke(qwenOmniRealtimeSendText)
  const cancelRealtime = useElectronEventaInvoke(qwenOmniRealtimeCancel)
  const closeRealtime = useElectronEventaInvoke(qwenOmniRealtimeClose)
  const generatePrototype = useElectronEventaInvoke(qwenOmniGeneratePrototype)
  const draftEmail = useElectronEventaInvoke(qwenOmniDraftEmail)
  const createGmailDraft = useElectronEventaInvoke(qwenOmniCreateGmailDraft)
  const createCalendarEvent = useElectronEventaInvoke(qwenOmniCreateCalendarEvent)
  const updateCalendarEvent = useElectronEventaInvoke(qwenOmniUpdateCalendarEvent)
  const deleteCalendarEvent = useElectronEventaInvoke(qwenOmniDeleteCalendarEvent)
  const pasteText = useElectronEventaInvoke(qwenOmniPasteText)
  const addWidget = useElectronEventaInvoke(widgetsAdd)

  const qwenConfig = useQwenOmniConfigStore()
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const speakingStore = useSpeakingStore()
  const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
  const { post: postRuntimeSnapshot } = useBroadcastChannel<QwenOmniVoiceRuntimeSnapshot, QwenOmniVoiceRuntimeSnapshot>({ name: 'airi-qwen-omni-runtime' })

  const sessionActive = ref(false)
  const connecting = ref(false)
  const processingCommand = ref(false)
  const lastError = ref('')
  const voiceState = ref<QwenOmniVoiceState>('idle')
  const diagnostics = ref<VoiceDiagnosticEntry[]>([])
  const audioChunksSent = ref(0)
  const audioChunksPlayed = ref(0)
  const lastEventAt = ref(0)
  const lastResetReason = ref('')
  const desiredVoiceInput = ref<QwenOmniVoiceReconcileInput>({
    enabled: false,
    qwenModeEnabled: false,
    configured: qwenConfig.configured,
    hasStream: false,
    streamRevision: 0,
  })

  let eventsInitialized = false
  let input: QwenAudioInput | undefined
  let outputAudioContext: AudioContext | undefined
  let queuedUntil = 0
  const activeOutputSources = new Set<AudioBufferSourceNode>()
  const mouthFrameTimers = new Set<ReturnType<typeof setTimeout>>()
  let mouthFrameGeneration = 0
  let outputLipSync: Live2DLipSync | undefined
  let outputLipSyncPromise: Promise<Live2DLipSync | undefined> | undefined
  let outputLipSyncLoopId: number | undefined
  let realtimeStartPromise: Promise<void> | undefined
  let reconcileGeneration = 0
  let attachedStreamRevision = 0
  let handlers: QwenOmniDemoHandlers = {}
  let commandOverrideActive = false
  let pendingInputTranscript = ''
  let pendingInputTranscriptPreview = ''
  let commandOverrideTimer: ReturnType<typeof setTimeout> | undefined
  let voiceConfirmationActive = false
  let voiceConfirmationTimer: ReturnType<typeof setTimeout> | undefined
  let lastCalendarEvent: QwenOmniCalendarEventContext | undefined
  let lastExecutedCommandKey = ''
  let lastExecutedCommandKind: QwenOmniCommandKind = 'chat'
  let lastExecutedCommandAt = 0
  let lastExecutedCommandTurnId: QwenOmniTurnId | undefined
  let lastFinalTranscriptTurnId: QwenOmniTurnId | undefined
  let lastFinalTranscriptText = ''
  let currentTurnId: QwenOmniTurnId | undefined
  let turnSequence = 0

  const voiceSnapshot = computed<QwenOmniVoiceRuntimeSnapshot>(() => ({
    state: voiceState.value,
    enabled: desiredVoiceInput.value.enabled,
    qwenModeEnabled: desiredVoiceInput.value.qwenModeEnabled,
    configured: desiredVoiceInput.value.configured,
    hasStream: desiredVoiceInput.value.hasStream,
    streamRevision: attachedStreamRevision,
    sessionActive: sessionActive.value,
    inputAttached: Boolean(input),
    activeTurnId: currentTurnId,
    lastError: lastError.value || undefined,
    lastEventAt: lastEventAt.value || undefined,
    audioChunksSent: audioChunksSent.value,
    audioChunksPlayed: audioChunksPlayed.value,
  }))

  function appendHistoryMessage(message: ChatHistoryItem) {
    if (!chatSession.activeSessionId)
      return

    chatSession.appendSessionMessage(chatSession.activeSessionId, message)
  }

  function appendAssistantNotice(text: string) {
    appendHistoryMessage(assistantMessage(text))
    try {
      postCaption({ type: 'caption-assistant', text })
    }
    catch {}
  }

  function appendErrorNotice(message: string) {
    lastError.value = message
    appendHistoryMessage(errorHistoryMessage(message))
  }

  function logVoice(event: string, details?: VoiceDiagnosticEntry['details']) {
    const entry = {
      at: Date.now(),
      event,
      state: voiceState.value,
      details,
    }
    diagnostics.value = [entry, ...diagnostics.value].slice(0, 40)
    console.info('[qwen-omni:voice]', event, {
      state: entry.state,
      ...details,
    })
  }

  function setVoiceState(state: QwenOmniVoiceState, reason?: string) {
    if (voiceState.value === state)
      return

    voiceState.value = state
    logVoice('state', { next: state, reason })
  }

  function nextTurnId(): QwenOmniTurnId {
    turnSequence += 1
    return `turn_${Date.now()}_${turnSequence}`
  }

  function normalizedCommandKey(text: string) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim()
  }

  function resolveDemoCommand(text: string): QwenOmniCommandKind {
    const command = routeQwenOmniCommand(text)
    if (command !== 'chat')
      return command

    if (lastCalendarEvent && /删|取消|delete|remove|cancel/i.test(text))
      return 'calendar-delete'

    if (lastCalendarEvent && /改|换|更名|修改|更新|rename|update|change/i.test(text))
      return 'calendar-update'

    return command
  }

  function markCommandExecuted(text: string, command: QwenOmniCommandKind, turnId?: QwenOmniTurnId) {
    const key = normalizedCommandKey(text)
    lastExecutedCommandKey = key
    lastExecutedCommandKind = command
    lastExecutedCommandAt = Date.now()
    lastExecutedCommandTurnId = turnId
  }

  function clearVoiceConfirmationSuppression() {
    voiceConfirmationActive = false
    if (!voiceConfirmationTimer)
      return

    clearTimeout(voiceConfirmationTimer)
    voiceConfirmationTimer = undefined
  }

  function beginVoiceConfirmationSuppression() {
    clearVoiceConfirmationSuppression()
    voiceConfirmationActive = true
    voiceConfirmationTimer = setTimeout(() => {
      voiceConfirmationTimer = undefined
      voiceConfirmationActive = false
    }, 9000)
  }

  function clearCommandOverrideSuppression() {
    commandOverrideActive = false
    if (!commandOverrideTimer)
      return

    clearTimeout(commandOverrideTimer)
    commandOverrideTimer = undefined
  }

  function beginCommandOverrideSuppression() {
    clearCommandOverrideSuppression()
    commandOverrideActive = true
    commandOverrideTimer = setTimeout(() => {
      commandOverrideTimer = undefined
      commandOverrideActive = false
    }, 12000)
  }

  function resetPendingInputTranscript() {
    pendingInputTranscript = ''
    pendingInputTranscriptPreview = ''
  }

  function suppressRealtimeAssistantForCommand() {
    beginCommandOverrideSuppression()
    stopPlayback()
    chatOrchestrator.sending = false
    chatStream.resetStream()
    void cancelRealtime().catch(() => {})
  }

  async function speakCommandConfirmation(text: string) {
    const confirmation = text.trim()
    if (!confirmation || !qwenConfig.configured)
      return

    beginVoiceConfirmationSuppression()
    try {
      await ensureRealtimeSession()
      await sendRealtimeText({
        text: `请只用中文说下面这句简短确认，不要添加任何内容：${confirmation}`,
      })
    }
    catch {
      clearVoiceConfirmationSuppression()
    }
  }

  function ensureOutputAudioContext() {
    outputAudioContext ??= new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' })
    if (outputAudioContext.state === 'suspended')
      void outputAudioContext.resume()

    return outputAudioContext
  }

  function clearMouthFrames() {
    mouthFrameGeneration += 1
    mouthFrameTimers.forEach(timer => clearTimeout(timer))
    mouthFrameTimers.clear()
    speakingStore.nowSpeaking = false
    speakingStore.mouthOpenSize = 0
    speakingStore.mouthForm = 0
  }

  function scheduleMouthFrame(audioContext: AudioContext, scheduleStartTime: number, offsetSeconds: number, mouthOpen: number, mouthForm: number) {
    const generation = mouthFrameGeneration
    const delayMs = Math.max(0, Math.round((scheduleStartTime + offsetSeconds - audioContext.currentTime) * 1000))
    const timer = setTimeout(() => {
      mouthFrameTimers.delete(timer)
      if (generation !== mouthFrameGeneration)
        return

      speakingStore.nowSpeaking = true
      speakingStore.mouthOpenSize = mouthOpen
      speakingStore.mouthForm = mouthForm
    }, delayMs)

    mouthFrameTimers.add(timer)
  }

  function stopOutputLipSyncLoop() {
    if (!outputLipSyncLoopId)
      return

    cancelAnimationFrame(outputLipSyncLoopId)
    outputLipSyncLoopId = undefined
  }

  function startOutputLipSyncLoop() {
    if (outputLipSyncLoopId)
      return

    const tick = () => {
      if (!outputLipSync || activeOutputSources.size === 0) {
        stopOutputLipSyncLoop()
        return
      }

      speakingStore.nowSpeaking = true
      speakingStore.mouthOpenSize = outputLipSync.getMouthOpen()
      speakingStore.mouthForm = outputLipSync.getMouthForm()
      outputLipSyncLoopId = requestAnimationFrame(tick)
    }

    outputLipSyncLoopId = requestAnimationFrame(tick)
  }

  async function ensureOutputLipSync(audioContext: AudioContext) {
    if (outputLipSync)
      return outputLipSync

    outputLipSyncPromise ??= createLive2DLipSync(audioContext, wlipsyncProfile as Profile, {
      mouthLerpWindowMs: 70,
      mouthUpdateIntervalMs: 30,
    })
      .then((lipSync) => {
        outputLipSync = lipSync
        logVoice('output-lipsync-ready')
        return lipSync
      })
      .catch((error) => {
        logVoice('output-lipsync-error', { message: errorMessageFrom(error) ?? 'failed to initialize output lip sync' })
        outputLipSyncPromise = undefined
        return undefined
      })

    return outputLipSyncPromise
  }

  function stopPlayback() {
    const stopped = activeOutputSources.size
    stopOutputLipSyncLoop()
    clearMouthFrames()
    activeOutputSources.forEach((source) => {
      try {
        source.stop()
      }
      catch {}
    })
    activeOutputSources.clear()
    queuedUntil = outputAudioContext?.currentTime ?? 0
    if (stopped > 0)
      logVoice('playback-cancelled', { stopped })
  }

  function playPcm16(bytes: Uint8Array, sampleRate = 24000) {
    if (bytes.byteLength === 0)
      return

    const audioContext = ensureOutputAudioContext()
    const samples = pcm16BytesToFloat32(bytes)
    const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate)
    audioBuffer.copyToChannel(samples, 0)

    const source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContext.destination)
    if (outputLipSync) {
      outputLipSync.connectSource(source)
      startOutputLipSyncLoop()
    }
    else {
      void ensureOutputLipSync(audioContext).then((lipSync) => {
        if (!lipSync || !activeOutputSources.has(source))
          return

        lipSync.connectSource(source)
        startOutputLipSyncLoop()
      })
    }

    const schedule = schedulePcmChunk(audioContext.currentTime, queuedUntil, audioBuffer.duration)
    queuedUntil = schedule.endTime
    activeOutputSources.add(source)
    if (!outputLipSync) {
      calculatePcm16MouthFrames(bytes, { sampleRate }).forEach((frame) => {
        scheduleMouthFrame(audioContext, schedule.startTime, frame.startTime, frame.mouthOpen, frame.mouthForm)
      })
    }
    audioChunksPlayed.value += 1
    if (audioChunksPlayed.value === 1 || audioChunksPlayed.value % 25 === 0) {
      logVoice('audio-output', {
        chunks: audioChunksPlayed.value,
        bytes: bytes.byteLength,
        queuedMs: Math.round(Math.max(0, queuedUntil - audioContext.currentTime) * 1000),
      })
    }

    source.addEventListener('ended', () => {
      activeOutputSources.delete(source)
      if (activeOutputSources.size === 0) {
        stopOutputLipSyncLoop()
        clearMouthFrames()
      }
    }, { once: true })
    source.start(schedule.startTime)
  }

  async function cleanupInputAudio() {
    const current = input
    input = undefined
    if (!current)
      return

    current.workletNode.port.onmessage = null
    current.mediaStreamSource.disconnect()
    current.workletNode.disconnect()
    current.silentGain.disconnect()
    await current.audioContext.close()
    attachedStreamRevision = 0
    logVoice('audio-input-detached')
  }

  async function setupInputAudio(stream: MediaStream, streamRevision: number, generation: number) {
    const audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
    await audioContext.audioWorklet.addModule(workletUrl)
    logVoice('audio-worklet-loaded', { streamRevision })

    if (generation !== reconcileGeneration) {
      await audioContext.close()
      logVoice('audio-input-stale', { streamRevision })
      return false
    }

    const mediaStreamSource = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0

    await cleanupInputAudio()

    workletNode.port.onmessage = ({ data }: MessageEvent<{ buffer?: Float32Array }>) => {
      const buffer = data?.buffer
      if (!buffer || !sessionActive.value)
        return

      const pcm16 = float32ToInt16(buffer)
      audioChunksSent.value += 1
      if (audioChunksSent.value === 1 || audioChunksSent.value % 100 === 0) {
        logVoice('audio-input', {
          chunks: audioChunksSent.value,
          bytes: pcm16.byteLength,
        })
      }
      void appendRealtimeAudio({ pcm16 }).catch((error) => {
        const message = errorMessageFrom(error) ?? 'Failed to send Qwen Omni audio'
        lastError.value = message
        logVoice('audio-input-error', { message })
        if (isRealtimeSessionClosedError(message)) {
          sessionActive.value = false
          setVoiceState('error', 'audio append failed')
        }
      })
    }

    mediaStreamSource.connect(workletNode)
    workletNode.connect(silentGain)
    silentGain.connect(audioContext.destination)

    input = {
      audioContext,
      mediaStreamSource,
      silentGain,
      workletNode,
    }
    attachedStreamRevision = streamRevision
    logVoice('audio-input-attached', { streamRevision })
    return true
  }

  async function captureScreenFrame() {
    if (!handlers.captureScreenFrame)
      throw new Error('Screen capture is not ready yet')

    const imageDataUrl = await handlers.captureScreenFrame()
    if (!imageDataUrl)
      throw new Error('Failed to capture the selected screen or window')

    return imageDataUrl
  }

  async function handlePrototypeCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const imageDataUrl = await captureScreenFrame()
      const result = await generatePrototype({
        config: qwenConfig.toConfig(),
        prompt,
        imageDataUrl,
      })

      await addWidget({
        componentName: 'prototype-preview',
        componentProps: result,
        size: { cols: 4, rows: 4 },
        windowSize: { width: 860, height: 680, minWidth: 520, minHeight: 420 },
      })

      appendAssistantNotice(`我已经根据屏幕生成了一个原型预览：${result.title}${result.summary ? `。${result.summary}` : ''}`)
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Prototype generation failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  async function handleEmailCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const imageDataUrl = await captureScreenFrame()
      const result = await draftEmail({
        config: qwenConfig.toConfig(),
        prompt,
        imageDataUrl,
      })

      const pasteResult = await pasteText({ text: result.draft })
      const suffix = pasteResult.ok
        ? '我已经把草稿写到当前输入框里，没有发送。'
        : `我把草稿放进剪贴板了，但自动粘贴失败：${pasteResult.error ?? 'Unknown error'}`
      appendAssistantNotice(`${suffix}\n\n${result.summary}`)
      if (pasteResult.ok)
        void speakCommandConfirmation('草稿已写好了。')
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Email draft generation failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  async function handleGmailDraftCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const result = await createGmailDraft({
        config: qwenConfig.toConfig(),
        prompt,
      })

      if (!result.ok) {
        appendAssistantNotice(result.summary || `我还需要你补充：${result.missing.join('、')}`)
        return
      }

      appendAssistantNotice([
        `我已经在 Gmail 建好草稿，没有发送。`,
        `主题：${result.subject}`,
        `收件人：${result.to.join(', ')}`,
        result.cc.length ? `抄送：${result.cc.join(', ')}` : '',
        result.webUrl ? `链接：${result.webUrl}` : '',
      ].filter(Boolean).join('\n'))
      void speakCommandConfirmation('邮件草稿已建好。')
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Gmail draft creation failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  async function handleCalendarEventCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const result = await createCalendarEvent({
        config: qwenConfig.toConfig(),
        prompt,
      })

      if (!result.ok) {
        appendAssistantNotice(result.summary || `我还需要你补充：${result.missing.join('、')}`)
        return
      }

      lastCalendarEvent = calendarContextFromCreateResult(result) ?? lastCalendarEvent
      appendAssistantNotice([
        result.dryRun ? '我已经预览了这个日程，还没有写入 Calendar。' : '我已经把日程加到 Calendar 里了。',
        `标题：${result.title}`,
        `时间：${result.from} - ${result.to}`,
        result.location ? `地点：${result.location}` : '',
        result.attendees.length ? `参与人：${result.attendees.join(', ')}` : '',
        result.withMeet ? '已请求 Google Meet 链接。' : '',
        result.htmlLink ? `链接：${result.htmlLink}` : '',
      ].filter(Boolean).join('\n'))
      void speakCommandConfirmation(result.dryRun ? '日程预览好了。' : '日程已加到日历。')
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Calendar event creation failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  function calendarContextFromUpdateResult(result: QwenOmniCalendarEventUpdateResult): QwenOmniCalendarEventContext | undefined {
    if (!result.eventId)
      return undefined

    const previous = lastCalendarEvent?.eventId === result.eventId ? lastCalendarEvent : undefined
    return {
      calendarId: result.calendarId,
      eventId: result.eventId,
      title: result.title ?? previous?.title ?? 'Calendar event',
      from: result.from ?? previous?.from,
      to: result.to ?? previous?.to,
      timezone: result.timezone ?? previous?.timezone,
      location: result.location ?? previous?.location,
      description: result.description ?? previous?.description,
      htmlLink: result.htmlLink ?? previous?.htmlLink,
    }
  }

  async function handleCalendarUpdateCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const result = await updateCalendarEvent({
        config: qwenConfig.toConfig(),
        prompt,
        recentEvent: lastCalendarEvent,
      })

      if (!result.ok) {
        appendAssistantNotice(result.summary || `我还需要你补充：${result.missing.join('、')}`)
        return
      }

      lastCalendarEvent = calendarContextFromUpdateResult(result) ?? lastCalendarEvent
      appendAssistantNotice([
        result.dryRun ? '我已经预览了 Calendar 修改，还没有写入。' : '我已经更新 Calendar 事件。',
        result.title ? `标题：${result.title}` : '',
        result.from && result.to ? `时间：${result.from} - ${result.to}` : '',
        result.location ? `地点：${result.location}` : '',
        result.addAttendees.length ? `新增参与人：${result.addAttendees.join(', ')}` : '',
        result.attendees.length ? `参与人：${result.attendees.join(', ')}` : '',
        result.withMeet ? '已请求 Google Meet 链接。' : '',
        result.htmlLink ? `链接：${result.htmlLink}` : '',
      ].filter(Boolean).join('\n'))
      void speakCommandConfirmation(result.dryRun ? '日程修改预览好了。' : '日程已更新。')
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Calendar event update failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  function clearDeletedCalendarContext(result: QwenOmniCalendarEventDeleteResult) {
    if (lastCalendarEvent?.eventId === result.eventId)
      lastCalendarEvent = undefined
  }

  async function handleCalendarDeleteCommand(prompt: string) {
    processingCommand.value = true
    try {
      await cancelRealtime()
      const result = await deleteCalendarEvent({
        config: qwenConfig.toConfig(),
        prompt,
        recentEvent: lastCalendarEvent,
      })

      if (!result.ok) {
        appendAssistantNotice(result.summary || `我还需要你补充：${result.missing.join('、')}`)
        return
      }

      clearDeletedCalendarContext(result)
      appendAssistantNotice([
        result.dryRun ? '我已经预览了 Calendar 删除，还没有执行。' : '我已经从 Calendar 删除这个事件。',
        result.title ? `标题：${result.title}` : '',
        result.from && result.to ? `时间：${result.from} - ${result.to}` : '',
      ].filter(Boolean).join('\n'))
      void speakCommandConfirmation(result.dryRun ? '日程删除预览好了。' : '日程已删除。')
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Calendar event delete failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  async function handleDemoCommand(text: string, resolvedCommand?: QwenOmniCommandKind) {
    const command = resolvedCommand ?? resolveDemoCommand(text)
    let runCommand: (() => Promise<void>) | undefined

    if (command === 'prototype')
      runCommand = () => handlePrototypeCommand(text)
    else if (command === 'email')
      runCommand = () => handleEmailCommand(text)
    else if (command === 'gmail-draft')
      runCommand = () => handleGmailDraftCommand(text)
    else if (command === 'calendar-event')
      runCommand = () => handleCalendarEventCommand(text)
    else if (command === 'calendar-delete')
      runCommand = () => handleCalendarDeleteCommand(text)
    else if (command === 'calendar-update')
      runCommand = () => handleCalendarUpdateCommand(text)

    if (!runCommand)
      return false

    setVoiceState('command-running', command)
    try {
      await runCommand()
    }
    finally {
      if (voiceState.value === 'command-running')
        setVoiceState(sessionActive.value ? 'streaming' : 'idle', 'command finished')
    }

    return true
  }

  async function handleFinalInputTranscript(text: string, turnId?: QwenOmniTurnId) {
    const finalText = text.trim()
    if (!finalText)
      return

    if (turnId && lastFinalTranscriptTurnId === turnId)
      return

    const command = resolveDemoCommand(finalText)
    if (command !== 'chat') {
      const shouldRun = shouldRunQwenOmniCommandForFinalTranscript({
        final: true,
        text: finalText,
        command,
        turnId,
        previousTurnId: lastExecutedCommandTurnId,
        previousText: lastExecutedCommandKey,
        previousCommand: lastExecutedCommandKind,
        previousExecutedAt: lastExecutedCommandAt,
      })
      if (!shouldRun)
        return

      lastFinalTranscriptTurnId = turnId
      lastFinalTranscriptText = finalText
      markCommandExecuted(finalText, command, turnId)
      suppressRealtimeAssistantForCommand()
      appendHistoryMessage(userMessage(finalText))
      try {
        postCaption({ type: 'caption-speaker', text: finalText })
      }
      catch {}

      await handleDemoCommand(finalText, command)
      return
    }

    const finalKey = normalizedCommandKey(finalText)
    if (lastFinalTranscriptText && finalKey === normalizedCommandKey(lastFinalTranscriptText))
      return

    lastFinalTranscriptTurnId = turnId
    lastFinalTranscriptText = finalText
    appendHistoryMessage(userMessage(finalText))
    try {
      postCaption({ type: 'caption-speaker', text: finalText })
    }
    catch {}
  }

  function handleTextDelta(text: string) {
    if (commandOverrideActive || voiceConfirmationActive)
      return

    if (!text)
      return

    const currentText = typeof chatStream.streamingMessage.content === 'string'
      ? chatStream.streamingMessage.content
      : ''
    let nextText = text
    if (currentText) {
      if (text.startsWith(currentText))
        nextText = text.slice(currentText.length)
      else if (currentText.trim() === text.trim() || (text.length > 8 && currentText.endsWith(text)))
        return
    }

    if (!nextText)
      return

    if (!chatOrchestrator.sending) {
      chatOrchestrator.sending = true
      chatStream.beginStream()
    }

    chatStream.appendStreamLiteral(nextText)
    try {
      postCaption({ type: 'caption-assistant', text: nextText })
    }
    catch {}
  }

  function handleRealtimeEvent(event: QwenOmniRealtimeEvent | undefined) {
    if (!event)
      return

    lastEventAt.value = Date.now()
    if (event.type !== 'audio-delta')
      logVoice(`provider:${event.type}`)

    switch (event.type) {
      case 'session-created':
      case 'session-updated':
        lastError.value = ''
        if (sessionActive.value && voiceState.value !== 'command-running')
          setVoiceState('streaming', event.type)
        return
      case 'speech-started':
        resetPendingInputTranscript()
        currentTurnId = nextTurnId()
        clearCommandOverrideSuppression()
        clearVoiceConfirmationSuppression()
        stopPlayback()
        void cancelRealtime()
        if (sessionActive.value)
          setVoiceState('streaming', 'speech started')
        return
      case 'speech-stopped':
        logVoice('speech-stopped', {
          hasPreview: Boolean(pendingInputTranscriptPreview || pendingInputTranscript),
        })
        return
      case 'input-transcript':
        pendingInputTranscript = event.text
        pendingInputTranscriptPreview = event.text
        void handleFinalInputTranscript(event.text, event.turnId ?? currentTurnId)
        return
      case 'response-created':
        if (commandOverrideActive || voiceConfirmationActive)
          return

        setVoiceState('responding', 'response created')
        chatOrchestrator.sending = true
        chatStream.beginStream()
        return
      case 'text-delta':
        handleTextDelta(event.text)
        return
      case 'audio-delta':
        playPcm16(event.pcm16, event.sampleRate)
        return
      case 'response-done':
        if (voiceConfirmationActive) {
          clearVoiceConfirmationSuppression()
          chatStream.resetStream()
          chatOrchestrator.sending = false
          if (sessionActive.value)
            setVoiceState('streaming', 'voice confirmation done')
          return
        }

        if (commandOverrideActive) {
          clearCommandOverrideSuppression()
          chatStream.resetStream()
          chatOrchestrator.sending = false
          if (sessionActive.value)
            setVoiceState('streaming', 'command override done')
          return
        }

        chatStream.finalizeStream()
        chatOrchestrator.sending = false
        if (sessionActive.value)
          setVoiceState('streaming', 'response done')
        return
      case 'error':
        clearCommandOverrideSuppression()
        clearVoiceConfirmationSuppression()
        lastError.value = event.message
        sessionActive.value = false
        connecting.value = false
        setVoiceState('error', 'provider error')
        if (event.fatal)
          appendErrorNotice(event.message)
        chatOrchestrator.sending = false
        break
      case 'debug':
        break
      case 'input-transcript-delta':
        try {
          if (event.text)
            pendingInputTranscript += event.text
          pendingInputTranscriptPreview = `${pendingInputTranscript}${event.stash}`.trim()
          const preview = `${event.text}${event.stash}`.trim()
          if (preview)
            postCaption({ type: 'caption-speaker', text: preview })
        }
        catch {}
        break
    }
  }

  function initialize() {
    if (eventsInitialized)
      return

    eventsInitialized = true
    context.value.on(qwenOmniRealtimeEvent, (event) => {
      handleRealtimeEvent(event?.body)
    })
  }

  async function ensureRealtimeSession(options: { force?: boolean } = {}) {
    initialize()
    if (!qwenConfig.configured)
      throw new Error('Configure a DashScope API key before enabling Qwen Omni mode')

    if (!options.force && sessionActive.value)
      return

    if (realtimeStartPromise)
      return await realtimeStartPromise

    realtimeStartPromise = (async () => {
      connecting.value = true
      lastError.value = ''
      setVoiceState('connecting', options.force ? 'force reconnect' : 'connect')
      logVoice('realtime-start', { force: Boolean(options.force) })
      await startRealtime({ config: qwenConfig.toConfig() })
      sessionActive.value = true
      setVoiceState('streaming', 'realtime ready')
      logVoice('realtime-ready')
    })()

    try {
      await realtimeStartPromise
    }
    catch (error) {
      sessionActive.value = false
      lastError.value = errorMessageFrom(error) ?? 'Failed to start Qwen Omni conversation'
      setVoiceState('error', 'realtime start failed')
      logVoice('realtime-error', { message: lastError.value })
      throw error
    }
    finally {
      connecting.value = false
      realtimeStartPromise = undefined
    }
  }

  /**
   * Starts a Qwen Omni realtime conversation from the current microphone stream.
   *
   * Use when:
   * - The desktop mic toggle is enabled while Qwen Omni mode is active
   *
   * Expects:
   * - `stream` contains a live audio track
   * - The Qwen Omni settings store contains a DashScope API key
   *
   * Returns:
   * - Resolves once the DashScope realtime session has accepted its config
   */
  async function startQwenOmniConversation(stream: MediaStream) {
    await reconcileQwenOmniVoice({
      enabled: true,
      qwenModeEnabled: true,
      stream,
      streamRevision: attachedStreamRevision + 1,
    })
  }

  async function stopQwenOmniConversation() {
    await resetQwenOmniVoice('legacy stop')
  }

  async function resetQwenOmniVoice(reason: string) {
    const generation = reconcileGeneration += 1
    lastResetReason.value = reason
    sessionActive.value = false
    connecting.value = false
    commandOverrideActive = false
    setVoiceState('closing', reason)
    logVoice('reset', { reason })
    clearCommandOverrideSuppression()
    resetPendingInputTranscript()
    clearVoiceConfirmationSuppression()
    stopPlayback()
    try {
      await cleanupInputAudio()
      await closeRealtime()
    }
    finally {
      chatOrchestrator.sending = false
      chatStream.resetStream()
      if (generation === reconcileGeneration)
        setVoiceState('idle', reason)
    }
  }

  async function reconcileQwenOmniVoice(inputState: ReconcileVoiceInput) {
    initialize()
    const generation = reconcileGeneration += 1
    const nextInput: QwenOmniVoiceReconcileInput = {
      enabled: inputState.enabled,
      qwenModeEnabled: inputState.qwenModeEnabled,
      configured: qwenConfig.configured,
      hasStream: Boolean(inputState.stream),
      streamRevision: inputState.streamRevision,
    }
    desiredVoiceInput.value = nextInput

    const decision = resolveQwenOmniVoiceReconcile(voiceSnapshot.value, nextInput)
    logVoice('reconcile', {
      decision: decision.state,
      actions: decision.actions.join(',') || 'none',
      streamRevision: nextInput.streamRevision,
    })

    if (decision.actions.includes('close-realtime')) {
      await resetQwenOmniVoice(inputState.enabled ? 'mode disabled' : 'mic disabled')
      return
    }

    if (decision.actions.includes('report-missing-config')) {
      lastError.value = 'Configure a DashScope API key before enabling Qwen Omni mode'
      setVoiceState('error', 'missing config')
      return
    }

    if (decision.actions.includes('wait-for-mic')) {
      setVoiceState('acquiring-mic', 'waiting for stream')
      return
    }

    try {
      if (decision.actions.includes('connect-realtime')) {
        await ensureRealtimeSession()
        if (generation !== reconcileGeneration)
          return
      }

      if (decision.actions.includes('attach-input')) {
        if (!inputState.stream) {
          setVoiceState('acquiring-mic', 'stream missing before attach')
          return
        }

        const attached = await setupInputAudio(inputState.stream, inputState.streamRevision, generation)
        if (attached && generation === reconcileGeneration)
          setVoiceState('streaming', 'input attached')
      }
      else {
        setVoiceState(decision.state, 'reconciled')
      }
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'Failed to start Qwen Omni conversation'
      lastError.value = message
      sessionActive.value = false
      connecting.value = false
      setVoiceState('error', 'reconcile failed')
      logVoice('reconcile-error', { message })
      throw error
    }
  }

  async function sendQwenOmniTextTurn(text: string) {
    initialize()
    const finalText = text.trim()
    if (!finalText)
      return

    appendHistoryMessage(userMessage(finalText))
    if (await handleDemoCommand(finalText))
      return

    await ensureRealtimeSession()

    try {
      await sendRealtimeText({ text: finalText })
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'Failed to send Qwen Omni text'
      if (!isRealtimeSessionClosedError(message))
        throw error

      sessionActive.value = false
      await ensureRealtimeSession({ force: true })
      await sendRealtimeText({ text: finalText })
    }
  }

  async function generatePrototypeFromScreen(prompt: string) {
    await handlePrototypeCommand(prompt)
  }

  async function draftEmailFromFocusedScreen(prompt: string) {
    await handleEmailCommand(prompt)
  }

  async function pasteTextIntoFocusedInput(text: string) {
    return await pasteText({ text })
  }

  function setDemoHandlers(nextHandlers: QwenOmniDemoHandlers) {
    handlers = nextHandlers
  }

  async function appendQwenOmniImage(imageBase64: string) {
    await appendRealtimeImage({ imageBase64 })
  }

  watch(voiceSnapshot, (snapshot) => {
    try {
      postRuntimeSnapshot(snapshot)
    }
    catch {}
  }, { immediate: true })

  return {
    sessionActive,
    connecting,
    processingCommand,
    lastError,
    voiceState,
    voiceSnapshot,
    diagnostics,
    lastResetReason,
    initialize,
    setDemoHandlers,
    reconcileQwenOmniVoice,
    resetQwenOmniVoice,
    startQwenOmniConversation,
    stopQwenOmniConversation,
    sendQwenOmniTextTurn,
    generatePrototypeFromScreen,
    draftEmailFromFocusedScreen,
    pasteTextIntoFocusedInput,
    appendQwenOmniImage,
  }
})
