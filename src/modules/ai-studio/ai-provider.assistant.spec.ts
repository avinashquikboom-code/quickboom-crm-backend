import { AiProviderService } from './ai-provider.service';

describe('AiProviderService - QB Nexus providers', () => {
  const integrationSettings = {
    getOpenAiConfig: jest.fn(),
    getGeminiConfig: jest.fn(),
  };
  let provider: AiProviderService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    integrationSettings.getOpenAiConfig.mockResolvedValue({ apiKey: 'openai-secret', isEnabled: true });
    integrationSettings.getGeminiConfig.mockResolvedValue({ apiKey: 'gemini-secret', isEnabled: true });
    provider = new AiProviderService({} as any, integrationSettings as any);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('uses OpenAI as primary and only calls Gemini after an OpenAI provider failure', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'There are 4 authorized leads.' }] } }] }), { status: 200 }));

    const result = await provider.answerAssistant('How many leads?', { count: 4 }, [], { primaryProvider: 'OPENAI', fallbackProvider: 'GEMINI' });

    expect(result).toEqual({ answer: 'There are 4 authorized leads.', provider: 'GEMINI' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(fetchSpy.mock.calls[1][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect((fetchSpy.mock.calls[1][1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-secret');
    expect(String(fetchSpy.mock.calls[1][0])).not.toContain('gemini-secret');
  });

  it('maintains provider conversation context and returns the actual primary provider', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'They are assigned to you.' } }] }), { status: 200 }));
    const result = await provider.answerAssistant('Who are they?', { leads: [{ id: 9 }] }, [{ role: 'user', content: 'Show my leads.' }], { primaryProvider: 'OPENAI', fallbackProvider: 'DISABLED' });
    const request = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Show my leads.' }),
      expect.objectContaining({ role: 'user', content: 'Who are they?' }),
    ]));
    expect(result).toEqual({ answer: 'They are assigned to you.', provider: 'OPENAI' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports only non-secret provider readiness', async () => {
    const status = await provider.getAssistantProviderStatus();
    expect(status.OPENAI).toEqual({ configured: true, enabled: true, model: 'gpt-4o-mini' });
    expect(status.GEMINI).toEqual({ configured: true, enabled: true, model: 'gemini-2.5-flash' });
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('uses Gemini for manual audio transcription when selected', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'show pending leads' }] } }] }), { status: 200 }));
    const transcript = await provider.transcribeAssistantAudio(Buffer.from('audio'), 'audio/webm', { primaryProvider: 'GEMINI', fallbackProvider: 'OPENAI' });
    const request = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(transcript).toBe('show pending leads');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(request.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/webm', data: Buffer.from('audio').toString('base64') });
  });
});
