## Context

The desktop app currently turns voice into chat by streaming or recording speech through Hearing, sending text through the normal chat orchestrator, then speaking the assistant output in `Stage.vue`. Electron screen capture already exists, and widgets can render overlay UI. Qwen3.5-Omni Realtime uses WebSocket authentication headers, so the connection must live in Electron main or another Node-side service rather than the Vue renderer.

## Goals / Non-Goals

**Goals:**

- Add a desktop-only Qwen Omni mode using one DashScope API key.
- Keep the existing classic provider pipeline as fallback.
- Support realtime speech-to-speech with transcript, text, and audio events.
- Support two demo workflows: screen sketch to prototype preview, and screen email context to focused Gmail reply text.
- Keep email sending under user control.

**Non-Goals:**

- Replace every AIRI provider or remove classic settings.
- Implement web/mobile Qwen Omni support.
- Build a full browser/Gmail automation agent.
- Persist generated prototypes as project files in v1.

## Decisions

- **Electron main owns Realtime WebSocket.** This supports DashScope `Authorization: Bearer` headers and avoids leaking realtime transport concerns into renderer UI code. Alternative considered: Python companion service; rejected for v1 because it adds a second process and setup step.
- **Qwen Omni mode is additive.** A `classic | qwen-omni` setting switches the desktop voice path while existing provider settings remain intact. Alternative considered: replacing Chat/STT/TTS selections; rejected because it would remove useful fallback paths.
- **Renderer sends PCM16 16k audio chunks to main.** The existing Hearing worklet pattern already converts microphone audio to PCM16, so the new pipeline reuses that approach instead of recording files.
- **Renderer plays PCM16 24k output directly.** Qwen audio deltas bypass normal TTS; playback drives AIRI speaking state and lipsync.
- **Demo commands are deterministic.** Intent phrases route sketch/email workflows before normal conversation so the demos are predictable.
- **Email writeback uses clipboard + Cmd+V.** This is more reliable for long Gmail drafts than keystroke-by-keystroke typing. It never clicks Send.

## Risks / Trade-offs

- **Realtime model/region unavailable** -> Surface a clear connection error and keep classic mode available.
- **macOS Accessibility permission missing** -> Paste helper reports the permission issue and leaves the draft in clipboard.
- **Screen capture source not selected** -> Demo actions return a visible error instead of calling Qwen without an image.
- **Generated prototype HTML is unsafe or malformed** -> Render only in sandboxed iframe and strip dangerous tags/attributes before preview.
- **Long audio sessions leak resources** -> Close sessions when mic disables, app unmounts, or mode changes.

## Migration Plan

Add the new settings and bridge without changing existing provider defaults. Rollback is removing the new Qwen Omni mode and dependency while classic provider paths continue to work.
