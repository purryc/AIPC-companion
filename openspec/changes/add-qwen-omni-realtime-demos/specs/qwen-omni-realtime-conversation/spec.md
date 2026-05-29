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

### Requirement: Classic provider fallback
The system SHALL keep existing Chat, Hearing, Speech, and Vision providers available and unchanged when conversation mode is `classic`.

#### Scenario: Classic mode enabled
- **WHEN** the user selects `classic` mode
- **THEN** the desktop voice path uses the existing Hearing transcription and Stage TTS behavior
