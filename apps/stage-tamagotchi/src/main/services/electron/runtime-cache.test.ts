import { describe, expect, it } from 'vitest'

import {
  resolveRuntimeCacheCleanupTargets,
  shouldPreserveRuntimeDataDirectory,
} from './runtime-cache'

describe('runtime cache cleanup helpers', () => {
  it('targets only disposable Electron cache directories', () => {
    const targets = resolveRuntimeCacheCleanupTargets('/Users/example/Library/Application Support/@proj-airi/stage-tamagotchi')

    expect(targets).toContain('/Users/example/Library/Application Support/@proj-airi/stage-tamagotchi/Cache')
    expect(targets).toContain('/Users/example/Library/Application Support/@proj-airi/stage-tamagotchi/Code Cache')
    expect(targets).toContain('/Users/example/Library/Application Support/@proj-airi/stage-tamagotchi/GPUCache')
    expect(targets.some(target => target.endsWith('/Local Storage'))).toBe(false)
    expect(targets.some(target => target.endsWith('/IndexedDB'))).toBe(false)
  })

  it('preserves local settings and OAuth storage directories', () => {
    expect(shouldPreserveRuntimeDataDirectory('Local Storage')).toBe(true)
    expect(shouldPreserveRuntimeDataDirectory('IndexedDB')).toBe(true)
    expect(shouldPreserveRuntimeDataDirectory('Cache')).toBe(false)
    expect(shouldPreserveRuntimeDataDirectory('Code Cache')).toBe(false)
  })
})
