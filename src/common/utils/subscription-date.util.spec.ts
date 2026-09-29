import {
  calculateSubscriptionStartDate,
  calculatePlanExpiry,
  calculateSubscriptionDates,
  calculateDaysRemaining,
  deriveSubscriptionStatus,
  resolvePlanSubscriptionDates,
} from './subscription-date.util';

describe('Subscription Date Calculation & Edge Cases', () => {
  describe('calculateSubscriptionStartDate (purchaseDate + 2 calendar days)', () => {
    it('should start on 3 Sep for purchase on 1 Sep', () => {
      const purchase = new Date('2026-09-01T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(3);
      expect(start.getUTCMonth()).toBe(8); // September (0-indexed 8)
      expect(start.getUTCFullYear()).toBe(2026);
    });

    it('should start on 17 Sep for purchase on 15 Sep', () => {
      const purchase = new Date('2026-09-15T12:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(17);
      expect(start.getUTCMonth()).toBe(8);
      expect(start.getUTCFullYear()).toBe(2026);
    });

    it('should start on 27 Sep for purchase on 25 Sep', () => {
      const purchase = new Date('2026-09-25T14:30:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(27);
      expect(start.getUTCMonth()).toBe(8);
    });

    it('should roll over into 1 Feb for purchase on 30 Jan', () => {
      const purchase = new Date('2026-01-30T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(1);
      expect(start.getUTCMonth()).toBe(1); // February (0-indexed 1)
      expect(start.getUTCFullYear()).toBe(2026);
    });

    it('should roll over into 2 Feb for purchase on 31 Jan', () => {
      const purchase = new Date('2026-01-31T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(2);
      expect(start.getUTCMonth()).toBe(1); // February
    });

    it('should roll over into 2 Mar for purchase on 28 Feb (non-leap year 2026)', () => {
      const purchase = new Date('2026-02-28T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(2);
      expect(start.getUTCMonth()).toBe(2); // March (0-indexed 2)
    });

    it('should roll over into 1 Mar for purchase on 28 Feb (leap year 2024)', () => {
      const purchase = new Date('2024-02-28T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(1);
      expect(start.getUTCMonth()).toBe(2); // March
      expect(start.getUTCFullYear()).toBe(2024);
    });

    it('should roll over into 2 Mar for purchase on 29 Feb (leap year 2024)', () => {
      const purchase = new Date('2024-02-29T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(2);
      expect(start.getUTCMonth()).toBe(2); // March
    });

    it('should roll over into 1 Jan next year for purchase on 30 Dec', () => {
      const purchase = new Date('2026-12-30T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(1);
      expect(start.getUTCMonth()).toBe(0); // January
      expect(start.getUTCFullYear()).toBe(2027);
    });

    it('should roll over into 2 Jan next year for purchase on 31 Dec', () => {
      const purchase = new Date('2026-12-31T10:00:00.000Z');
      const start = calculateSubscriptionStartDate(purchase);
      expect(start.getUTCDate()).toBe(2);
      expect(start.getUTCMonth()).toBe(0); // January
      expect(start.getUTCFullYear()).toBe(2027);
    });
  });

  describe('resolvePlanSubscriptionDates (calendar vs default +2)', () => {
    it('purchase 1 Oct with activation same day -> start 3 Oct', () => {
      const purchase = new Date('2026-10-01T14:00:00.000Z');
      const { startDate } = resolvePlanSubscriptionDates(purchase, 1, '2026-10-01');
      expect(startDate.getUTCDate()).toBe(3);
      expect(startDate.getUTCMonth()).toBe(9);
    });

    it('purchase 1 Oct with future calendar 5 Oct -> start 5 Oct', () => {
      const purchase = new Date('2026-10-01T14:00:00.000Z');
      const { startDate } = resolvePlanSubscriptionDates(purchase, 1, '2026-10-05');
      expect(startDate.getUTCDate()).toBe(5);
      expect(startDate.getUTCMonth()).toBe(9);
    });

    it('no activation in request -> start 3 Oct for purchase 1 Oct', () => {
      const purchase = new Date('2026-10-01T14:00:00.000Z');
      const { startDate } = resolvePlanSubscriptionDates(purchase, 1, null);
      expect(startDate.getUTCDate()).toBe(3);
    });
  });

  describe('calculateSubscriptionDates (Full Cycle: Purchase -> Start (+2d) -> End (+Duration from Start))', () => {
    it('Monthly: Purchase 1 Sep -> Start 3 Sep -> End 3 Oct', () => {
      const { purchaseDate, startDate, endDate } = calculateSubscriptionDates('2026-09-01T00:00:00.000Z', 1);
      expect(purchaseDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCDate()).toBe(3);
      expect(startDate.getUTCMonth()).toBe(8); // Sep
      expect(endDate.getUTCDate()).toBe(3);
      expect(endDate.getUTCMonth()).toBe(9); // Oct
    });

    it('Monthly: Purchase 15 Sep -> Start 17 Sep -> End 17 Oct', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2026-09-15T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(17);
      expect(startDate.getUTCMonth()).toBe(8);
      expect(endDate.getUTCDate()).toBe(17);
      expect(endDate.getUTCMonth()).toBe(9);
    });

    it('Monthly: Purchase 30 Jan -> Start 1 Feb -> End 1 Mar', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2026-01-30T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCMonth()).toBe(1); // Feb
      expect(endDate.getUTCDate()).toBe(1);
      expect(endDate.getUTCMonth()).toBe(2); // Mar
    });

    it('Monthly: Purchase 31 Jan -> Start 2 Feb -> End 2 Mar', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2026-01-31T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(2);
      expect(startDate.getUTCMonth()).toBe(1); // Feb
      expect(endDate.getUTCDate()).toBe(2);
      expect(endDate.getUTCMonth()).toBe(2); // Mar
    });

    it('Monthly: Purchase 28 Feb (non-leap) -> Start 2 Mar -> End 2 Apr', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2026-02-28T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(2);
      expect(startDate.getUTCMonth()).toBe(2); // Mar
      expect(endDate.getUTCDate()).toBe(2);
      expect(endDate.getUTCMonth()).toBe(3); // Apr
    });

    it('Monthly: Purchase 28 Feb (leap 2024) -> Start 1 Mar -> End 1 Apr', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2024-02-28T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCMonth()).toBe(2); // Mar
      expect(endDate.getUTCDate()).toBe(1);
      expect(endDate.getUTCMonth()).toBe(3); // Apr
    });

    it('Monthly: Purchase 30 Dec 2026 -> Start 1 Jan 2027 -> End 1 Feb 2027', () => {
      const { startDate, endDate } = calculateSubscriptionDates('2026-12-30T00:00:00.000Z', 1);
      expect(startDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCMonth()).toBe(0); // Jan
      expect(startDate.getUTCFullYear()).toBe(2027);
      expect(endDate.getUTCDate()).toBe(1);
      expect(endDate.getUTCMonth()).toBe(1); // Feb
      expect(endDate.getUTCFullYear()).toBe(2027);
    });

    it('Yearly: Purchase 1 Sep 2026 -> Start 3 Sep 2026 -> End 3 Sep 2027', () => {
      const { purchaseDate, startDate, endDate } = calculateSubscriptionDates('2026-09-01T00:00:00.000Z', 12);
      expect(purchaseDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCDate()).toBe(3);
      expect(startDate.getUTCMonth()).toBe(8); // Sep 2026
      expect(startDate.getUTCFullYear()).toBe(2026);
      expect(endDate.getUTCDate()).toBe(3);
      expect(endDate.getUTCMonth()).toBe(8); // Sep 2027
      expect(endDate.getUTCFullYear()).toBe(2027);
    });
  });

  describe('Safe Month-End Clamping in calculatePlanExpiry', () => {
    it('should clamp 31 March start date to 30 April end date (+1 month)', () => {
      const start = new Date('2026-03-31T00:00:00.000Z');
      const end = calculatePlanExpiry(start, 1);
      expect(end.getUTCDate()).toBe(30);
      expect(end.getUTCMonth()).toBe(3); // April
    });

    it('should clamp 31 May start date to 30 June end date (+1 month)', () => {
      const start = new Date('2026-05-31T00:00:00.000Z');
      const end = calculatePlanExpiry(start, 1);
      expect(end.getUTCDate()).toBe(30);
      expect(end.getUTCMonth()).toBe(5); // June
    });
  });
});
