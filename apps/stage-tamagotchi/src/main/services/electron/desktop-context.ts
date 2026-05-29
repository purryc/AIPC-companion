import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  DesktopContextActiveWindowSnapshot,
  DesktopContextDisplaySnapshot,
  DesktopContextMacOSAppIdentity,
  DesktopContextMacOSPermissionStatus,
  DesktopContextMouseSnapshot,
  DesktopContextPermissionRequest,
  DesktopContextPermissionResult,
  DesktopContextPermissionsSnapshot,
  DesktopContextRequest,
  DesktopContextSnapshot,
  DesktopContextTextSnapshot,
  DesktopContextTextSource,
} from '@proj-airi/stage-shared'
import type { Display } from 'electron'

import process from 'node:process'

import { execFile, execFileSync } from 'node:child_process'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app, clipboard, screen, shell, systemPreferences } from 'electron'
import { isMacOS } from 'std-env'

import { electronDesktopContextGetSnapshot, electronDesktopContextRequestPermission } from '../../../shared/eventa'

const SELECTED_TEXT_APPLESCRIPT = `
tell application "System Events"
  set frontApps to application processes whose frontmost is true
  if (count of frontApps) = 0 then return ""
  set frontApp to item 1 of frontApps
  try
    set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
    try
      set selectedText to value of attribute "AXSelectedText" of focusedElement
      if selectedText is missing value then return ""
      return selectedText as text
    on error
      return ""
    end try
  on error
    return ""
  end try
end tell
`.trim()

const ACTIVE_WINDOW_APPLESCRIPT = `
tell application "System Events"
  set frontApps to application processes whose frontmost is true
  if (count of frontApps) = 0 then return ""
  set frontApp to item 1 of frontApps
  set appName to name of frontApp
  set pidValue to unix id of frontApp
  try
    set windowTitle to name of front window of frontApp
  on error
    set windowTitle to ""
  end try
  return appName & linefeed & pidValue & linefeed & windowTitle
end tell
`.trim()

const COPY_SELECTION_APPLESCRIPT = 'tell application "System Events" to keystroke "c" using command down'

const MACOS_PRIVACY_SETTINGS_URLS = {
  'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-capture': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
} satisfies Record<DesktopContextPermissionRequest['permission'], string>

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout) => {
      if (error) {
        reject(error)
        return
      }

      resolve(stdout.trimEnd())
    })
  })
}

function toTextSnapshot(params: {
  source: DesktopContextTextSource
  text: string
  capturedAt: number
  ok?: boolean
  error?: string
  warning?: string
}): DesktopContextTextSnapshot {
  return {
    ok: params.ok ?? true,
    source: params.source,
    text: params.text,
    length: params.text.length,
    empty: params.text.length === 0,
    capturedAt: params.capturedAt,
    error: params.error,
    warning: params.warning,
  }
}

export function displayToDesktopContextDisplay(display: Display): DesktopContextDisplaySnapshot {
  return {
    id: display.id,
    label: display.label,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  }
}

export function findDisplayForPoint(displays: Display[], point: { x: number, y: number }) {
  return displays.find(display =>
    point.x >= display.bounds.x
    && point.y >= display.bounds.y
    && point.x < display.bounds.x + display.bounds.width
    && point.y < display.bounds.y + display.bounds.height,
  )
}

export function parseActiveWindowAppleScriptOutput(output: string, capturedAt: number): DesktopContextActiveWindowSnapshot {
  const [appName = '', pidText = '', ...titleLines] = output.split('\n')
  const processId = Number(pidText)
  const windowTitle = titleLines.join('\n').trim()

  return {
    ok: appName.trim().length > 0,
    appName: appName.trim() || undefined,
    processId: Number.isFinite(processId) ? processId : undefined,
    windowTitle: windowTitle || undefined,
    capturedAt,
  }
}

function readPermissions(promptAccessibility: boolean): DesktopContextPermissionsSnapshot {
  if (!isMacOS) {
    return {
      platform: process.platform,
    }
  }

  return {
    platform: process.platform,
    macOS: {
      accessibilityTrusted: systemPreferences.isTrustedAccessibilityClient(promptAccessibility),
      screenCapture: systemPreferences.getMediaAccessStatus('screen') as DesktopContextMacOSPermissionStatus,
    },
  }
}

function getMacOSBundlePath(executablePath: string) {
  const marker = '.app/Contents/MacOS/'
  const markerIndex = executablePath.indexOf(marker)
  if (markerIndex < 0)
    return undefined

  return executablePath.slice(0, markerIndex + '.app'.length)
}

function readMacOSBundleInfo(bundlePath?: string) {
  if (!bundlePath)
    return {}

  const plistPath = `${bundlePath}/Contents/Info.plist`

  function readPlistValue(key: string) {
    try {
      return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
        encoding: 'utf8',
        timeout: 1000,
      }).trim()
    }
    catch {
      return undefined
    }
  }

  return {
    bundleName: readPlistValue('CFBundleDisplayName') || readPlistValue('CFBundleName'),
    bundleIdentifier: readPlistValue('CFBundleIdentifier'),
  }
}

function getAppIdentity(): DesktopContextMacOSAppIdentity {
  const bundlePath = isMacOS ? getMacOSBundlePath(process.execPath) : undefined

  return {
    name: app.getName(),
    executablePath: process.execPath,
    bundlePath,
    ...readMacOSBundleInfo(bundlePath),
  }
}

async function requestDesktopContextPermission(request: DesktopContextPermissionRequest): Promise<DesktopContextPermissionResult> {
  const before = readPermissions(false).macOS
  const shouldPrompt = request.prompt ?? true
  let openedSettings = false

  if (isMacOS && request.permission === 'accessibility' && shouldPrompt) {
    systemPreferences.isTrustedAccessibilityClient(true)
  }

  if (isMacOS && request.openSettings) {
    await shell.openExternal(MACOS_PRIVACY_SETTINGS_URLS[request.permission])
    openedSettings = true
  }

  return {
    platform: process.platform,
    permission: request.permission,
    app: getAppIdentity(),
    before,
    after: readPermissions(false).macOS,
    openedSettings,
  }
}

async function readActiveWindow(capturedAt: number): Promise<DesktopContextActiveWindowSnapshot> {
  if (!isMacOS) {
    return {
      ok: false,
      capturedAt,
      error: 'Active window inspection is currently implemented for macOS only.',
    }
  }

  try {
    return parseActiveWindowAppleScriptOutput(await runAppleScript(ACTIVE_WINDOW_APPLESCRIPT), capturedAt)
  }
  catch (error) {
    return {
      ok: false,
      capturedAt,
      error: errorMessageFrom(error) ?? String(error),
    }
  }
}

function readClipboard(capturedAt: number): DesktopContextTextSnapshot {
  try {
    return toTextSnapshot({
      source: 'clipboard',
      text: clipboard.readText(),
      capturedAt,
    })
  }
  catch (error) {
    return toTextSnapshot({
      source: 'clipboard',
      text: '',
      capturedAt,
      ok: false,
      error: errorMessageFrom(error) ?? String(error),
    })
  }
}

function tryWriteClipboardText(text: string) {
  try {
    clipboard.writeText(text)
    return true
  }
  catch {
    return false
  }
}

async function readSelectedTextWithAccessibility(capturedAt: number): Promise<DesktopContextTextSnapshot> {
  if (!isMacOS) {
    return toTextSnapshot({
      source: 'accessibility',
      text: '',
      capturedAt,
      ok: false,
      error: 'Selected text inspection is currently implemented for macOS only.',
    })
  }

  try {
    return toTextSnapshot({
      source: 'accessibility',
      text: await runAppleScript(SELECTED_TEXT_APPLESCRIPT),
      capturedAt,
    })
  }
  catch (error) {
    return toTextSnapshot({
      source: 'accessibility',
      text: '',
      capturedAt,
      ok: false,
      error: errorMessageFrom(error) ?? String(error),
    })
  }
}

async function readSelectedTextWithClipboardFallback(capturedAt: number): Promise<DesktopContextTextSnapshot> {
  if (!isMacOS) {
    return toTextSnapshot({
      source: 'clipboard-fallback',
      text: '',
      capturedAt,
      ok: false,
      error: 'Clipboard fallback selection read is currently implemented for macOS only.',
    })
  }

  let previousText = ''
  try {
    previousText = clipboard.readText()
    clipboard.writeText('')
    await runAppleScript(COPY_SELECTION_APPLESCRIPT)
    await new Promise(resolve => setTimeout(resolve, 120))
    const selectedText = clipboard.readText()
    tryWriteClipboardText(previousText)

    return toTextSnapshot({
      source: 'clipboard-fallback',
      text: selectedText,
      capturedAt,
      warning: 'Read by sending Cmd+C and restoring plain-text clipboard content; rich clipboard formats may not be preserved.',
    })
  }
  catch (error) {
    tryWriteClipboardText(previousText)
    return toTextSnapshot({
      source: 'clipboard-fallback',
      text: '',
      capturedAt,
      ok: false,
      error: errorMessageFrom(error) ?? String(error),
      warning: 'Cmd+C fallback requires macOS Accessibility permission.',
    })
  }
}

async function readSelectedText(request: DesktopContextRequest, capturedAt: number): Promise<DesktopContextTextSnapshot> {
  const direct = await readSelectedTextWithAccessibility(capturedAt)
  if (!direct.empty || !request.allowSelectedTextClipboardFallback)
    return direct

  return readSelectedTextWithClipboardFallback(capturedAt)
}

function readMouse(capturedAt: number): DesktopContextMouseSnapshot {
  const screenPoint = screen.getCursorScreenPoint()
  const displays = screen.getAllDisplays()
  const display = findDisplayForPoint(displays, screenPoint)

  return {
    screenPoint,
    display: display ? displayToDesktopContextDisplay(display) : undefined,
    capturedAt,
  }
}

async function getDesktopContextSnapshot(request: DesktopContextRequest = {}): Promise<DesktopContextSnapshot> {
  const capturedAt = Date.now()
  const warnings: string[] = []
  const promptAccessibility = Boolean(
    request.includeActiveWindow
    || request.includeSelectedText
    || request.allowSelectedTextClipboardFallback,
  )
  const snapshot: DesktopContextSnapshot = {
    capturedAt,
    permissions: readPermissions(promptAccessibility),
    warnings,
  }

  if (request.includeActiveWindow)
    snapshot.activeWindow = await readActiveWindow(capturedAt)

  if (request.includeClipboard)
    snapshot.clipboard = readClipboard(capturedAt)

  if (request.includeSelectedText)
    snapshot.selectedText = await readSelectedText(request, capturedAt)

  if (request.includeMouse)
    snapshot.mouse = readMouse(capturedAt)

  if (snapshot.selectedText?.warning)
    warnings.push(snapshot.selectedText.warning)

  if (snapshot.selectedText?.error?.includes('not allowed') || snapshot.activeWindow?.error?.includes('not allowed')) {
    warnings.push('macOS Accessibility permission may be required for active window and selected text context.')
  }

  return snapshot
}

export function createDesktopContextService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronDesktopContextGetSnapshot, payload => getDesktopContextSnapshot(payload))
  defineInvokeHandler(params.context, electronDesktopContextRequestPermission, payload => requestDesktopContextPermission(payload))
}
