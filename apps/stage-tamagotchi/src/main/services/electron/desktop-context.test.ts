import type { Display } from 'electron'

import { createContext, defineInvoke } from '@moeru/eventa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronDesktopContextGetSnapshot, electronDesktopContextRequestPermission } from '../../../shared/eventa'
import { createDesktopContextService, findDisplayForPoint, parseActiveWindowAppleScriptOutput } from './desktop-context'

const appMock = vi.hoisted(() => ({
  getName: vi.fn(),
}))

const clipboardMock = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}))

const shellMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
}))

const screenMock = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getCursorScreenPoint: vi.fn(),
}))

const systemPreferencesMock = vi.hoisted(() => ({
  getMediaAccessStatus: vi.fn(),
  isTrustedAccessibilityClient: vi.fn(),
}))

vi.mock('electron', () => ({
  app: appMock,
  clipboard: clipboardMock,
  shell: shellMock,
  screen: screenMock,
  systemPreferences: systemPreferencesMock,
}))

vi.mock('std-env', () => ({
  isMacOS: true,
}))

describe('desktop context service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appMock.getName.mockReturnValue('AIRI Dev')
    clipboardMock.readText.mockReturnValue('clipboard note')
    shellMock.openExternal.mockResolvedValue(undefined)
    screenMock.getCursorScreenPoint.mockReturnValue({ x: 120, y: 80 })
    screenMock.getAllDisplays.mockReturnValue([
      {
        id: 1,
        label: 'Built-in Display',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 25, width: 1440, height: 875 },
        scaleFactor: 2,
        rotation: 0,
      },
    ])
    systemPreferencesMock.getMediaAccessStatus.mockReturnValue('granted')
    systemPreferencesMock.isTrustedAccessibilityClient.mockReturnValue(true)
  })

  it('returns clipboard, mouse, display, and permission context through Eventa', async () => {
    const context = createContext()
    createDesktopContextService({ context: context as never })
    const getSnapshot = defineInvoke(context, electronDesktopContextGetSnapshot)

    const snapshot = await getSnapshot({
      includeClipboard: true,
      includeMouse: true,
    })

    expect(snapshot.permissions.macOS).toEqual({
      accessibilityTrusted: true,
      screenCapture: 'granted',
    })
    expect(systemPreferencesMock.isTrustedAccessibilityClient).toHaveBeenCalledWith(false)
    expect(snapshot.clipboard).toMatchObject({
      ok: true,
      source: 'clipboard',
      text: 'clipboard note',
      length: 14,
      empty: false,
    })
    expect(snapshot.mouse).toMatchObject({
      screenPoint: { x: 120, y: 80 },
      display: {
        id: 1,
        label: 'Built-in Display',
      },
    })
  })

  it('parses active window AppleScript output', () => {
    expect(parseActiveWindowAppleScriptOutput('Google Chrome\n1234\nInbox - Gmail', 42)).toEqual({
      ok: true,
      appName: 'Google Chrome',
      processId: 1234,
      windowTitle: 'Inbox - Gmail',
      capturedAt: 42,
    })
  })

  it('matches cursor points to the owning display bounds', () => {
    const displays = [
      { bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
      { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
    ] as unknown as Display[]

    expect(findDisplayForPoint(displays, { x: -20, y: 100 })).toBe(displays[0])
    expect(findDisplayForPoint(displays, { x: 100, y: 100 })).toBe(displays[1])
    expect(findDisplayForPoint(displays, { x: 2000, y: 100 })).toBeUndefined()
  })

  it('prompts for macOS Accessibility when active window or selection context is requested', async () => {
    const context = createContext()
    createDesktopContextService({ context: context as never })
    const getSnapshot = defineInvoke(context, electronDesktopContextGetSnapshot)

    await getSnapshot({
      includeSelectedText: true,
    })

    expect(systemPreferencesMock.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
  })

  it('exposes an explicit Accessibility permission action with settings handoff', async () => {
    const context = createContext()
    createDesktopContextService({ context: context as never })
    const requestPermission = defineInvoke(context, electronDesktopContextRequestPermission)

    const result = await requestPermission({
      permission: 'accessibility',
      openSettings: true,
    })

    expect(systemPreferencesMock.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
    expect(shellMock.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    expect(result).toMatchObject({
      platform: 'darwin',
      permission: 'accessibility',
      app: {
        name: 'AIRI Dev',
      },
      openedSettings: true,
    })
  })
})
