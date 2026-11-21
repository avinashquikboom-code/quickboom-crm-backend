import { ForbiddenException } from '@nestjs/common';
import { NexusOrchestratorService } from './nexus-orchestrator.service';

describe('NexusOrchestratorService capability and safety boundaries', () => {
  const prisma: any = {
    lead: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    employee: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    attendance: { count: jest.fn(), findMany: jest.fn() },
    leaveRequest: { findMany: jest.fn() },
    task: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    dataCaptureJob: { count: jest.fn(), findMany: jest.fn() },
    dataCapturePlace: { count: jest.fn() },
  };
  const integrations: any = { getOpenAiConfig: jest.fn(), getGeminiConfig: jest.fn() };
  let service: NexusOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NexusOrchestratorService(prisma, integrations);
  });

  it('exposes a verified capability inventory and labels unsupported areas unavailable', () => {
    const registry = service.getCapabilityRegistry();
    expect(registry.nexus.some((item) => item.module === 'CRM' && item.verified)).toBe(true);
    expect(registry.nexus.find((item) => item.module === 'REPORTS')?.access).toBe('UNAVAILABLE');
  });

  it('requires a real module permission before lead searches', async () => {
    await expect((service as any).executeTool('crm_search_leads', {}, { id: 8, customerId: 2, role: 'EMPLOYEE', permissions: [] }, 2, 8, {}))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.lead.count).not.toHaveBeenCalled();
  });

  it('scopes employee lead search to the authenticated user and combines filters safely', async () => {
    prisma.lead.count.mockResolvedValue(1);
    prisma.lead.findMany.mockResolvedValue([{ id: 4, firstName: 'Sam', lastName: 'Lee', status: 'NEW', priority: 'HIGH', value: 0 }]);
    const user = { id: 8, customerId: 2, role: 'EMPLOYEE', permissions: [{ module: 'LEADS', action: 'VIEW' }] };
    await (service as any).executeTool('crm_search_leads', { query: 'Sam', missingPhone: true, source: 'GOOGLE_PLACES' }, user, 2, 8, {});
    expect(prisma.lead.count.mock.calls[0][0].where).toEqual(expect.objectContaining({ customerId: 2, assignedToId: 8, source: expect.any(Object), AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]) }));
  });

  it('does not treat an unrelated turn as confirmation of a pending action', async () => {
    integrations.getOpenAiConfig.mockResolvedValue(null);
    integrations.getGeminiConfig.mockResolvedValue(null);
    const user = { id: 8, customerId: 2, role: 'ADMIN' };
    const session = (service as any).getOrCreateSession(2, 8);
    session.pendingAction = { id: 'action-1', type: 'UPDATE_LEAD_STATUS', title: 'Update a lead', payload: { leadId: 9, status: 'WON' }, summary: {}, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
    const response = await service.processMessage(user, 'Show pending leads');
    expect(response.executedAction).toBeUndefined();
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('uses a configured Gemini model and sends the credential in a header', async () => {
    integrations.getOpenAiConfig.mockResolvedValue(null);
    integrations.getGeminiConfig.mockResolvedValue({ apiKey: 'gemini-secret', model: 'gemini-2.5-flash', isEnabled: true });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Nothing matched.' }] } }] }), { status: 200 }));
    try {
      const session = { history: [{ role: 'user', content: 'find leads' }], lastActive: Date.now() };
      await (service as any).executeWithGemini({ id: 1, customerId: 2, role: 'ADMIN' }, 2, 1, session, 'find leads');
      expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-secret');
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('gemini-secret');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
