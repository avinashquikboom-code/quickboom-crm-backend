import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ElevenLabsClient, SpeechEngine, type SpeechEngineSession } from '@elevenlabs/elevenlabs-js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { NexusOrchestratorService } from './nexus-orchestrator.service';

type VoiceBinding = { user: any; expiresAt: number; used: boolean };
type VoiceSession = { user: any; session: SpeechEngineSession; lastActive: number; controller: AbortController };

@Injectable()
export class NexusVoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(NexusVoiceService.name);
  private readonly bindings = new Map<string, VoiceBinding>();
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly pendingSessions = new Map<string, { session: SpeechEngineSession; expiresAt: number }>();

  constructor(
    private readonly integrations: IntegrationSettingsService,
    private readonly orchestrator: NexusOrchestratorService,
  ) {}

  async getSettings() {
    const config = await this.integrations.getElevenLabsConfig();
    return { available: config.isEnabled, enabled: config.isEnabled, voiceId: config.voiceId || '', languages: ['en', 'hi', 'mr', 'gu'] };
  }

  async getVoices() {
    const config = await this.integrations.getElevenLabsConfig();
    if (!config.isEnabled) return { voices: [], voiceId: config.voiceId || '' };
    try {
      const client = new ElevenLabsClient({ apiKey: config.apiKey });
      const response = await client.voices.getAll();
      return {
        voiceId: config.voiceId || '',
        voices: (response.voices || []).map((voice: any) => ({ id: voice.voiceId || voice.voice_id, name: voice.name, category: voice.category || '', labels: voice.labels || {} }))
          .filter((voice: any) => voice.id && voice.name),
      };
    } catch (error: any) {
      this.logger.warn(`[NEXUS_VOICE_LIST_FAILED] ${error?.name || 'Error'}`);
      throw new BadRequestException('Could not load ElevenLabs voices. Check the Speech Engine configuration.');
    }
  }

  async getSessionToken(user: any) {
    const customerId = Number(user?.customerId);
    const userId = Number(user?.id);
    if (!Number.isInteger(customerId) || customerId < 1 || !Number.isInteger(userId) || userId < 1) {
      throw new ForbiddenException('Your account is not scoped to a QB Suite business.');
    }
    const config = await this.integrations.getElevenLabsConfig();
    if (!config.isEnabled) throw new BadRequestException('ElevenLabs voice is not configured or enabled. Text chat remains available.');
    await this.startSpeechEngineBridge(config.apiKey);
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    try {
      const token = await client.conversationalAi.conversations.getWebrtcToken({ agentId: config.speechEngineId, participantName: `qb-${customerId}-${userId}` });
      if (!token?.token) throw new Error('No temporary token received.');
      const bindingId = randomBytes(24).toString('base64url');
      const now = Date.now();
      for (const [id, binding] of this.bindings) if (binding.expiresAt < now) this.bindings.delete(id);
      this.bindings.set(bindingId, { user, expiresAt: Date.now() + 60_000, used: false });
      return { token: token.token, bindingId, voiceId: config.voiceId || null };
    } catch (error: any) {
      this.logger.warn(`[NEXUS_VOICE_TOKEN_FAILED] ${error?.name || 'Error'}`);
      throw new BadRequestException('Could not start the ElevenLabs voice session. Check the Speech Engine settings and try again.');
    }
  }

  async bindSession(user: any, conversationId: string, bindingId: string) {
    const id = String(conversationId || '').trim();
    const bindingKey = String(bindingId || '').trim();
    if (!id || id.length > 160 || !bindingKey || bindingKey.length > 100) throw new BadRequestException('A valid voice session is required.');
    const binding = this.bindings.get(bindingKey);
    this.bindings.delete(bindingKey);
    if (!binding || binding.used || binding.expiresAt < Date.now() || Number(binding.user?.id) !== Number(user?.id) || Number(binding.user?.customerId) !== Number(user?.customerId)) {
      throw new ForbiddenException('Voice session authorization expired. Start voice again.');
    }
    binding.used = true;
    const config = await this.integrations.getElevenLabsConfig();
    const pending = this.pendingSessions.get(id);
    if (pending && pending.expiresAt >= Date.now()) {
      this.pendingSessions.delete(id);
      this.attachBoundSession(id, user, pending.session);
    } else {
      this.sessions.set(id, { user, session: null as any, lastActive: Date.now(), controller: new AbortController() });
    }
    if (config.isEnabled) await this.startSpeechEngineBridge(config.apiKey);
    return { bound: true };
  }

  attachSession(conversationId: string, session: SpeechEngineSession) {
    const state = this.sessions.get(conversationId);
    if (!state) {
      // ElevenLabs opens the callback socket before the browser receives its conversation ID.
      // Hold it briefly until the authenticated browser binds its one-time token to this ID.
      this.pendingSessions.set(conversationId, { session, expiresAt: Date.now() + 60_000 });
      const timer = setTimeout(() => {
        const pending = this.pendingSessions.get(conversationId);
        if (pending?.session === session) {
          this.pendingSessions.delete(conversationId);
          session.close();
        }
      }, 60_000);
      timer.unref?.();
      return;
    }
    if (state.lastActive < Date.now() - 5 * 60_000) { session.close(); return; }
    this.attachBoundSession(conversationId, state.user, session);
  }

  private attachBoundSession(conversationId: string, user: any, session: SpeechEngineSession) {
    const current = this.sessions.get(conversationId);
    current?.controller.abort();
    const state: VoiceSession = { user, session, lastActive: Date.now(), controller: new AbortController() };
    this.sessions.set(conversationId, state);
    session.once('close', () => this.closeSession(conversationId));
    session.once('disconnected', () => this.closeSession(conversationId));
    session.once('error', () => this.closeSession(conversationId));
    session.on(SpeechEngine.USER_TRANSCRIPT, (transcript, signal) => {
      const turn = new AbortController();
      const abortTurn = () => turn.abort();
      if (state.controller.signal.aborted || signal.aborted) turn.abort();
      state.controller.signal.addEventListener('abort', abortTurn, { once: true });
      signal.addEventListener('abort', abortTurn, { once: true });
      void this.handleTranscript(conversationId, transcript, turn.signal).finally(() => {
        state.controller.signal.removeEventListener('abort', abortTurn);
        signal.removeEventListener('abort', abortTurn);
      });
    });
  }

  async handleTranscript(conversationId: string, transcript: Array<{ role?: string; content?: string }>, signal: AbortSignal) {
    const state = this.sessions.get(conversationId);
    if (!state?.session?.isOpen) return;
    state.lastActive = Date.now();
    const current = [...(transcript || [])].reverse().find((item) => item.role === 'user')?.content?.trim();
    if (!current || current.length > 1200) return;
    try {
      const result = await this.orchestrator.processMessage(state.user, current);
      if (signal.aborted || !state.session?.isOpen) return;
      await state.session.sendResponse(this.streamSpeech(result.answer, signal));
    } catch (error: any) {
      if (signal.aborted || !state.session?.isOpen) return;
      const status = typeof error?.getStatus === 'function' ? error.getStatus() : error?.status;
      await state.session.sendResponse(this.streamSpeech(status === 403 ? 'You do not have permission to access that information.' : 'I could not complete that request. Please try again.', signal));
    }
  }

  private async *streamSpeech(text: string, signal: AbortSignal): AsyncIterable<string> {
    const chunks = String(text || '').match(/.{1,96}(?:\s|$)/g) || [String(text || '')];
    for (const chunk of chunks) {
      if (signal.aborted) return;
      yield chunk;
    }
  }

  closeSession(conversationId: string) {
    const state = this.sessions.get(conversationId);
    state?.controller.abort();
    this.sessions.delete(conversationId);
    const pending = this.pendingSessions.get(conversationId);
    pending?.session.close();
    this.pendingSessions.delete(conversationId);
  }

  private bridgeStarted = false;
  private bridgeApiKey = '';
  private async startSpeechEngineBridge(apiKey: string) {
    if (this.bridgeStarted && this.bridgeApiKey === apiKey) return;
    if (this.server) {
      await this.server.stop().catch(() => undefined);
      this.server = null;
      this.bridgeStarted = false;
    }
    const config = await this.integrations.getElevenLabsConfig();
    const server = new SpeechEngine.Server({
      apiKey,
      port: Number(config.speechEnginePort || process.env.ELEVENLABS_SPEECH_ENGINE_PORT || 3101),
      onInit: (conversationId, session) => this.attachSession(conversationId, session),
      onClose: (session) => { if (session.conversationId) this.closeSession(session.conversationId); },
      onDisconnect: (session) => { if (session.conversationId) this.closeSession(session.conversationId); },
      onError: (_error, session) => { if (session.conversationId) this.closeSession(session.conversationId); },
    });
    try {
      server.start();
      this.server = server;
      this.bridgeApiKey = apiKey;
      this.bridgeStarted = true;
    } catch (error: any) {
      this.bridgeStarted = false;
      this.bridgeApiKey = '';
      this.logger.error(`[NEXUS_VOICE_BRIDGE_FAILED] ${error?.name || 'Error'}`);
      throw new BadRequestException('Could not start the ElevenLabs callback server. Check the configured port and network.');
    }
  }

  private server: InstanceType<typeof SpeechEngine.Server> | null = null;

  async testVoice(user: any, text: string, voiceId?: string) {
    const customerId = Number(user?.customerId);
    if (!Number.isInteger(customerId) || customerId < 1 || !Number.isInteger(Number(user?.id)) || Number(user.id) < 1) throw new ForbiddenException();
    const sample = String(text || 'Hello! This is QB Nexus voice test.').trim().slice(0, 240);
    if (!sample) throw new BadRequestException('Enter a short sample to test the voice.');
    const config = await this.integrations.getElevenLabsConfig();
    if (!config.isEnabled) throw new BadRequestException('ElevenLabs voice is not configured or enabled.');
    const selected = String(voiceId || config.voiceId || '').trim();
    if (!selected) throw new BadRequestException('Select a voice before testing.');
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    try {
      const response = await client.textToSpeech.convert(selected, { text: sample, modelId: config.modelId, outputFormat: 'mp3_22050_32' });
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) { size += value.byteLength; if (size > 4 * 1024 * 1024) throw new BadRequestException('Voice preview is too large.'); chunks.push(value); }
        }
      } finally { reader.releaseLock(); }
      const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('base64');
      return { audio: `data:audio/mpeg;base64,${audio}` };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`[NEXUS_VOICE_TEST_FAILED] ${error?.name || 'Error'}`);
      throw new BadRequestException('ElevenLabs could not generate the voice preview. Check the selected voice and configuration.');
    }
  }

  async speakText(user: any, text: string, voiceId?: string, speed?: number) {
    const customerId = Number(user?.customerId);
    if (!Number.isInteger(customerId) || customerId < 1 || !Number.isInteger(Number(user?.id)) || Number(user.id) < 1) {
      throw new ForbiddenException();
    }
    const content = String(text || '').trim().slice(0, 2000);
    if (!content) throw new BadRequestException('Text is required for speech synthesis.');
    const config = await this.integrations.getElevenLabsConfig();
    if (!config.isEnabled || !config.apiKey) {
      return { success: false, fallback: true, message: 'ElevenLabs voice is not configured or enabled.' };
    }
    const selected = String(voiceId || config.voiceId || '').trim();
    if (!selected) return { success: false, fallback: false, message: 'Choose an ElevenLabs voice in QB Nexus settings first.' };
    const voiceSpeed = Number.isFinite(Number(speed)) ? Math.max(0.7, Math.min(1.2, Number(speed))) : 1;
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    try {
      const response = await client.textToSpeech.convert(selected, {
        text: content,
        modelId: config.modelId || 'eleven_multilingual_v2',
        outputFormat: 'mp3_22050_32',
        voiceSettings: { speed: voiceSpeed },
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            size += value.byteLength;
            if (size > 10 * 1024 * 1024) break;
            chunks.push(value);
          }
        }
      } finally {
        reader.releaseLock();
      }
      const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('base64');
      return { success: true, audio: `data:audio/mpeg;base64,${audio}` };
    } catch (error: any) {
      this.logger.warn(`[NEXUS_VOICE_SPEAK_FAILED] ${error?.name || 'Error'}`);
      return { success: false, fallback: false, message: 'ElevenLabs synthesis failed. Check the selected voice and configuration.' };
    }
  }

  onModuleDestroy() {
    for (const id of this.sessions.keys()) this.closeSession(id);
    this.bindings.clear();
    for (const pending of this.pendingSessions.values()) pending.session.close();
    this.pendingSessions.clear();
    void this.server?.stop();
  }
}

export function createElevenLabsSessionServer(apiKey: string) {
  return new SpeechEngine.Server({ apiKey, port: Number(process.env.ELEVENLABS_SPEECH_ENGINE_PORT || 3101) });
}

