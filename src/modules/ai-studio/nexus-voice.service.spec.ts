import { ForbiddenException } from '@nestjs/common';
import { NexusVoiceService } from './nexus-voice.service';

describe('NexusVoiceService session lifecycle', () => {
  let service: NexusVoiceService;
  const integrations: any = { getElevenLabsConfig: jest.fn() };
  const orchestrator: any = { processMessage: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NexusVoiceService(integrations, orchestrator);
  });

  it('routes only the current user transcript through the existing Nexus orchestrator and streams its reply', async () => {
    const user = { id: 8, customerId: 22, role: 'EMPLOYEE', permissions: ['LEADS:VIEW'] };
    const output: string[] = [];
    const session: any = {
      isOpen: true,
      sendResponse: jest.fn(async (stream: AsyncIterable<string>) => { for await (const chunk of stream) output.push(chunk); }),
    };
    orchestrator.processMessage.mockResolvedValue({ answer: 'There are 18 pending leads.', provider: 'OpenAI' });
    (service as any).sessions.set('voice-1', { user, session, lastActive: Date.now(), controller: new AbortController() });

    await service.handleTranscript('voice-1', [
      { role: 'user', content: 'Show me today’s pending leads.' },
      { role: 'agent', content: 'Yes, I am listening.' },
    ], new AbortController().signal);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(user, 'Show me today’s pending leads.');
    expect(output.join('')).toBe('There are 18 pending leads.');
  });

  it('does not speak an interrupted response', async () => {
    const session: any = { isOpen: true, sendResponse: jest.fn() };
    orchestrator.processMessage.mockResolvedValue({ answer: 'Stale result' });
    (service as any).sessions.set('voice-2', { user: { id: 1, customerId: 1 }, session, lastActive: Date.now(), controller: new AbortController() });
    const controller = new AbortController();
    controller.abort();

    await service.handleTranscript('voice-2', [{ role: 'user', content: 'Cancel the answer' }], controller.signal);

    expect(session.sendResponse).not.toHaveBeenCalled();
  });

  it('aborts pending turn work when a session closes', () => {
    const controller = new AbortController();
    (service as any).sessions.set('voice-3', { user: { id: 1, customerId: 1 }, session: { isOpen: true }, lastActive: Date.now(), controller });

    service.closeSession('voice-3');

    expect(controller.signal.aborted).toBe(true);
    expect((service as any).sessions.has('voice-3')).toBe(false);
  });

  it('rejects a session bind when its one-time binding does not match the authenticated user', async () => {
    (service as any).bindings.set('binding', { user: { id: 4, customerId: 11 }, expiresAt: Date.now() + 1000, used: false });
    await expect(service.bindSession({ id: 4, customerId: 12 }, 'conversation', 'binding')).rejects.toThrow(ForbiddenException);
  });

  it('fails closed when ElevenLabs voice is disabled or unavailable', async () => {
    integrations.getElevenLabsConfig.mockResolvedValue({ isEnabled: false, apiKey: '', speechEngineId: '' });
    await expect(service.getSessionToken({ id: 4, customerId: 12 })).rejects.toThrow('Configure the ElevenLabs API key');

    integrations.getElevenLabsConfig.mockResolvedValue({ isEnabled: false, apiKey: 'key', speechEngineId: '' });
    await expect(service.getSessionToken({ id: 4, customerId: 12 })).rejects.toThrow('ELEVENLABS_SPEECH_ENGINE_ID');

    integrations.getElevenLabsConfig.mockResolvedValue({ isEnabled: false, apiKey: 'key', speechEngineId: 'seng_1' });
    await expect(service.getSessionToken({ id: 4, customerId: 12 })).rejects.toThrow('Enable ElevenLabs');
  });
});
