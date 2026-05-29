## ADDED Requirements

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
