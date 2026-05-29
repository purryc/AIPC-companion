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

## 5. Verification

- [x] 5.1 Run targeted Vitest suites.
- [ ] 5.2 Run desktop typecheck and build.
  - Typecheck passed for `stage-shared`, `stage-ui`, `stage-pages`, and `stage-tamagotchi`.
  - `pnpm -F @proj-airi/stage-tamagotchi build` is blocked during renderer UnoCSS generation by the existing scrollbar utility CSS error: `CssSyntaxError: [postcss] ... __uno.css: Missed semicolon`.
- [x] 5.3 Run repository lint or document remaining lint blockers.
  - Changed Qwen files pass targeted ESLint.
  - Full `pnpm lint` reports existing repo-wide lint errors outside this change, including duplicate declarations in `services/computer-use-mcp`, markdown parse errors in `apps/server/docs`, and global `Buffer`/`process` lint failures.
