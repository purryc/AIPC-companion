## Context

The desktop app currently turns voice into chat by streaming or recording speech through Hearing, sending text through the normal chat orchestrator, then speaking the assistant output in `Stage.vue`. Electron screen capture already exists, and widgets can render overlay UI. Qwen3.5-Omni Realtime uses WebSocket authentication headers, so the connection must live in Electron main or another Node-side service rather than the Vue renderer.

## Goals / Non-Goals

**Goals:**

- Add a desktop-only Qwen Omni mode using one DashScope API key.
- Keep the existing classic provider pipeline as fallback.
- Support realtime speech-to-speech with transcript, text, and audio events.
- Support an in-place RPG-style dialogue bubble for companion replies on the desktop overlay.
- Support screen sketch to prototype preview, screen email context to focused Gmail reply text, explicit Gmail draft creation, and Calendar create/update/delete workflows.
- Support a visible Desktop Context inspector so screen/clipboard/selection/mouse context can be verified before it is used by autonomous workflows.
- Keep email sending under user control.
- Keep destructive Calendar deletion under clear user intent and single-event target matching.

**Non-Goals:**

- Replace every AIRI provider or remove classic settings.
- Implement web/mobile Qwen Omni support.
- Build a full browser/Gmail automation agent.
- Automatically send emails or Calendar attendee notifications.
- Delete Calendar events when the target event is ambiguous.
- Persist generated prototypes as project files in v1.

## Decisions

- **Electron main owns Realtime WebSocket.** This supports DashScope `Authorization: Bearer` headers and avoids leaking realtime transport concerns into renderer UI code. Alternative considered: Python companion service; rejected for v1 because it adds a second process and setup step.
- **Qwen Omni mode is additive.** A `classic | qwen-omni` setting switches the desktop voice path while existing provider settings remain intact. Alternative considered: replacing Chat/STT/TTS selections; rejected because it would remove useful fallback paths.
- **Renderer sends PCM16 16k audio chunks to main.** The existing Hearing worklet pattern already converts microphone audio to PCM16, so the new pipeline reuses that approach instead of recording files.
- **Renderer plays PCM16 24k output directly.** Qwen audio deltas bypass normal TTS; playback drives AIRI speaking state and lipsync.
- **Demo commands are deterministic.** Intent phrases route sketch/email workflows before normal conversation so the demos are predictable.
- **Email writeback uses clipboard + Cmd+V.** This is more reliable for long Gmail drafts than keystroke-by-keystroke typing. It never clicks Send.
- **Google Workspace actions use `gog`.** AIRI delegates Gmail draft creation and Calendar mutations to the local authenticated `gog` CLI, avoiding new OAuth UI in v1 and reusing the user's existing Google auth.
- **Calendar actions are explicit native workflows.** Qwen realtime can speak naturally, but create/update/delete commands are intercepted from transcripts, cancel the normal realtime response, and execute the native `gog` workflow.
- **Calendar delete is conservative.** Deletion requires one clear event target from recent context or upcoming Calendar candidates. The app uses `--force` only after target resolution, with `--send-updates none`.
- **Native action confirmations are short voice turns.** After Gmail or Calendar commands succeed, AIRI asks Qwen Realtime to say a fixed short confirmation while suppressing duplicate text output.
- **Companion dialogue uses overlay state, not chat chrome.** The desktop overlay shows assistant replies in a single RPG-style bubble near AIRI while the full chat window remains available separately.
- **Desktop context is explicit and one-shot.** The app reads active window, clipboard, selected text, mouse position, and screen frame only when a user action or routed command requests it. This matches the Loona-style "minimum task context" pattern without silently streaming the whole desktop to the model.
- **Selected text uses Accessibility before clipboard fallback.** AIRI first asks macOS Accessibility for `AXSelectedText`; the Cmd+C fallback is exposed as an explicit toggle because it may temporarily mutate plain-text clipboard content.
- **Qwen voice lifecycle has one owner.** The stage page now reconciles desired inputs (`enabled`, `qwen-omni` mode, current `MediaStream`) into one Qwen voice runtime. The runtime owns realtime socket state, PCM input attachment, output playback, command suppression, and final transcript handling.
- **Transcript deltas are preview-only.** Partial Qwen transcripts update caption preview but never trigger Gmail, Calendar, prototype, or paste side effects. Only final transcript events can execute deterministic commands, and they are keyed by turn/text to avoid duplicate native writes.
- **Runtime cache cleanup preserves settings.** Dev cleanup removes Electron/Vite cache directories such as `Cache`, `Code Cache`, and `GPUCache` but does not delete Local Storage, IndexedDB, Google OAuth, DashScope keys, or other user state.
- **macOS permission identity is fixed.** Local development should launch through the root `/Users/hmi/Documents/airi/Electron.app` binary via the permissioned dev script so macOS privacy grants attach to one app identity.
- **Voice diagnostics are user-visible.** The Qwen Omni settings page receives a broadcast runtime snapshot showing voice state, mic stream, realtime session, input attachment, chunk counts, and the last error.

## Risks / Trade-offs

- **Realtime model/region unavailable** -> Surface a clear connection error and keep classic mode available.
- **macOS Accessibility permission missing** -> Paste helper reports the permission issue and leaves the draft in clipboard.
- **Screen capture source not selected** -> Demo actions return a visible error instead of calling Qwen without an image.
- **Generated prototype HTML is unsafe or malformed** -> Render only in sandboxed iframe and strip dangerous tags/attributes before preview.
- **Long audio sessions leak resources** -> Close sessions when mic disables, app unmounts, or mode changes.
- **Multiple watchers start/stop the same session** -> Use a single reconcile API with a generation guard so stale async starts cannot reactivate a closed or replaced stream.
- **Realtime transcript duplicates final text** -> De-duplicate transcript/text delta handling before committing streaming assistant text.
- **Realtime transcript deltas trigger native actions too early** -> Treat deltas as preview-only and execute commands only from final transcripts.
- **Model promises native action without execution** -> Command routing intercepts action intents and cancels the normal realtime response before running `gog`.
- **Calendar delete can remove the wrong event** -> Require a unique target candidate; otherwise ask for clarification instead of deleting.
- **`gog` auth or Keychain token refresh fails** -> Surface the CLI error in the AIRI bubble so the user can repair Google auth outside AIRI.
- **Desktop context feels too invasive** -> Keep the inspector visible, use per-source toggles, and do not enable continuous screen/clipboard upload.
- **Selected text cannot be read in some apps** -> Report the Accessibility result and offer Cmd+C fallback instead of pretending the selection is available.
- **Stale renderer cache keeps old voice code alive** -> Provide a cache cleanup script that deletes disposable Chromium/Vite caches without resetting user settings.

## Migration Plan

Add the new settings and bridge without changing existing provider defaults. Rollback is removing the new Qwen Omni mode and dependency while classic provider paths continue to work.
