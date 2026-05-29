import type { QwenOmniConfig, QwenOmniConversationMode, QwenOmniRegion } from '@proj-airi/stage-shared'

import { normalizeQwenOmniConfig, QWEN_OMNI_DEFAULT_CONFIG } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export const useQwenOmniStore = defineStore('qwen-omni', () => {
  const conversationMode = useLocalStorageManualReset<QwenOmniConversationMode>('settings/qwen-omni/conversation-mode', 'classic')
  const apiKey = useLocalStorageManualReset<string>('settings/qwen-omni/api-key', '')
  const region = useLocalStorageManualReset<QwenOmniRegion>('settings/qwen-omni/region', QWEN_OMNI_DEFAULT_CONFIG.region)
  const httpModel = useLocalStorageManualReset<string>('settings/qwen-omni/http-model', QWEN_OMNI_DEFAULT_CONFIG.httpModel)
  const realtimeModel = useLocalStorageManualReset<string>('settings/qwen-omni/realtime-model', QWEN_OMNI_DEFAULT_CONFIG.realtimeModel)
  const voice = useLocalStorageManualReset<string>('settings/qwen-omni/voice', QWEN_OMNI_DEFAULT_CONFIG.voice)
  const inputTranscriptionModel = useLocalStorageManualReset<string>('settings/qwen-omni/input-transcription-model', QWEN_OMNI_DEFAULT_CONFIG.inputTranscriptionModel)
  const vadThreshold = useLocalStorageManualReset<number>('settings/qwen-omni/vad-threshold', QWEN_OMNI_DEFAULT_CONFIG.vadThreshold)
  const vadPrefixPaddingMs = useLocalStorageManualReset<number>('settings/qwen-omni/vad-prefix-padding-ms', QWEN_OMNI_DEFAULT_CONFIG.vadPrefixPaddingMs)
  const vadSilenceDurationMs = useLocalStorageManualReset<number>('settings/qwen-omni/vad-silence-duration-ms', QWEN_OMNI_DEFAULT_CONFIG.vadSilenceDurationMs)

  if (realtimeModel.value === 'qwen3.5-omni-flash-realtime')
    realtimeModel.value = QWEN_OMNI_DEFAULT_CONFIG.realtimeModel
  if (voice.value === 'Sunnybobi')
    voice.value = QWEN_OMNI_DEFAULT_CONFIG.voice

  const configured = computed(() => apiKey.value.trim().length > 0)
  const qwenOmniModeEnabled = computed(() => conversationMode.value === 'qwen-omni')

  /**
   * Builds the renderer-to-main Qwen Omni config without exposing local-storage refs.
   *
   * Use when:
   * - Electron invoke payloads need a serializable config snapshot
   * - Demo workflows need the same model and region choices as realtime voice
   *
   * Returns:
   * - A normalized, structured-clone-safe Qwen Omni config
   */
  function toConfig(): QwenOmniConfig {
    return normalizeQwenOmniConfig({
      apiKey: apiKey.value,
      region: region.value,
      httpModel: httpModel.value,
      realtimeModel: realtimeModel.value,
      voice: voice.value,
      inputTranscriptionModel: inputTranscriptionModel.value,
      vadThreshold: vadThreshold.value,
      vadPrefixPaddingMs: vadPrefixPaddingMs.value,
      vadSilenceDurationMs: vadSilenceDurationMs.value,
    })
  }

  function resetState() {
    conversationMode.reset()
    apiKey.reset()
    region.reset()
    httpModel.reset()
    realtimeModel.reset()
    voice.reset()
    inputTranscriptionModel.reset()
    vadThreshold.reset()
    vadPrefixPaddingMs.reset()
    vadSilenceDurationMs.reset()
  }

  return {
    conversationMode,
    apiKey,
    region,
    httpModel,
    realtimeModel,
    voice,
    inputTranscriptionModel,
    vadThreshold,
    vadPrefixPaddingMs,
    vadSilenceDurationMs,
    configured,
    qwenOmniModeEnabled,
    toConfig,
    resetState,
  }
})
