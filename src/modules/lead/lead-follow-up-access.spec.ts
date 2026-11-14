import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

describe('follow-up lead access', () => {
  const dto = { outcome: 'Scheduled', schedule: true };
  const owner = { id: 21, employeeId: 31, role: 'EMPLOYEE', customerId: 7 };
  const other = { id: 22, employeeId: 32, role: 'EMPLOYEE', customerId: 7 };
  const lead = { id: 1, customerId: 7, employeeId: 31, assignedToId: 21, visits: [] };
  let repository: any;
  let service: LeadService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(async (tenant: number) => tenant === 7 ? lead : null),
      isVisitorUser: jest.fn().mockResolvedValue(false),
      logFollowUp: jest.fn().mockResolvedValue(lead),
    };
    service = new LeadService(repository, {} as any);
  });

  it('passes the authenticated actor from the controller to the service', async () => {
    const mockService = { logFollowUp: jest.fn().mockResolvedValue(lead) };
    const controller = new LeadController(mockService as any);
    await controller.logFollowUp('7', '1', '21', dto, owner);
    expect(mockService.logFollowUp).toHaveBeenCalledWith('7', '1', '21', dto, owner);
  });

  it('allows an owner and denies an unassigned employee before any write', async () => {
    await expect(service.logFollowUp(7, 1, 21, dto, owner)).resolves.toEqual(lead);
    expect(repository.logFollowUp).toHaveBeenCalledTimes(1);
    repository.logFollowUp.mockClear();
    await expect(service.logFollowUp(7, 1, 22, dto, other)).rejects.toThrow(ForbiddenException);
    expect(repository.logFollowUp).not.toHaveBeenCalled();
  });

  it('denies a different tenant and a missing actor before any write', async () => {
    await expect(service.logFollowUp(8, 1, 21, dto, owner)).rejects.toThrow(NotFoundException);
    await expect(service.logFollowUp(7, 1, 21, dto, null)).rejects.toThrow(ForbiddenException);
    expect(repository.logFollowUp).not.toHaveBeenCalled();
  });
});
