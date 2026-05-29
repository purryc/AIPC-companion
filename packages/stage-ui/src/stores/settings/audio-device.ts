import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { nextTick, watch } from 'vue'

import { useAudioDevice } from '../../composables/audio'

let microphonePermissionStatus: PermissionStatus

export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const { audioInputs, deviceConstraints, selectedAudioInput: selectedAudioInputNonPersist, startStream, stopStream, stream, askPermission } = useAudioDevice()

  const selectedAudioInputPersist = useLocalStorageManualReset<string>('settings/audio/input', selectedAudioInputNonPersist.value)
  const audioInputEnabled = useLocalStorageManualReset<boolean>('settings/audio/input/enabled', false)

  watch(selectedAudioInputPersist, (newValue) => {
    selectedAudioInputNonPersist.value = newValue
  })

  function resolveDefaultAudioInput() {
    return audioInputs.value.find(input => input.deviceId === 'default')?.deviceId || audioInputs.value[0]?.deviceId || ''
  }

  function hasPersistedAudioInput() {
    return Boolean(
      selectedAudioInputPersist.value
      && audioInputs.value.some(device => device.deviceId === selectedAudioInputPersist.value),
    )
  }

  async function startEnabledInputStream() {
    if (!audioInputEnabled.value)
      return

    await askPermission()

    if (!hasPersistedAudioInput()) {
      selectedAudioInputPersist.value = resolveDefaultAudioInput()
    }

    await nextTick()
    await startStream()
  }

  watch(audioInputEnabled, (val) => {
    if (val) {
      void startEnabledInputStream().catch((error) => {
        console.error('Failed to start microphone stream:', error)
        audioInputEnabled.value = false
      })
    }
    else {
      stopStream()
    }
  })

  // permissionGranted from vueuse does not track revocation yet.
  // implement it manually.
  try {
    navigator?.permissions?.query({ name: 'microphone' }).then((status) => {
      microphonePermissionStatus = status // existing one cleaned up by GC
      status.onchange = () => {
        if (status.state === 'denied' || status.state === 'prompt')
          audioInputEnabled.value = false
      }
    })
  }
  catch (e) { console.info(`Unable to track microphone permission: ${e}`) }
  void microphonePermissionStatus // suppress unused variable lint
  async function initialize() {
    if (audioInputEnabled.value)
      await startEnabledInputStream()

    if (selectedAudioInputNonPersist.value && !audioInputEnabled.value) {
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
    }
  }

  function resetState() {
    selectedAudioInputPersist.reset()
    selectedAudioInputNonPersist.value = ''
    audioInputEnabled.reset()
    stopStream()
  }

  return {
    audioInputs,
    deviceConstraints,
    selectedAudioInput: selectedAudioInputPersist,
    enabled: audioInputEnabled,

    stream,

    initialize,

    askPermission,
    startStream,
    stopStream,
    resetState,
  }
})
