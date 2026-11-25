import { ReportService } from './report.service';

describe('catalog PDF pagination', () => {
  const service = new ReportService({} as any);
  const view = { report: { name: 'Report', description: 'Example' }, company: { name: 'Example' }, dateRange: { from: '2026-01-01', to: '2026-01-31' }, generatedAt: '2026-01-31T00:00:00Z', summary: { records: 2 }, columns: ['name'], rows: [{ name: 'First' }] };
  afterEach(() => jest.restoreAllMocks());
  it('fetches later pages before producing a PDF', async () => {
    const run = jest.spyOn(service, 'runCatalogReport').mockResolvedValueOnce(view as any).mockResolvedValueOnce({ ...view, rows: [{ name: 'Second' }] } as any);
    const result = await service.buildPdf(1, 'example', {});
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][2]).toMatchObject({ page: 2, limit: 500 });
  });
  it('fails instead of silently exporting an incomplete report', async () => {
    jest.spyOn(service, 'runCatalogReport').mockResolvedValueOnce(view as any).mockResolvedValueOnce({ ...view, rows: [] } as any);
    await expect(service.buildPdf(1, 'example', {})).rejects.toThrow('Unable to export all report records');
  });
});
