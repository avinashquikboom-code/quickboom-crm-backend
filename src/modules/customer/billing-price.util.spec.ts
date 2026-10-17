import { subscriptionPrice } from './billing-price.util';
const base = {
  taxRateBps: 1800,
  yearlyDiscountBps: 2000,
  billingIntervals: ['MONTHLY', 'YEARLY'],
};
describe('subscription pricing in integer paise', () => {
  it.each([
    [9999, 999900, 179982, 1179882, 9599040, 1727827, 11326867],
    [14999, 1499900, 269982, 1769882, 14399040, 2591827, 16990867],
    [25999, 2599900, 467982, 3067882, 24959040, 4492627, 29451667],
  ])(
    'prices monthly and yearly plan %s with GST after discount',
    (
      monthlyPrice,
      monthlyTaxable,
      monthlyGst,
      monthlyTotal,
      yearlyTaxable,
      yearlyGst,
      yearlyTotal,
    ) => {
      expect(
        subscriptionPrice({ ...base, monthlyPrice }, 'MONTHLY'),
      ).toMatchObject({
        basePaise: monthlyTaxable,
        discountPaise: 0,
        taxablePaise: monthlyTaxable,
        gstPaise: monthlyGst,
        totalPaise: monthlyTotal,
      });
      expect(
        subscriptionPrice({ ...base, monthlyPrice }, 'YEARLY'),
      ).toMatchObject({
        basePaise: monthlyTaxable * 12,
        taxablePaise: yearlyTaxable,
        gstPaise: yearlyGst,
        totalPaise: yearlyTotal,
      });
    },
  );
  it('rejects unsupported cycles and sub-paise prices', () => {
    expect(() =>
      subscriptionPrice({ ...base, monthlyPrice: 1 }, 'WEEKLY'),
    ).toThrow();
    expect(() =>
      subscriptionPrice({ ...base, monthlyPrice: 1.001 }, 'MONTHLY'),
    ).toThrow();
    expect(() =>
      subscriptionPrice(
        { ...base, monthlyPrice: 1, billingIntervals: ['MONTHLY'] },
        'YEARLY',
      ),
    ).toThrow();
  });
});
