import { Test, TestingModule } from '@nestjs/testing';
import { DataManagementController } from './data-management.controller';
import { DataManagementService } from './data-management.service';
import { DataGovernanceService } from './data-governance.service';
import { ResetPreviewDto } from './dto/data-management.dto';

describe('DataManagementController reset/preview', () => {
  let controller: DataManagementController;
  let governanceService: jest.Mocked<Partial<DataGovernanceService>>;

  beforeEach(() => {
    governanceService = {
      previewReset: jest.fn().mockResolvedValue({
        previewToken: 'test-preview-token',
        expiresAt: '2026-11-19T14:00:00.000Z',
        scope: 'tenant',
        modules: [{ id: 'employees', name: 'Employees', records: 5, totalRecords: 5, preservedRecords: 0 }],
        tables: [{ model: 'employee', label: 'Employees', records: 5 }],
        estimatedRecords: 5,
        totalEligibleRecords: 5,
        totalPreservedRecords: 0,
        preservation: [],
        protectedCounts: {},
        dependencies: [],
        dependencyWarnings: [],
        protected: [],
      }),
    };

    controller = new DataManagementController(
      {} as unknown as DataManagementService,
      governanceService as unknown as DataGovernanceService,
    );
  });

  it('supports GET reset/preview and delegates cleanly to DataGovernanceService', async () => {
    const dto: ResetPreviewDto = {
      modules: ['employees'],
      scope: 'selected',
    };

    const response = await controller.previewResetGet('1', dto);

    expect(governanceService.previewReset).toHaveBeenCalledWith('1', dto);
    expect(response).toMatchObject({
      previewToken: 'test-preview-token',
      scope: 'tenant',
      estimatedRecords: 5,
    });
  });

  it('supports POST reset/preview and delegates cleanly to DataGovernanceService', async () => {
    const dto: ResetPreviewDto = {
      modules: ['employees'],
      scope: 'selected',
    };

    const response = await controller.previewReset('1', dto);

    expect(governanceService.previewReset).toHaveBeenCalledWith('1', dto);
    expect(response).toMatchObject({
      previewToken: 'test-preview-token',
      scope: 'tenant',
      estimatedRecords: 5,
    });
  });
});
