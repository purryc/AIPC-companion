<script setup lang="ts">
import type { DesktopContextPermissionResult, DesktopContextRequest, DesktopContextSnapshot } from '@proj-airi/stage-shared'
import type { SourcesOptions } from 'electron'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { electronDesktopContextGetSnapshot, electronDesktopContextRequestPermission } from '../../../shared/eventa'
import { useVisionScreenCapture } from '../../composables/use-vision-screen-capture'

const getDesktopContextSnapshot = useElectronEventaInvoke(electronDesktopContextGetSnapshot)
const requestDesktopContextPermission = useElectronEventaInvoke(electronDesktopContextRequestPermission)

const sourcesOptions = ref<SourcesOptions>({
  types: ['screen', 'window'],
  fetchWindowIcons: true,
})

const {
  sources,
  activeSourceId,
  activeSource,
  activeStream,
  isRefetching,
  refetchSources,
  startStream,
  cleanup,
  captureFrame,
} = useVisionScreenCapture(sourcesOptions)

const includeActiveWindow = ref(true)
const includeClipboard = ref(true)
const includeSelectedText = ref(true)
const includeMouse = ref(true)
const includeScreenFrame = ref(true)
const allowSelectedTextClipboardFallback = ref(true)

const snapshot = ref<DesktopContextSnapshot | null>(null)
const screenFrameDataUrl = ref('')
const screenFrameCapturedAt = ref(0)
const busy = ref(false)
const delayedCaptureCountdown = ref(0)
const permissionBusy = ref('')
const permissionResult = ref<DesktopContextPermissionResult | null>(null)
const errorMessage = ref('')
const videoRef = ref<HTMLVideoElement | null>(null)

let delayedCaptureTimeout: ReturnType<typeof setTimeout> | undefined
let delayedCaptureInterval: ReturnType<typeof setInterval> | undefined

function hasLiveVideoStream(stream: MediaStream | null) {
  return !!stream && stream.getVideoTracks().some(track => track.readyState === 'live')
}

function estimatedDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
  return Math.round(base64.length * 0.75)
}

function formatDate(timestamp?: number) {
  if (!timestamp)
    return 'Never'

  return new Date(timestamp).toLocaleTimeString()
}

function waitForVideoFrame(video: HTMLVideoElement) {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
    return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanupListeners()
      reject(new Error('Timed out waiting for desktop context video frame'))
    }, 3000)

    const onReady = () => {
      if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0)
        return

      cleanupListeners()
      resolve()
    }

    function cleanupListeners() {
      clearTimeout(timeout)
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('playing', onReady)
    }

    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('canplay', onReady)
    video.addEventListener('playing', onReady)
  })
}

async function captureScreenFrame() {
  if (!activeSourceId.value)
    await refetchSources()

  if (!activeSourceId.value)
    throw new Error('No screen or window source is available')

  if (!hasLiveVideoStream(activeStream.value))
    await startStream()

  const video = videoRef.value
  if (!video)
    throw new Error('Desktop context video element is not mounted')

  if (video.srcObject !== activeStream.value)
    video.srcObject = activeStream.value

  await video.play()
  await waitForVideoFrame(video)

  const frame = captureFrame(video, 0.82, 1280, 720)
  if (!frame)
    throw new Error('Failed to capture desktop context frame')

  screenFrameDataUrl.value = frame
  screenFrameCapturedAt.value = Date.now()
}

function buildDesktopContextRequest(): DesktopContextRequest {
  return {
    includeActiveWindow: includeActiveWindow.value,
    includeClipboard: includeClipboard.value,
    includeMouse: includeMouse.value,
    includeSelectedText: includeSelectedText.value,
    allowSelectedTextClipboardFallback: allowSelectedTextClipboardFallback.value,
  }
}

async function captureContextNow() {
  const [nextSnapshot] = await Promise.all([
    getDesktopContextSnapshot(buildDesktopContextRequest()),
    includeScreenFrame.value ? captureScreenFrame() : Promise.resolve(),
  ])

  snapshot.value = nextSnapshot
}

async function refreshContext() {
  busy.value = true
  errorMessage.value = ''

  try {
    await captureContextNow()
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? String(error)
  }
  finally {
    busy.value = false
  }
}

function clearDelayedCapture() {
  if (delayedCaptureTimeout) {
    clearTimeout(delayedCaptureTimeout)
    delayedCaptureTimeout = undefined
  }
  if (delayedCaptureInterval) {
    clearInterval(delayedCaptureInterval)
    delayedCaptureInterval = undefined
  }
  delayedCaptureCountdown.value = 0
}

function refreshContextAfterDelay() {
  if (busy.value)
    return

  clearDelayedCapture()
  delayedCaptureCountdown.value = 3
  errorMessage.value = ''

  delayedCaptureInterval = setInterval(() => {
    delayedCaptureCountdown.value = Math.max(delayedCaptureCountdown.value - 1, 0)
    if (delayedCaptureCountdown.value === 0 && delayedCaptureInterval) {
      clearInterval(delayedCaptureInterval)
      delayedCaptureInterval = undefined
    }
  }, 1000)

  delayedCaptureTimeout = setTimeout(async () => {
    delayedCaptureTimeout = undefined
    delayedCaptureCountdown.value = 0
    await refreshContext()
  }, 3000)
}

async function runPermissionAction(permission: DesktopContextPermissionResult['permission'], openSettings = true) {
  permissionBusy.value = permission
  errorMessage.value = ''

  try {
    permissionResult.value = await requestDesktopContextPermission({
      permission,
      openSettings,
      prompt: true,
    })
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? String(error)
  }
  finally {
    permissionBusy.value = ''
  }
}

async function refetchAndKeepSource() {
  const currentId = activeSourceId.value
  await refetchSources()
  if (currentId && sources.value.some(source => source.id === currentId))
    activeSourceId.value = currentId
}

const qwenContextPreview = computed(() => {
  const current = snapshot.value
  if (!current)
    return ''

  return JSON.stringify({
    capturedAt: current.capturedAt,
    activeWindow: current.activeWindow,
    mouse: current.mouse,
    clipboard: current.clipboard
      ? {
          ok: current.clipboard.ok,
          source: current.clipboard.source,
          length: current.clipboard.length,
          text: current.clipboard.text,
        }
      : undefined,
    selectedText: current.selectedText
      ? {
          ok: current.selectedText.ok,
          source: current.selectedText.source,
          length: current.selectedText.length,
          text: current.selectedText.text,
        }
      : undefined,
    screenFrame: screenFrameDataUrl.value
      ? {
          sourceId: activeSourceId.value,
          sourceName: activeSource.value?.name,
          capturedAt: screenFrameCapturedAt.value,
          bytesApprox: estimatedDataUrlBytes(screenFrameDataUrl.value),
        }
      : undefined,
    warnings: current.warnings,
  }, null, 2)
})

const latestPermissions = computed(() => permissionResult.value?.after ?? snapshot.value?.permissions.macOS)

async function copyPreviewJson() {
  if (!qwenContextPreview.value)
    return

  await navigator.clipboard.writeText(qwenContextPreview.value)
}

onMounted(async () => {
  await refetchSources()
})

onBeforeUnmount(() => {
  clearDelayedCapture()
  cleanup()
})
</script>

<template>
  <div class="flex flex-col gap-4 pb-12">
    <section class="border border-neutral-200 rounded-lg bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="m-0 text-xl text-neutral-900 font-semibold dark:text-neutral-100">
            Desktop Context
          </h2>
          <p class="m-0 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            One-shot context packet for screen-aware Qwen Omni workflows.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            class="h-9 flex items-center gap-2 border border-neutral-200 rounded-md bg-neutral-50 px-3 text-sm text-neutral-700 transition dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 dark:text-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-800"
            :disabled="busy || isRefetching"
            @click="refetchAndKeepSource"
          >
            <div class="i-solar:refresh-bold-duotone" />
            Sources
          </button>
          <button
            class="h-9 flex items-center gap-2 border border-primary-200 rounded-md bg-primary-50 px-3 text-sm text-primary-700 transition dark:border-primary-900 dark:bg-primary-950 hover:bg-primary-100 dark:text-primary-200 disabled:opacity-50 dark:hover:bg-primary-900"
            :disabled="busy || delayedCaptureCountdown > 0"
            @click="refreshContext"
          >
            <div class="i-solar:radar-2-bold-duotone" />
            {{ busy ? 'Reading...' : 'Refresh Context' }}
          </button>
          <button
            class="h-9 flex items-center gap-2 border border-emerald-200 rounded-md bg-emerald-50 px-3 text-sm text-emerald-700 transition dark:border-emerald-900 dark:bg-emerald-950 hover:bg-emerald-100 dark:text-emerald-200 disabled:opacity-50 dark:hover:bg-emerald-900"
            :disabled="busy"
            @click="refreshContextAfterDelay"
          >
            <div class="i-solar:timer-bold-duotone" />
            {{ delayedCaptureCountdown > 0 ? `Capturing in ${delayedCaptureCountdown}s` : 'Capture in 3s' }}
          </button>
        </div>
      </div>

      <p class="mt-3 border border-emerald-200 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        Use delayed capture for other apps: click it, then focus the target window or selected text before the countdown ends.
      </p>

      <div class="grid grid-cols-1 mt-4 gap-3 lg:grid-cols-3">
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="includeActiveWindow" type="checkbox">
          Active app/window
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="includeMouse" type="checkbox">
          Mouse position
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="includeClipboard" type="checkbox">
          Clipboard text
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="includeSelectedText" type="checkbox">
          Selected text
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="allowSelectedTextClipboardFallback" type="checkbox">
          Cmd+C fallback
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="includeScreenFrame" type="checkbox">
          Screen frame
        </label>
      </div>

      <div class="mt-4 border border-amber-200 rounded-lg bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-sm text-amber-950 font-semibold dark:text-amber-100">
              macOS permissions
            </div>
            <div class="mt-1 text-xs text-amber-800 dark:text-amber-200">
              Accessibility: {{ latestPermissions?.accessibilityTrusted ?? 'unknown' }}
              · Screen Recording: {{ latestPermissions?.screenCapture || 'unknown' }}
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="h-8 flex items-center gap-2 border border-amber-300 rounded-md bg-white px-2 text-xs text-amber-900 transition dark:border-amber-800 dark:bg-amber-950 hover:bg-amber-100 dark:text-amber-100 disabled:opacity-50 dark:hover:bg-amber-900"
              :disabled="!!permissionBusy"
              @click="runPermissionAction('accessibility', true)"
            >
              <div class="i-solar:shield-keyhole-bold-duotone" />
              {{ permissionBusy === 'accessibility' ? 'Opening...' : 'Request Accessibility' }}
            </button>
            <button
              class="h-8 flex items-center gap-2 border border-amber-300 rounded-md bg-white px-2 text-xs text-amber-900 transition dark:border-amber-800 dark:bg-amber-950 hover:bg-amber-100 dark:text-amber-100 disabled:opacity-50 dark:hover:bg-amber-900"
              :disabled="!!permissionBusy"
              @click="runPermissionAction('screen-capture', true)"
            >
              <div class="i-solar:monitor-camera-bold-duotone" />
              {{ permissionBusy === 'screen-capture' ? 'Opening...' : 'Open Screen Recording' }}
            </button>
          </div>
        </div>

        <div v-if="permissionResult" class="mt-3 rounded-md bg-white/80 p-2 text-xs text-amber-900 dark:bg-neutral-950/50 dark:text-amber-100">
          <div>
            Look for: <span class="font-semibold">{{ permissionResult.app.name }}</span>
            <span v-if="permissionResult.app.bundleName && permissionResult.app.bundleName !== permissionResult.app.name">
              or <span class="font-semibold">{{ permissionResult.app.bundleName }}</span>
            </span>
          </div>
          <div v-if="permissionResult.app.bundleIdentifier" class="mt-1 break-all">
            Bundle ID: {{ permissionResult.app.bundleIdentifier }}
          </div>
          <div v-if="permissionResult.app.bundlePath" class="mt-1 break-all">
            Bundle: {{ permissionResult.app.bundlePath }}
          </div>
          <div class="mt-1 break-all">
            Executable: {{ permissionResult.app.executablePath }}
          </div>
        </div>
      </div>

      <p v-if="errorMessage" class="mt-3 border border-red-200 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {{ errorMessage }}
      </p>
    </section>

    <section class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <div class="flex flex-col gap-4">
        <div class="border border-neutral-200 rounded-lg bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 class="m-0 text-base text-neutral-900 font-semibold dark:text-neutral-100">
            Live Inputs
          </h3>

          <div class="grid grid-cols-1 mt-3 gap-3 md:grid-cols-2">
            <div class="rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
              <div class="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                Active Window
              </div>
              <div class="mt-1 text-sm text-neutral-900 dark:text-neutral-100">
                {{ snapshot?.activeWindow?.appName || 'Unknown' }}
              </div>
              <div class="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {{ snapshot?.activeWindow?.windowTitle || snapshot?.activeWindow?.error || 'No title' }}
              </div>
            </div>

            <div class="rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
              <div class="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                Mouse
              </div>
              <div class="mt-1 text-sm text-neutral-900 dark:text-neutral-100">
                {{ snapshot?.mouse ? `${snapshot.mouse.screenPoint.x}, ${snapshot.mouse.screenPoint.y}` : 'Unknown' }}
              </div>
              <div class="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {{ snapshot?.mouse?.display?.label || 'No display match' }}
              </div>
            </div>

            <div class="rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
              <div class="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                Permissions
              </div>
              <div class="mt-1 text-sm text-neutral-900 dark:text-neutral-100">
                AX: {{ snapshot?.permissions.macOS?.accessibilityTrusted ?? 'n/a' }}
              </div>
              <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Screen: {{ snapshot?.permissions.macOS?.screenCapture || 'n/a' }}
              </div>
            </div>

            <div class="rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
              <div class="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                Last Refresh
              </div>
              <div class="mt-1 text-sm text-neutral-900 dark:text-neutral-100">
                {{ formatDate(snapshot?.capturedAt) }}
              </div>
              <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Frame: {{ formatDate(screenFrameCapturedAt) }}
              </div>
            </div>
          </div>
        </div>

        <div class="border border-neutral-200 rounded-lg bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div class="flex items-center justify-between gap-3">
            <h3 class="m-0 text-base text-neutral-900 font-semibold dark:text-neutral-100">
              Screen Frame
            </h3>
            <select
              v-model="activeSourceId"
              class="max-w-90 min-w-0 border border-neutral-200 rounded-md bg-white px-2 py-1 text-sm text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option v-for="source in sources" :key="source.id" :value="source.id">
                {{ source.name }}
              </option>
            </select>
          </div>

          <video ref="videoRef" class="hidden" muted playsinline />

          <div class="mt-3 min-h-60 flex items-center justify-center overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-900">
            <img
              v-if="screenFrameDataUrl"
              :src="screenFrameDataUrl"
              class="max-h-120 max-w-full object-contain"
              alt="Desktop context capture"
            >
            <div v-else class="text-sm text-neutral-500 dark:text-neutral-400">
              No frame captured yet
            </div>
          </div>

          <div class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {{ activeSource?.name || 'No source' }}
            <span v-if="screenFrameDataUrl">
              · {{ estimatedDataUrlBytes(screenFrameDataUrl) }} bytes approx
            </span>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div class="border border-neutral-200 rounded-lg bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 class="m-0 text-base text-neutral-900 font-semibold dark:text-neutral-100">
            Text Context
          </h3>

          <label class="mt-3 block text-xs text-neutral-500 uppercase dark:text-neutral-400">
            Clipboard · {{ snapshot?.clipboard?.length ?? 0 }} chars
          </label>
          <textarea
            class="mt-1 h-24 w-full resize-y border border-neutral-200 rounded-md bg-neutral-50 p-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            readonly
            :value="snapshot?.clipboard?.text || snapshot?.clipboard?.error || ''"
          />

          <label class="mt-3 block text-xs text-neutral-500 uppercase dark:text-neutral-400">
            Selection · {{ snapshot?.selectedText?.source || 'none' }} · {{ snapshot?.selectedText?.length ?? 0 }} chars
          </label>
          <textarea
            class="mt-1 h-24 w-full resize-y border border-neutral-200 rounded-md bg-neutral-50 p-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            readonly
            :value="snapshot?.selectedText?.text || snapshot?.selectedText?.error || ''"
          />

          <p
            v-for="warning in snapshot?.warnings || []"
            :key="warning"
            class="mt-2 border border-amber-200 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            {{ warning }}
          </p>
        </div>

        <div class="border border-neutral-200 rounded-lg bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div class="flex items-center justify-between gap-3">
            <h3 class="m-0 text-base text-neutral-900 font-semibold dark:text-neutral-100">
              Qwen Context Payload
            </h3>
            <button
              class="h-8 flex items-center gap-2 border border-neutral-200 rounded-md bg-neutral-50 px-2 text-xs text-neutral-700 transition dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 dark:text-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-800"
              :disabled="!qwenContextPreview"
              @click="copyPreviewJson"
            >
              <div class="i-solar:copy-bold-duotone" />
              Copy
            </button>
          </div>
          <pre class="mt-3 max-h-120 overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ qwenContextPreview || '{}' }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Desktop Context
  subtitleKey: tamagotchi.settings.devtools.title
</route>
