import type {
  QwenOmniCalendarEventContext,
  QwenOmniCalendarEventDeleteResult,
  QwenOmniCalendarEventResult,
  QwenOmniCalendarEventUpdateResult,
  QwenOmniCommandKind,
  QwenOmniRealtimeEvent,
} from '@proj-airi/stage-shared'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { routeQwenOmniCommand } from '@proj-airi/stage-shared'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useQwenOmniStore as useQwenOmniConfigStore } from '@proj-airi/stage-ui/stores/modules/qwen-omni'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

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
import { calculatePcm16Rms, pcm16BytesToFloat32, schedulePcmChunk } from '../libs/qwen-omni/pcm-playback'

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

  const sessionActive = ref(false)
  const connecting = ref(false)
  const processingCommand = ref(false)
  const lastError = ref('')

  let eventsInitialized = false
  let input: QwenAudioInput | undefined
  let outputAudioContext: AudioContext | undefined
  let queuedUntil = 0
  const activeOutputSources = new Set<AudioBufferSourceNode>()
  let realtimeStartPromise: Promise<void> | undefined
  let handlers: QwenOmniDemoHandlers = {}
  let commandOverrideActive = false
  let pendingInputTranscript = ''
  let pendingInputTranscriptPreview = ''
  let pendingCommandTimer: ReturnType<typeof setTimeout> | undefined
  let lastHandledCommandKey = ''
  let commandOverrideTimer: ReturnType<typeof setTimeout> | undefined
  let voiceConfirmationActive = false
  let voiceConfirmationTimer: ReturnType<typeof setTimeout> | undefined
  let lastCalendarEvent: QwenOmniCalendarEventContext | undefined

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

  function hasHandledCommandText(text: string) {
    const key = normalizedCommandKey(text)
    return Boolean(
      key
      && lastHandledCommandKey
      && (key === lastHandledCommandKey || key.includes(lastHandledCommandKey) || lastHandledCommandKey.includes(key)),
    )
  }

  function clearPendingCommandTimer() {
    if (!pendingCommandTimer)
      return

    clearTimeout(pendingCommandTimer)
    pendingCommandTimer = undefined
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
    clearPendingCommandTimer()
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

  function stopPlayback() {
    activeOutputSources.forEach((source) => {
      try {
        source.stop()
      }
      catch {}
    })
    activeOutputSources.clear()
    queuedUntil = outputAudioContext?.currentTime ?? 0
    speakingStore.nowSpeaking = false
    speakingStore.mouthOpenSize = 0
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

    const schedule = schedulePcmChunk(audioContext.currentTime, queuedUntil, audioBuffer.duration)
    queuedUntil = schedule.endTime
    activeOutputSources.add(source)

    speakingStore.nowSpeaking = true
    speakingStore.mouthOpenSize = calculatePcm16Rms(bytes)

    source.addEventListener('ended', () => {
      activeOutputSources.delete(source)
      if (activeOutputSources.size === 0) {
        speakingStore.nowSpeaking = false
        speakingStore.mouthOpenSize = 0
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
  }

  async function setupInputAudio(stream: MediaStream) {
    await cleanupInputAudio()

    const audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
    await audioContext.audioWorklet.addModule(workletUrl)

    const mediaStreamSource = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0

    workletNode.port.onmessage = ({ data }: MessageEvent<{ buffer?: Float32Array }>) => {
      const buffer = data?.buffer
      if (!buffer || !sessionActive.value)
        return

      const pcm16 = float32ToInt16(buffer)
      void appendRealtimeAudio({ pcm16 }).catch((error) => {
        const message = errorMessageFrom(error) ?? 'Failed to send Qwen Omni audio'
        lastError.value = message
        if (isRealtimeSessionClosedError(message))
          sessionActive.value = false
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

  async function handleDemoCommand(text: string) {
    const command = resolveDemoCommand(text)
    if (command === 'prototype') {
      await handlePrototypeCommand(text)
      return true
    }

    if (command === 'email') {
      await handleEmailCommand(text)
      return true
    }

    if (command === 'gmail-draft') {
      await handleGmailDraftCommand(text)
      return true
    }

    if (command === 'calendar-event') {
      await handleCalendarEventCommand(text)
      return true
    }

    if (command === 'calendar-delete') {
      await handleCalendarDeleteCommand(text)
      return true
    }

    if (command === 'calendar-update') {
      await handleCalendarUpdateCommand(text)
      return true
    }

    return false
  }

  async function runTranscriptCommand(text: string) {
    const finalText = text.trim()
    if (!finalText || hasHandledCommandText(finalText))
      return

    lastHandledCommandKey = normalizedCommandKey(finalText)
    appendHistoryMessage(userMessage(finalText))
    try {
      postCaption({ type: 'caption-speaker', text: finalText })
    }
    catch {}

    await handleDemoCommand(finalText)
  }

  function scheduleTranscriptCommand(text: string, delayMs = 500) {
    const finalText = text.trim()
    if (!finalText || resolveDemoCommand(finalText) === 'chat' || hasHandledCommandText(finalText))
      return

    suppressRealtimeAssistantForCommand()
    clearPendingCommandTimer()
    pendingCommandTimer = setTimeout(() => {
      pendingCommandTimer = undefined
      void runTranscriptCommand(finalText)
    }, delayMs)
  }

  async function handleInputTranscript(text: string) {
    const finalText = text.trim()
    if (!finalText)
      return

    if (hasHandledCommandText(finalText))
      return

    if (resolveDemoCommand(finalText) !== 'chat') {
      clearPendingCommandTimer()
      suppressRealtimeAssistantForCommand()
      await runTranscriptCommand(finalText)
      return
    }

    appendHistoryMessage(userMessage(finalText))
    try {
      postCaption({ type: 'caption-speaker', text: finalText })
    }
    catch {}

    await handleDemoCommand(finalText)
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

    switch (event.type) {
      case 'session-created':
      case 'session-updated':
        lastError.value = ''
        return
      case 'speech-started':
        resetPendingInputTranscript()
        lastHandledCommandKey = ''
        clearCommandOverrideSuppression()
        clearVoiceConfirmationSuppression()
        stopPlayback()
        void cancelRealtime()
        return
      case 'speech-stopped':
        scheduleTranscriptCommand(pendingInputTranscriptPreview || pendingInputTranscript, 450)
        return
      case 'input-transcript':
        pendingInputTranscript = event.text
        pendingInputTranscriptPreview = event.text
        void handleInputTranscript(event.text)
        return
      case 'response-created':
        if (commandOverrideActive || voiceConfirmationActive)
          return

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
          return
        }

        if (commandOverrideActive) {
          clearCommandOverrideSuppression()
          chatStream.resetStream()
          chatOrchestrator.sending = false
          return
        }

        chatStream.finalizeStream()
        chatOrchestrator.sending = false
        return
      case 'error':
        clearCommandOverrideSuppression()
        clearVoiceConfirmationSuppression()
        lastError.value = event.message
        sessionActive.value = false
        connecting.value = false
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
          scheduleTranscriptCommand(pendingInputTranscriptPreview || pendingInputTranscript, 700)
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
      await startRealtime({ config: qwenConfig.toConfig() })
      sessionActive.value = true
    })()

    try {
      await realtimeStartPromise
    }
    catch (error) {
      sessionActive.value = false
      lastError.value = errorMessageFrom(error) ?? 'Failed to start Qwen Omni conversation'
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
    initialize()
    try {
      await ensureRealtimeSession()
      await setupInputAudio(stream)
    }
    catch (error) {
      lastError.value = errorMessageFrom(error) ?? 'Failed to start Qwen Omni conversation'
      throw error
    }
  }

  async function stopQwenOmniConversation() {
    sessionActive.value = false
    connecting.value = false
    commandOverrideActive = false
    clearCommandOverrideSuppression()
    resetPendingInputTranscript()
    clearVoiceConfirmationSuppression()
    stopPlayback()
    await cleanupInputAudio()
    await closeRealtime()
    chatOrchestrator.sending = false
    chatStream.resetStream()
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

  return {
    sessionActive,
    connecting,
    processingCommand,
    lastError,
    initialize,
    setDemoHandlers,
    startQwenOmniConversation,
    stopQwenOmniConversation,
    sendQwenOmniTextTurn,
    generatePrototypeFromScreen,
    draftEmailFromFocusedScreen,
    pasteTextIntoFocusedInput,
    appendQwenOmniImage,
  }
})
