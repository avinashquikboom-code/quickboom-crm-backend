# QB Nexus ElevenLabs voice setup

ElevenLabs handles speech recognition and speech synthesis only. Voice transcripts reach `NexusOrchestratorService`, which continues to use OpenAI first, Gemini as fallback, and the existing tenant, permission, and action-confirmation checks.

## Configuration

1. Create a **Speech Engine** resource in ElevenLabs. Do not create or attach an ElevenLabs Agent.
2. In QB Suite Admin → Settings → Integrations, configure **ElevenLabs Speech Engine** with the server API key, Speech Engine ID, and optional default voice ID. The API key is encrypted and masked by the existing integration settings service. Alternatively configure `ELEVENLABS_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, and `ELEVENLABS_VOICE_ID` in the backend environment.
3. Set `ELEVENLABS_SPEECH_ENGINE_PORT` (default `3101`). The backend starts the official SDK callback server when a voice session is requested.
4. Configure the Speech Engine callback to a public `wss://` URL reverse-proxied to the backend callback server. The callback path is owned by the ElevenLabs Speech Engine configuration; route the WebSocket upgrade to port 3101 without buffering or terminating it. Keep SDK authorization enabled.
5. If the deployment runs multiple backend replicas, use sticky routing so the authenticated token request, session bind request, and callback WebSocket reach the same replica. The short-lived binding and WebSocket session state are held in process memory.
6. Configure the Speech Engine for the desired supported transcription languages. QB Nexus sends the selected English, Hindi, or Marathi language to the session, and applies the selected configured voice for speech output.

Only an explicit microphone-button click requests a token and starts the browser WebRTC session. Closing the chat, logging out, or hiding the tab ends the session. The application does not persist microphone audio.

## Browser and networking requirements

Use HTTPS so WebRTC microphone access is available. Browsers must support `getUserMedia`, `RTCPeerConnection`, and WebRTC. When unsupported or permission is denied, the voice UI reports the issue and normal text chat remains available. The ElevenLabs callback server must be reachable from ElevenLabs over WSS; opening the backend's HTTP API alone is not sufficient.
