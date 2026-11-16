import { LeadService } from './lead.service';

describe('stage template mapping validation', () => {
  const stage = { id: 43, customerId: 3 };
  let repo: any, prisma: any, service: LeadService;
  beforeEach(() => {
    repo = { findStageById: jest.fn().mockResolvedValue(stage), updateStage: jest.fn().mockResolvedValue(stage), createStage: jest.fn() };
    prisma = { emailTemplate: { findFirst: jest.fn().mockResolvedValue({ isActive: true }) },
      metaTemplate: { findFirst: jest.fn().mockResolvedValue({ isLocalActive: true, status: 'APPROVED', metaTemplateId: 'meta-1' }) } };
    service = new LeadService(repo, prisma);
  });
  it('validates both templates with tenant scope before updating', async () => {
    await service.updateStage(3, {}, 43, { emailTemplateId: 1, whatsappTemplateId: 2 });
    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 1, OR: [{ customerId: 3 }, { customerId: null }] }) }));
    expect(prisma.metaTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 2, OR: [{ customerId: 3 }, { customerId: null }] }) }));
    expect(repo.updateStage).toHaveBeenCalled();
  });
  it('rejects a stage owned by another tenant before updating', async () => {
    await expect(service.updateStage(4, {}, 43, { emailTemplateId: 1 })).rejects.toThrow('another workspace');
    expect(repo.updateStage).not.toHaveBeenCalled();
  });
  it('rejects inactive email and unapproved WhatsApp mappings', async () => {
    prisma.emailTemplate.findFirst.mockResolvedValueOnce({ isActive: false });
    await expect(service.updateStage(3, {}, 43, { emailTemplateId: 1 })).rejects.toThrow('inactive');
    prisma.metaTemplate.findFirst.mockResolvedValueOnce({ isLocalActive: true, status: 'PENDING', metaTemplateId: 'meta-1' });
    await expect(service.updateStage(3, {}, 43, { whatsappTemplateId: 2 })).rejects.toThrow('unapproved');
    expect(repo.updateStage).not.toHaveBeenCalled();
  });
  it('does not let tenant administrators modify a shared stage', async () => {
    repo.findStageById.mockResolvedValueOnce({ id: 44, customerId: null });
    await expect(service.updateStage(3, {}, 44, { whatsappTemplateId: 2 })).rejects.toThrow('shared stage');
  });
});
