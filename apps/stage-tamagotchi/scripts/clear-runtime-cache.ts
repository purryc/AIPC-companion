import process from 'node:process'

import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveRuntimeCacheCleanupTargets } from '../src/main/services/electron/runtime-cache'

const appSupportDir = process.env.AIRI_STAGE_TAMAGOTCHI_APP_SUPPORT_DIR
  || join(homedir(), 'Library', 'Application Support', '@proj-airi', 'stage-tamagotchi')

const targets = resolveRuntimeCacheCleanupTargets(appSupportDir)

for (const target of targets) {
  await rm(target, { recursive: true, force: true })
  console.info(`[clear-runtime-cache] removed ${target}`)
}

console.info('[clear-runtime-cache] preserved Local Storage, IndexedDB, and OAuth/session data')
