## ADDED Requirements

### Requirement: Stable Qwen Omni voice runtime
The system SHALL run desktop Qwen Omni voice through one renderer runtime that owns realtime session state, microphone PCM input attachment, audio playback, transcript handling, and native command suppression.

#### Scenario: Voice startup is idempotent
- **WHEN** the mic toggle, Qwen Omni mode, or stream object changes repeatedly
- **THEN** the system reconciles the desired state and MUST NOT open duplicate realtime sessions or attach duplicate microphone worklets

#### Scenario: Stream replacement keeps realtime session stable
- **WHEN** the microphone stream changes while Qwen Omni mode remains enabled
- **THEN** the system reattaches PCM input to the new stream without closing an otherwise healthy realtime session

#### Scenario: Disabled mode closes realtime resources
- **WHEN** the mic is disabled, Qwen Omni mode is turned off, or the stage unmounts
- **THEN** the system closes realtime resources, detaches microphone input, clears pending output audio, and returns the voice runtime to idle

#### Scenario: Transcript delta previews do not execute commands
- **WHEN** Qwen emits partial input transcript deltas that match Calendar, Gmail, email, or prototype command phrases
- **THEN** the system may show caption preview but MUST NOT execute native side effects until a final transcript arrives

#### Scenario: Final transcript executes once
- **WHEN** a final transcript contains a deterministic native command
- **THEN** the system executes that command at most once for the turn and suppresses duplicate realtime assistant text while preserving a short voice confirmation

#### Scenario: Runtime diagnostics are visible
- **WHEN** the user opens Qwen Omni settings
- **THEN** the system shows the current voice runtime state, mic stream status, realtime status, input attachment status, audio chunk counts, and latest error when available

#### Scenario: Runtime cache cleanup preserves settings
- **WHEN** the user runs the runtime cache cleanup
- **THEN** the system deletes disposable Electron/Vite cache directories but MUST preserve Local Storage, IndexedDB, API keys, OAuth state, and user settings

### Requirement: Sketch-to-prototype preview
The system SHALL generate a prototype from a captured screen or window image and render it in an AIRI overlay widget.

#### Scenario: Prototype generated
- **WHEN** the user asks AIRI to generate a prototype from a visible sketch or screen
- **THEN** the system captures the selected screen source, asks Qwen Omni for a UI spec and single-page HTML, and opens a sandboxed prototype preview widget

#### Scenario: Prototype generation fails
- **WHEN** Qwen returns malformed content or the screen cannot be captured
- **THEN** the system reports a readable error and does not open a blank preview

### Requirement: Screen-aware email draft
The system SHALL draft an email reply from the current screen context and write the draft into the currently focused text field on macOS only after the user asks.

#### Scenario: Draft pasted into focused Gmail reply
- **WHEN** the user focuses a Gmail reply box and asks AIRI to write the reply
- **THEN** the system captures screen context, generates a reply draft, writes it to the clipboard, and triggers paste into the focused field

#### Scenario: Email is not sent automatically
- **WHEN** an email draft is generated
- **THEN** the system MUST NOT click or trigger Gmail's send action

#### Scenario: Paste fails
- **WHEN** macOS paste automation fails
- **THEN** the system keeps the generated draft in the clipboard and reports the failure to the user

### Requirement: Desktop context inspection
The system SHALL expose a desktop context inspector so the user can verify what AIRI can read before Qwen Omni uses that context.

#### Scenario: Context snapshot captured
- **WHEN** the user refreshes Desktop Context from devtools
- **THEN** the system returns a one-shot snapshot containing enabled sources among active app/window, clipboard text, selected text, mouse position, screen capture permissions, and macOS Accessibility permission state

#### Scenario: Screen frame captured
- **WHEN** the user enables screen frame capture and selects a screen or window source
- **THEN** the inspector captures one JPEG frame and displays source metadata without starting a persistent model upload

#### Scenario: Selected text fallback is explicit
- **WHEN** Accessibility selected text is empty and the user enables Cmd+C fallback
- **THEN** the system may send Cmd+C, restore plain-text clipboard content, and mark the result with a warning

#### Scenario: Qwen-ready payload preview
- **WHEN** a desktop context snapshot exists
- **THEN** the inspector shows a structured payload preview containing text context, pointer context, active window context, screen frame metadata, and warnings

### Requirement: Gmail draft creation
The system SHALL create Gmail drafts through the local authenticated `gog` CLI only after the user explicitly asks AIRI to write or create an email draft.

#### Scenario: Gmail draft created
- **WHEN** the user asks AIRI to create an email draft and provides required recipients, subject, and body intent
- **THEN** the system asks Qwen HTTP for a structured draft plan and creates a Gmail draft through `gog gmail drafts create`

#### Scenario: Gmail draft is not sent
- **WHEN** a Gmail draft command is handled
- **THEN** the system MUST use the no-send Gmail path and MUST NOT send the email

#### Scenario: Gmail draft command is incomplete
- **WHEN** the request lacks a recipient email, subject, or body
- **THEN** the system reports the missing fields instead of creating an incomplete draft

### Requirement: Google Calendar event creation
The system SHALL create Google Calendar events through the local authenticated `gog` CLI after explicit scheduling intent.

#### Scenario: Calendar event created
- **WHEN** the user asks AIRI to add a meeting, appointment, reminder, or schedule item to Calendar
- **THEN** the system asks Qwen HTTP for a structured event plan and creates the event through `gog calendar create`

#### Scenario: Attendee notifications are suppressed
- **WHEN** the system creates, updates, or deletes a Calendar event
- **THEN** the system MUST pass `send-updates none` so attendees are not notified automatically

#### Scenario: Calendar create command is incomplete
- **WHEN** the request lacks a title, date, or start time
- **THEN** the system reports the missing fields instead of creating an ambiguous event

### Requirement: Google Calendar event update
The system SHALL update one existing Google Calendar event through `gog calendar update` after explicit edit intent.

#### Scenario: Recent event updated
- **WHEN** the user asks to edit the event that was just created or referenced
- **THEN** the system uses the stored recent Calendar event context to update the correct event

#### Scenario: Upcoming event updated
- **WHEN** the user asks to edit an upcoming event by title or time and no recent event context is sufficient
- **THEN** the system searches upcoming Calendar candidates and updates the matching event

#### Scenario: Calendar update target is missing
- **WHEN** no target event can be identified
- **THEN** the system reports that it needs the target event instead of updating a guessed event

### Requirement: Google Calendar event deletion
The system SHALL delete one existing Google Calendar event through `gog calendar delete` only when the user explicitly asks and the target event is uniquely identified.

#### Scenario: Calendar event deleted
- **WHEN** the user asks AIRI to delete a clearly identified meeting or Calendar event
- **THEN** the system resolves a single event target and deletes it through `gog calendar delete --force`

#### Scenario: Calendar delete target is ambiguous
- **WHEN** multiple Calendar candidates match the user's deletion request or no candidate matches
- **THEN** the system MUST NOT delete anything and MUST ask for the missing target detail

#### Scenario: Calendar delete confirmation
- **WHEN** the Calendar delete succeeds
- **THEN** AIRI gives a short spoken confirmation without sending attendee notifications
