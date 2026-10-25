import {
  buildCustomPlanLineItems,
  buildDefaultPlanLineItems,
  parseInvoiceItemsSnapshot,
  resolveInvoiceLineItems,
  withInvoiceItemsSnapshot,
} from './invoice-items.util';

describe('invoice-items.util', () => {
  it('snapshots a default plan as a single purchased line item', () => {
    const snapshot = buildDefaultPlanLineItems('Standard Package', 14999);
    const notes = withInvoiceItemsSnapshot(
      'Subscription payment for Standard Package (MONTHLY billing).',
      snapshot,
    );
    const parsed = parseInvoiceItemsSnapshot(notes);
    expect(parsed?.planName).toBe('Standard Package');
    expect(parsed?.planType).toBe('DEFAULT');
    expect(parsed?.items).toEqual([
      { name: 'Standard Package', quantity: 1, unitPrice: 14999, total: 14999 },
    ]);
  });

  it('snapshots custom plan services from stored selectedFeatures and does not invent names', () => {
    const snapshot = buildCustomPlanLineItems(
      'Custom Plan (1 Months)',
      [
        { name: 'Social Media Marketing', quantity: 1, unitPrice: 14999, totalPrice: 14999 },
        { name: 'Telecalling Services', quantity: 2, unitPrice: 8000, totalPrice: 16000 },
      ],
      30999,
    );
    expect(snapshot.planType).toBe('CUSTOM');
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1]).toEqual({
      name: 'Telecalling Services',
      quantity: 2,
      unitPrice: 8000,
      total: 16000,
    });
  });

  it('falls back to a single custom plan line when no item records exist', () => {
    const snapshot = buildCustomPlanLineItems('Growth Package', [], 25999);
    expect(snapshot.items).toEqual([
      { name: 'Growth Package', quantity: 1, unitPrice: 25999, total: 25999 },
    ]);
  });

  it('keeps historical invoices without a snapshot on the existing single-line fallback', () => {
    const resolved = resolveInvoiceLineItems({
      notes: 'Subscription payment for Basic Package (MONTHLY billing). Total Paid: ₹11798.',
      planName: 'Basic Package',
      subTotal: 9999,
    });
    expect(resolved.items).toEqual([
      { name: 'Basic Package', quantity: 1, unitPrice: 9999, total: 9999 },
    ]);
  });
});
