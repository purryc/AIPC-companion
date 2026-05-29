## 1. OpenSpec

- [x] 1.1 Initialize OpenSpec for the repo if missing.
- [x] 1.2 Create proposal, design, task, and delta spec artifacts.
- [x] 1.3 Validate the change with strict OpenSpec validation.

## 2. Qwen Configuration

- [x] 2.1 Add Qwen Omni settings store with endpoints, defaults, and model options.
- [x] 2.2 Add a Qwen Omni settings page for key, region, models, voice, VAD, and conversation mode.
- [x] 2.3 Add endpoint/model mapping tests.

## 3. Realtime Bridge

- [x] 3.1 Add `ws` dependency to the desktop app.
- [x] 3.2 Add shared Eventa contracts for Qwen realtime session control and events.
- [x] 3.3 Implement Electron main Qwen Realtime WebSocket session.
- [x] 3.4 Implement renderer-side audio capture, audio playback, transcript, chat history, and interrupt handling.
- [x] 3.5 Add parser and lifecycle tests.

## 4. Desktop Demos

- [x] 4.1 Add deterministic command router for prototype and email intents.
- [x] 4.2 Add Qwen HTTP multimodal client for prototype and email workflows.
- [x] 4.3 Add screen frame capture helper for selected Electron source.
- [x] 4.4 Add prototype preview widget with sandboxed iframe.
- [x] 4.5 Add macOS paste helper for focused text fields.
- [x] 4.6 Add demo workflow tests.

## 5. Google Workspace Actions

- [x] 5.1 Add `gog` backed Gmail draft creation that never sends mail.
- [x] 5.2 Add `gog` backed Google Calendar event creation with `send-updates none`.
- [x] 5.3 Add Calendar event update support for title, time, location, description, attendees, and Meet fields.
- [x] 5.4 Add Calendar event delete support with single-target matching and `send-updates none`.
- [x] 5.5 Add short voice confirmations after successful Gmail and Calendar actions.
- [x] 5.6 Add command suppression so Qwen realtime does not verbally promise native actions without execution.

## 6. Desktop Companion Bubble

- [x] 6.1 Add an RPG-style desktop dialogue bubble below AIRI.
- [x] 6.2 Stream assistant text into one visible bubble instead of scattered chat-only output.
- [x] 6.3 De-duplicate final transcript/text events so assistant text does not appear twice.

## 7. Desktop Context Layer

- [x] 7.1 Add a desktop context Eventa snapshot contract for active window, clipboard, selected text, mouse, and permissions.
- [x] 7.2 Add macOS read paths for clipboard, Accessibility selected text, active app/window, and cursor display matching.
- [x] 7.3 Add an explicit Cmd+C selected-text fallback guarded behind a user-controlled devtools toggle.
- [x] 7.4 Add a Desktop Context devtools inspector for screen frame, clipboard, selected text, active window, mouse, and Qwen-ready payload preview.
- [x] 7.5 Add unit coverage for context snapshot wiring, active-window parsing, and display matching.

## 8. Verification

- [x] 8.1 Run targeted Vitest suites.
- [ ] 8.2 Run desktop typecheck and build.
  - Typecheck passed for `stage-shared`, `stage-ui`, `stage-pages`, and `stage-tamagotchi`.
  - `pnpm -F @proj-airi/stage-tamagotchi build` is blocked during renderer UnoCSS generation by the existing scrollbar utility CSS error: `CssSyntaxError: [postcss] ... __uno.css: Missed semicolon`.
- [x] 8.3 Run repository lint or document remaining lint blockers.
  - Changed Qwen files pass targeted ESLint.
  - Full `pnpm lint` reports existing repo-wide lint errors outside this change, including duplicate declarations in `services/computer-use-mcp`, markdown parse errors in `apps/server/docs`, and global `Buffer`/`process` lint failures.
- [x] 8.4 Smoke-check `gog` Calendar update/delete syntax with dry runs.
- [x] 8.5 Restart the desktop app and confirm Qwen Realtime reconnects.

## 9. Voice Runtime Stabilization

- [x] 9.1 Add shared Qwen voice runtime state, snapshot, reconcile, and final-transcript command guard types.
- [x] 9.2 Refactor desktop Qwen voice startup into `reconcileQwenOmniVoice` / `resetQwenOmniVoice` with generation guards.
- [x] 9.3 Stop running Calendar/Gmail/Prototype side effects from transcript deltas; run them only from final unique transcripts.
- [x] 9.4 Add Qwen voice runtime diagnostics and broadcast them to the Qwen Omni settings page.
- [x] 9.5 Add safe Electron runtime cache cleanup helpers and a macOS permissioned dev launch script.
- [x] 9.6 Add unit coverage for reconcile actions, final transcript command gating, and cache cleanup target preservation.
