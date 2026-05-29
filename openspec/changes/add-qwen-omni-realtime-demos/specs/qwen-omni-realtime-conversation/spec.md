## ADDED Requirements

### Requirement: Desktop Qwen Omni configuration
The system SHALL let desktop users configure one DashScope API key for Qwen Omni, including region, HTTP model, realtime model, voice, and server VAD parameters.

#### Scenario: Configure Singapore endpoint
- **WHEN** the user selects the Singapore region and saves a DashScope API key
- **THEN** the system uses DashScope international HTTP and realtime endpoints for Qwen Omni calls

#### Scenario: Configure Beijing endpoint
- **WHEN** the user selects the Beijing region
- **THEN** the system uses DashScope China HTTP and realtime endpoints for Qwen Omni calls

### Requirement: Realtime conversation mode
The system SHALL provide a `qwen-omni` conversation mode that uses Qwen3.5-Omni Realtime for desktop voice turns instead of the classic STT/chat/TTS chain.

#### Scenario: Voice turn completes
- **WHEN** the user speaks with `qwen-omni` mode enabled
- **THEN** the system appends the final input transcript and assistant text to the active chat session and plays Qwen audio output

#### Scenario: User interrupts assistant
- **WHEN** Qwen emits speech-started while assistant audio is playing
- **THEN** the system cancels current playback and prepares for the new user turn

#### Scenario: Native command interrupts realtime response
- **WHEN** an input transcript matches a supported native action command
- **THEN** the system cancels the normal realtime response and runs the deterministic command workflow instead

#### Scenario: Duplicate text deltas are received
- **WHEN** Qwen emits incremental assistant text and later emits the final transcript for the same response
- **THEN** the system SHALL avoid appending duplicate assistant text to the active stream

### Requirement: Desktop companion dialogue bubble
The system SHALL show AIRI's current assistant reply in one RPG-style dialogue bubble on the desktop overlay.

#### Scenario: Assistant reply streams
- **WHEN** Qwen realtime text deltas arrive while AIRI is visible on the desktop overlay
- **THEN** the system updates one dialogue bubble near AIRI instead of creating multiple separate desktop text fragments

#### Scenario: Native action confirmation speaks
- **WHEN** a supported Gmail or Calendar native action succeeds
- **THEN** AIRI speaks a short fixed confirmation and suppresses duplicate text output for that confirmation turn

### Requirement: Classic provider fallback
The system SHALL keep existing Chat, Hearing, Speech, and Vision providers available and unchanged when conversation mode is `classic`.

#### Scenario: Classic mode enabled
- **WHEN** the user selects `classic` mode
- **THEN** the desktop voice path uses the existing Hearing transcription and Stage TTS behavior
