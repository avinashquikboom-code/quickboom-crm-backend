export const INVOICE_ITEMS_START = '[QB_INVOICE_ITEMS]';
export const INVOICE_ITEMS_END = '[/QB_INVOICE_ITEMS]';

export interface InvoiceLineItemSnapshot {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceItemsSnapshot {
  v: 1;
  planName: string;
  planType: 'DEFAULT' | 'CUSTOM';
  items: InvoiceLineItemSnapshot[];
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function withInvoiceItemsSnapshot(
  notes: string,
  snapshot: InvoiceItemsSnapshot,
): string {
  const cleaned = String(notes || '')
    .replace(
      new RegExp(
        `${INVOICE_ITEMS_START.replace(/[[\]]/g, '\\$&')}[\\s\\S]*?${INVOICE_ITEMS_END.replace(/[[\]]/g, '\\$&')}`,
        'g',
      ),
      '',
    )
    .trim();
  return `${cleaned}\n${INVOICE_ITEMS_START}${JSON.stringify(snapshot)}${INVOICE_ITEMS_END}`;
}

export function parseInvoiceItemsSnapshot(notes?: string | null): InvoiceItemsSnapshot | null {
  if (!notes) return null;
  const start = notes.indexOf(INVOICE_ITEMS_START);
  const end = notes.indexOf(INVOICE_ITEMS_END);
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const raw = notes.slice(start + INVOICE_ITEMS_START.length, end);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .map((item: any) => {
        const name = String(item?.name || item?.description || '').trim();
        if (!name) return null;
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const unitPrice = roundMoney(item.unitPrice);
        const total = roundMoney(
          item.total !== undefined && item.total !== null
            ? item.total
            : unitPrice * quantity,
        );
        return {
          name,
          description: item.description ? String(item.description) : undefined,
          quantity,
          unitPrice,
          total,
        } as InvoiceLineItemSnapshot;
      })
      .filter(Boolean) as InvoiceLineItemSnapshot[];
    if (items.length === 0) return null;
    return {
      v: 1,
      planName: String(parsed.planName || items[0].name).trim(),
      planType: parsed.planType === 'CUSTOM' ? 'CUSTOM' : 'DEFAULT',
      items,
    };
  } catch {
    return null;
  }
}

export function buildDefaultPlanLineItems(
  planName: string,
  unitPrice: number,
): InvoiceItemsSnapshot {
  const name = String(planName || '').trim() || 'Subscription Plan';
  const price = roundMoney(unitPrice);
  return {
    v: 1,
    planName: name,
    planType: 'DEFAULT',
    items: [{ name, quantity: 1, unitPrice: price, total: price }],
  };
}

export function buildCustomPlanLineItems(
  planName: string,
  selectedFeatures: unknown,
  fallbackTotal: number,
): InvoiceItemsSnapshot {
  const resolvedName = String(planName || '').trim() || 'Custom Plan';
  const items: InvoiceLineItemSnapshot[] = [];
  if (Array.isArray(selectedFeatures)) {
    for (const feat of selectedFeatures) {
      const name = String(feat?.name || feat?.code || '').trim();
      if (!name) continue;
      const quantity = Math.max(1, Number(feat.quantity) || 1);
      const unitPrice = roundMoney(feat.unitPrice ?? feat.monthlyPrice ?? 0);
      const storedTotal = feat.totalPrice ?? feat.monthlyTotal;
      const total = roundMoney(
        storedTotal !== undefined && storedTotal !== null
          ? storedTotal
          : unitPrice * quantity,
      );
      items.push({
        name,
        description: feat.description ? String(feat.description) : undefined,
        quantity,
        unitPrice,
        total,
      });
    }
  }
  if (items.length === 0) {
    const price = roundMoney(fallbackTotal);
    return {
      v: 1,
      planName: resolvedName,
      planType: 'CUSTOM',
      items: [{ name: resolvedName, quantity: 1, unitPrice: price, total: price }],
    };
  }
  return {
    v: 1,
    planName: resolvedName,
    planType: 'CUSTOM',
    items,
  };
}

export function resolveInvoiceLineItems(invoice: any): InvoiceItemsSnapshot {
  const fromNotes = parseInvoiceItemsSnapshot(invoice?.notes);
  if (fromNotes) return fromNotes;

  if (Array.isArray(invoice?.lineItems) && invoice.lineItems.length > 0) {
    return buildCustomPlanLineItems(
      invoice.planName || '',
      invoice.lineItems,
      Number(invoice.subTotal || 0),
    );
  }

  const dbItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const mapped = dbItems
    .map((item: any) => {
      const name = String(item?.product?.name || item?.name || '').trim();
      if (!name) return null;
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = roundMoney(item.unitPrice);
      return {
        name,
        quantity,
        unitPrice,
        total: roundMoney(item.total !== undefined ? item.total : unitPrice * quantity),
      } as InvoiceLineItemSnapshot;
    })
    .filter(Boolean) as InvoiceLineItemSnapshot[];
  if (mapped.length > 0) {
    return {
      v: 1,
      planName: String(invoice?.planName || mapped[0].name).trim(),
      planType: 'DEFAULT',
      items: mapped,
    };
  }

  const fallbackName =
    String(invoice?.planName || '').trim() || 'Subscription Plan';
  const fallbackPrice = roundMoney(invoice?.subTotal || 0);
  return buildDefaultPlanLineItems(fallbackName, fallbackPrice);
}
