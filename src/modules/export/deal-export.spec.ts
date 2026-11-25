import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from './export.service';

describe('deal export assignment', () => {
  it('exports the assigned user and handles unassigned deals', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 1, title: 'Assigned deal', company: { name: 'Example' }, contact: null, stage: { name: 'Won' }, assignedTo: { firstName: 'Asha', lastName: 'Patel' }, amount: 100, expectedClosing: null, createdAt: new Date('2026-01-01') },
      { id: 2, title: 'Unassigned deal', company: null, contact: null, stage: { name: 'Open' }, assignedTo: null, amount: 200, expectedClosing: null, createdAt: new Date('2026-01-02') },
    ]);
    const module = await Test.createTestingModule({ providers: [ExportService, { provide: PrismaService, useValue: { deal: { findMany } } }] }).compile();
    const service = module.get(ExportService);
    const result = await service.generateExport({ module: 'deals', format: 'csv' }, { role: 'SUPER_ADMIN', id: 1 });
    const csv = result.buffer.toString('utf8');
    expect(csv).toContain('Asha Patel');
    expect(csv).toContain('Unassigned');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ assignedTo: { select: { firstName: true, lastName: true } } }) }));
  });
});
