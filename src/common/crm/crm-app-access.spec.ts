import { ForbiddenException } from '@nestjs/common';
import { assertCrmAppEmployee, CRM_APP_ACCESS_DENIED } from './crm-app-access';

describe('assertCrmAppEmployee', () => {
  function prismaFor(employee: any) {
    return { employee: { findFirst: jest.fn().mockResolvedValue(employee) } };
  }

  it('allows an active BPO employee from the department record', async () => {
    await expect(assertCrmAppEmployee(prismaFor({
      id: 4,
      status: 'ACTIVE',
      mobileLoginEnabled: true,
      department: { name: 'BPO', code: 'BPO' },
      designation: { name: 'Executive', code: 'EXE' },
      teamMembers: [],
      ledTeams: [],
    }), { id: 9 })).resolves.toBe('BPO');
  });

  it('allows an active sales employee to open assigned leads', async () => {
    await expect(assertCrmAppEmployee(prismaFor({
      id: 6,
      status: 'ACTIVE',
      mobileLoginEnabled: true,
      department: { name: 'Sales', code: 'SALES' },
      designation: { name: 'Sales Executive', code: 'SALES' },
      teamMembers: [],
      ledTeams: [],
    }), { id: 11 })).resolves.toBe('SALES');
  });

  it('allows an active Visitor employee from the team record', async () => {
    await expect(assertCrmAppEmployee(prismaFor({
      id: 5,
      status: 'ACTIVE',
      department: { name: 'Field', code: 'FIELD' },
      designation: { name: 'Executive', code: 'EXE' },
      teamMembers: [{ team: { name: 'Visitor Team', code: 'VISITOR' } }],
      ledTeams: [],
    }), { id: 10 })).resolves.toBe('VISITOR');
  });

  it.each([
    ['production', { status: 'ACTIVE', department: { name: 'Production', code: 'PROD' }, designation: { name: 'Editor' }, teamMembers: [{ team: { name: 'Production' } }], ledTeams: [] }],
    ['customer without employee', null],
    ['inactive bpo', { status: 'INACTIVE', department: { name: 'BPO', code: 'BPO' }, designation: { name: 'Executive' }, teamMembers: [], ledTeams: [] }],
  ])('blocks %s', async (_label, employee) => {
    await expect(assertCrmAppEmployee(prismaFor(employee), { id: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertCrmAppEmployee(prismaFor(employee), { id: 1 })).rejects.toThrow(CRM_APP_ACCESS_DENIED);
  });
});
