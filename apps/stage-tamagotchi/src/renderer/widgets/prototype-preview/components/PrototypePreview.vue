<script setup lang="ts">
import type { QwenOmniPrototypeSpec } from '@proj-airi/stage-shared'

defineProps<{
  title?: string
  summary?: string
  spec?: QwenOmniPrototypeSpec
  html?: string
}>()
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
    <header class="flex flex-col gap-1 border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800">
      <div class="min-w-0 truncate text-sm font-semibold">
        {{ title || spec?.title || 'Prototype Preview' }}
      </div>
      <div v-if="summary" class="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
        {{ summary }}
      </div>
    </header>
    <iframe
      v-if="html"
      class="min-h-0 flex-1 border-0 bg-white"
      title="Qwen Omni prototype preview"
      sandbox=""
      :srcdoc="html"
    />
    <div v-else class="h-full flex items-center justify-center px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
      Prototype HTML is unavailable.
    </div>
  </div>
</template>
