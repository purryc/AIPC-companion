export type DesktopContextTextSource = 'clipboard' | 'accessibility' | 'clipboard-fallback'

export type DesktopContextMacOSPermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export interface DesktopContextRequest {
  includeActiveWindow?: boolean
  includeClipboard?: boolean
  includeMouse?: boolean
  includeSelectedText?: boolean
  allowSelectedTextClipboardFallback?: boolean
}

export interface DesktopContextTextSnapshot {
  ok: boolean
  source: DesktopContextTextSource
  text: string
  length: number
  empty: boolean
  capturedAt: number
  error?: string
  warning?: string
}

export interface DesktopContextRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopContextDisplaySnapshot {
  id: number
  label: string
  bounds: DesktopContextRect
  workArea: DesktopContextRect
  scaleFactor: number
  rotation: number
}

export interface DesktopContextMouseSnapshot {
  screenPoint: { x: number, y: number }
  display?: DesktopContextDisplaySnapshot
  capturedAt: number
}

export interface DesktopContextActiveWindowSnapshot {
  ok: boolean
  appName?: string
  processId?: number
  windowTitle?: string
  capturedAt: number
  error?: string
}

export interface DesktopContextPermissionsSnapshot {
  platform: string
  macOS?: {
    accessibilityTrusted: boolean
    screenCapture: DesktopContextMacOSPermissionStatus
  }
}

export type DesktopContextMacOSPermissionKind = 'accessibility' | 'screen-capture'

export interface DesktopContextMacOSAppIdentity {
  name: string
  executablePath: string
  bundlePath?: string
  bundleName?: string
  bundleIdentifier?: string
}

export interface DesktopContextPermissionRequest {
  permission: DesktopContextMacOSPermissionKind
  openSettings?: boolean
  prompt?: boolean
}

export interface DesktopContextPermissionResult {
  platform: string
  permission: DesktopContextMacOSPermissionKind
  app: DesktopContextMacOSAppIdentity
  before?: DesktopContextPermissionsSnapshot['macOS']
  after?: DesktopContextPermissionsSnapshot['macOS']
  openedSettings: boolean
}

export interface DesktopContextSnapshot {
  capturedAt: number
  permissions: DesktopContextPermissionsSnapshot
  activeWindow?: DesktopContextActiveWindowSnapshot
  clipboard?: DesktopContextTextSnapshot
  selectedText?: DesktopContextTextSnapshot
  mouse?: DesktopContextMouseSnapshot
  warnings: string[]
}
