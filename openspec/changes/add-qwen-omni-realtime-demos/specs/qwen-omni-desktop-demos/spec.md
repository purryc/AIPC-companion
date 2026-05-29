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
