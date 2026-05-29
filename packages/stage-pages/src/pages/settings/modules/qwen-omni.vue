<script setup lang="ts">
import type { QwenOmniConversationMode, QwenOmniRegion, QwenOmniVoiceRuntimeSnapshot } from '@proj-airi/stage-shared'

import { useQwenOmniStore } from '@proj-airi/stage-ui/stores/modules/qwen-omni'
import { FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const qwenOmniStore = useQwenOmniStore()
const {
  apiKey,
  conversationMode,
  httpModel,
  inputTranscriptionModel,
  realtimeModel,
  region,
  vadPrefixPaddingMs,
  vadSilenceDurationMs,
  vadThreshold,
  voice,
} = storeToRefs(qwenOmniStore)
const { data: runtimeSnapshot } = useBroadcastChannel<QwenOmniVoiceRuntimeSnapshot, QwenOmniVoiceRuntimeSnapshot>({ name: 'airi-qwen-omni-runtime' })

const modeOptions: Array<{ label: string, value: QwenOmniConversationMode, description: string }> = [
  {
    label: 'Classic providers',
    value: 'classic',
    description: 'Keep STT, chat, and TTS as separate providers.',
  },
  {
    label: 'Qwen Omni',
    value: 'qwen-omni',
    description: 'Use Qwen realtime voice for live conversation.',
  },
]

const regionOptions: Array<{ label: string, value: QwenOmniRegion, description: string }> = [
  {
    label: 'International Singapore',
    value: 'intl-singapore',
    description: 'dashscope-intl.aliyuncs.com',
  },
  {
    label: 'China Beijing',
    value: 'cn-beijing',
    description: 'dashscope.aliyuncs.com',
  },
]

const realtimeModelOptions = [
  {
    label: 'qwen3.5-omni-plus-realtime',
    value: 'qwen3.5-omni-plus-realtime',
    description: 'Current Qwen3.5 realtime voice model.',
  },
  {
    label: 'qwen3-omni-flash-realtime',
    value: 'qwen3-omni-flash-realtime',
    description: 'Lower latency realtime voice model.',
  },
]

const httpModelOptions = [
  {
    label: 'qwen3.5-omni-flash',
    value: 'qwen3.5-omni-flash',
    description: 'Lower latency multimodal/code workflows.',
  },
  {
    label: 'qwen3.5-omni-plus',
    value: 'qwen3.5-omni-plus',
    description: 'Higher quality multimodal/code workflows.',
  },
]

function formatThreshold(value: number) {
  return value.toFixed(2)
}

function formatMs(value: number) {
  return `${Math.round(value)} ms`
}

const runtimeStatusItems = computed(() => {
  const snapshot = runtimeSnapshot.value
  if (!snapshot)
    return []

  return [
    ['State', snapshot.state],
    ['Mic', snapshot.hasStream ? 'stream ready' : 'waiting'],
    ['Realtime', snapshot.sessionActive ? 'connected' : 'closed'],
    ['Input', snapshot.inputAttached ? `attached #${snapshot.streamRevision}` : 'detached'],
    ['Audio', `${snapshot.audioChunksSent ?? 0} in / ${snapshot.audioChunksPlayed ?? 0} out`],
  ]
})
</script>

<template>
  <div class="mx-auto max-w-3xl flex flex-col gap-6">
    <section class="flex flex-col gap-2">
      <h2 class="m-0 text-2xl text-neutral-900 font-semibold dark:text-neutral-100">
        Qwen Omni
      </h2>
      <p class="m-0 text-sm text-neutral-500 leading-6 dark:text-neutral-400">
        One DashScope key drives realtime voice plus the screen-aware prototype and email demos.
      </p>
    </section>

    <section class="flex flex-col gap-5 rounded-xl bg-white/70 p-5 shadow-sm dark:bg-neutral-950/70">
      <FieldSelect
        v-model="conversationMode"
        label="Conversation mode"
        description="Switch voice conversation between AIRI's classic provider chain and Qwen Omni realtime."
        :options="modeOptions"
      />
      <FieldInput
        v-model="apiKey"
        type="password"
        label="DashScope API key"
        description="Stored locally. Use an Alibaba Cloud / DashScope key, not a qwen.ai web token."
        placeholder="sk-..."
      />
      <FieldSelect
        v-model="region"
        label="Region"
        description="Match the DashScope region where your API key is enabled."
        :options="regionOptions"
      />
    </section>

    <section class="flex flex-col gap-4 rounded-xl bg-white/70 p-5 shadow-sm dark:bg-neutral-950/70">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="m-0 text-base text-neutral-900 font-semibold dark:text-neutral-100">
            Voice runtime
          </h3>
          <p class="m-0 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Live status from the desktop Qwen Omni voice bridge.
          </p>
        </div>
        <span
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="runtimeSnapshot?.state === 'error'
            ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200'
            : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200'"
        >
          {{ runtimeSnapshot?.state ?? 'not started' }}
        </span>
      </div>
      <div
        v-if="runtimeStatusItems.length"
        class="grid grid-cols-2 gap-3 text-sm"
      >
        <div
          v-for="[label, value] in runtimeStatusItems"
          :key="label"
          class="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900"
        >
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ label }}
          </div>
          <div class="mt-1 break-all text-neutral-900 font-medium dark:text-neutral-100">
            {{ value }}
          </div>
        </div>
      </div>
      <div
        v-if="runtimeSnapshot?.lastError"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200"
      >
        {{ runtimeSnapshot.lastError }}
      </div>
    </section>

    <section class="flex flex-col gap-5 rounded-xl bg-white/70 p-5 shadow-sm dark:bg-neutral-950/70">
      <FieldSelect
        v-model="realtimeModel"
        label="Realtime model"
        description="Used for live voice conversation."
        :options="realtimeModelOptions"
      />
      <FieldSelect
        v-model="httpModel"
        label="HTTP multimodal model"
        description="Used for screen-to-prototype and screen-to-email workflows."
        :options="httpModelOptions"
      />
      <FieldInput
        v-model="voice"
        label="Voice"
        description="DashScope realtime voice id."
        placeholder="Tina"
      />
      <FieldInput
        v-model="inputTranscriptionModel"
        label="Input transcription model"
        description="DashScope realtime transcription model."
        placeholder="gummy-realtime-v1"
      />
    </section>

    <section class="flex flex-col gap-5 rounded-xl bg-white/70 p-5 shadow-sm dark:bg-neutral-950/70">
      <FieldRange
        v-model="vadThreshold"
        label="VAD threshold"
        description="Higher values require clearer speech before Qwen starts a turn."
        :min="0.1"
        :max="0.9"
        :step="0.05"
        :format-value="formatThreshold"
      />
      <FieldRange
        v-model="vadPrefixPaddingMs"
        label="Prefix padding"
        description="Audio kept before speech start, so leading syllables are less likely to be clipped."
        :min="100"
        :max="1200"
        :step="50"
        :format-value="formatMs"
      />
      <FieldRange
        v-model="vadSilenceDurationMs"
        label="Silence duration"
        description="Silence length before Qwen treats your turn as complete."
        :min="300"
        :max="2000"
        :step="50"
        :format-value="formatMs"
      />
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.qwen_omni.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
