import { BadRequestException } from '@nestjs/common';
import { CouponService } from './coupon.service';

describe('CouponService admin listing and statistics', () => {
  const coupon = {
    count: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
  };
  let service: CouponService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CouponService({ coupon } as any);
  });

  it('returns mutually exclusive actual coupon status counts and redemption totals', async () => {
    coupon.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    coupon.aggregate.mockResolvedValue({ _sum: { timesRedeemed: 17 } });

    const result = await service.stats();
    const [totalWhere, activeWhere, inactiveWhere, expiredWhere, scheduledWhere] = coupon.count.mock.calls.map(([arg]) => arg.where);

    expect(result).toEqual({ total: 8, active: 2, inactive: 3, expired: 2, scheduled: 1, used: 17, totalRedemptions: 17 });
    expect(totalWhere).toEqual({ deletedAt: null });
    expect(activeWhere.isActive).toBe(true);
    expect(inactiveWhere.isActive).toBe(false);
    expect(expiredWhere.expiresAt).toHaveProperty('lt');
    expect(scheduledWhere.startsAt).toHaveProperty('gt');
    expect(coupon.aggregate).toHaveBeenCalledWith({ where: { deletedAt: null }, _sum: { timesRedeemed: true } });
  });

  it('returns an empty page with accurate metadata and default latest-first sorting', async () => {
    coupon.count.mockResolvedValue(0);
    coupon.findMany.mockResolvedValue([]);

    const result = await service.list({ page: '1', limit: '10', sortBy: 'createdAt', sortOrder: 'desc' });

    expect(result).toMatchObject({ data: [], items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
    expect(coupon.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 10 }));
  });

  it('applies search, filters, sorting, and pagination to database queries', async () => {
    coupon.count.mockResolvedValue(1);
    coupon.findMany.mockResolvedValue([{ id: 1, code: 'SPRING', discountType: 'FIXED', plans: [] }]);

    const result = await service.list({
      page: '2', limit: '5', sortBy: 'code', sortOrder: 'asc', search: 'spring', status: 'ACTIVE', discountType: 'FIXED',
    });
    const findManyArgs = coupon.findMany.mock.calls[0][0];

    expect(findManyArgs.where.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expect.objectContaining({ contains: 'spring' }) }),
    ]));
    expect(findManyArgs.where.isActive).toBe(true);
    expect(findManyArgs.where.discountType).toBe('FIXED');
    expect(findManyArgs.orderBy).toEqual({ code: 'asc' });
    expect(findManyArgs.skip).toBe(5);
    expect(findManyArgs.take).toBe(5);
    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
  });

  it.each([
    [{ page: '0' }, 'page must be a positive integer'],
    [{ limit: '101' }, 'limit cannot exceed 100'],
    [{ sortBy: 'password' }, 'Invalid coupon sortBy field'],
    [{ sortOrder: 'sideways' }, 'sortOrder must be asc or desc'],
    [{ status: 'SUPERADMIN' }, 'Invalid coupon status filter'],
    [{ discountType: 'SCRIPT' }, 'Invalid coupon discount type filter'],
  ])('rejects invalid query parameters %#', async (query, message) => {
    await expect(service.list(query as any)).rejects.toThrow(new BadRequestException(message));
    expect(coupon.count).not.toHaveBeenCalled();
    expect(coupon.findMany).not.toHaveBeenCalled();
  });
});
