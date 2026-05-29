## Why

AIRI's current voice path is assembled from separate STT, chat, vision, and TTS providers, which creates latency and makes screen-aware voice demos feel stitched together. Qwen3.5-Omni gives AIRI a single DashScope key for realtime speech-to-speech plus multimodal HTTP workflows, enabling stronger desktop assistant demos without removing existing fallback providers.

## What Changes

- Add a Qwen Omni conversation mode for the desktop `stage-tamagotchi` app.
- Add DashScope Qwen configuration for region, API key, HTTP model, realtime model, voice, and VAD parameters.
- Add an Electron main realtime WebSocket bridge for Qwen3.5-Omni Realtime.
- Route Qwen input transcripts, text deltas, and audio deltas into AIRI chat, captions, playback, and lipsync.
- Add deterministic demo routing for sketch-to-prototype and screen-to-email intents.
- Add a prototype preview widget that renders generated single-page HTML in a sandboxed iframe.
- Add a macOS paste helper that writes generated email drafts into the currently focused input without sending.
- Keep classic Chat/STT/TTS/Vision providers available as fallback.

## Capabilities

### New Capabilities

- `qwen-omni-realtime-conversation`: Realtime DashScope Qwen Omni conversation mode for desktop voice chat.
- `qwen-omni-desktop-demos`: Screen-aware sketch-to-prototype and email-draft demos powered by Qwen Omni.

### Modified Capabilities

- None.

## Impact

- Affects `apps/stage-tamagotchi`, `packages/stage-ui`, `packages/stage-pages`, shared Eventa contracts, widgets, and package dependencies.
- Adds `ws` as a desktop app dependency because DashScope Realtime requires an Authorization header that renderer WebSocket cannot set.
- Adds macOS-only paste behavior behind explicit user intent; no email is sent automatically.
