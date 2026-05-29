import type { QwenOmniRealtimeEvent } from '@proj-airi/stage-shared'
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
    }
    catch (error) {
      appendErrorNotice(errorMessageFrom(error) ?? 'Email draft generation failed')
    }
    finally {
      processingCommand.value = false
    }
  }

  async function handleDemoCommand(text: string) {
    const command = routeQwenOmniCommand(text)
    if (command === 'prototype') {
      await handlePrototypeCommand(text)
      return true
    }

    if (command === 'email') {
      await handleEmailCommand(text)
      return true
    }

    return false
  }

  async function handleInputTranscript(text: string) {
    const finalText = text.trim()
    if (!finalText)
      return

    appendHistoryMessage(userMessage(finalText))
    try {
      postCaption({ type: 'caption-speaker', text: finalText })
    }
    catch {}

    await handleDemoCommand(finalText)
  }

  function handleTextDelta(text: string) {
    if (!text)
      return

    if (!chatOrchestrator.sending) {
      chatOrchestrator.sending = true
      chatStream.beginStream()
    }

    chatStream.appendStreamLiteral(text)
    try {
      postCaption({ type: 'caption-assistant', text })
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
        stopPlayback()
        void cancelRealtime()
        return
      case 'input-transcript':
        void handleInputTranscript(event.text)
        return
      case 'response-created':
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
        chatStream.finalizeStream()
        chatOrchestrator.sending = false
        return
      case 'error':
        lastError.value = event.message
        sessionActive.value = false
        connecting.value = false
        if (event.fatal)
          appendErrorNotice(event.message)
        chatOrchestrator.sending = false
        break
      case 'debug':
      case 'speech-stopped':
        break
      case 'input-transcript-delta':
        try {
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
