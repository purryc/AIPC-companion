import { join } from 'node:path'

export const runtimeCacheDirectoryNames = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
] as const

export const preservedRuntimeDataDirectoryNames = [
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'databases',
  'shared_proto_db',
] as const

/**
 * Resolves Electron runtime cache directories that can be deleted safely.
 *
 * Use when:
 * - A dev build may be loading stale Vite or Chromium cache artifacts
 * - Local settings, provider keys, and OAuth data must be preserved
 *
 * Returns:
 * - Absolute cache directory paths under Electron's app support directory
 */
export function resolveRuntimeCacheCleanupTargets(appSupportDir: string): string[] {
  return runtimeCacheDirectoryNames.map(name => join(appSupportDir, name))
}

/**
 * Checks whether an app support child directory stores user/session data.
 *
 * Use when:
 * - Cleanup scripts need a guardrail against deleting API keys or OAuth state
 */
export function shouldPreserveRuntimeDataDirectory(name: string): boolean {
  return preservedRuntimeDataDirectoryNames.some(preserved => preserved.toLowerCase() === name.toLowerCase())
}
