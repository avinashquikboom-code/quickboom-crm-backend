export interface TemplateVariableContext {
  customer_name?: string | null;
  product_or_service?: string | null;
  lead_source?: string | null;
  employee_name?: string | null;
  contact_number?: string | null;
  company_name?: string | null;
  [key: string]: any;
}

export function escapeHtmlValue(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildTemplateVariableMap(ctx: TemplateVariableContext = {}): Record<string, string> {
  const customerName = String(ctx.customer_name ?? ctx.customerName ?? ctx.name ?? 'Valued Customer').trim() || 'Valued Customer';
  const productOrService = String(ctx.product_or_service ?? ctx.productOrService ?? ctx.service ?? 'our services').trim() || 'our services';
  const leadSource = String(ctx.lead_source ?? ctx.leadSource ?? ctx.source ?? 'Direct Enquiry').trim() || 'Direct Enquiry';
  const employeeName = String(ctx.employee_name ?? ctx.employeeName ?? ctx.assignedTo ?? 'Our Sales Team').trim() || 'Our Sales Team';
  const contactNumber = String(ctx.contact_number ?? ctx.contactNumber ?? ctx.phone ?? '').trim() || 'Support Desk';
  const companyName = String(ctx.company_name ?? ctx.companyName ?? 'QB Suite').trim() || 'QB Suite';

  return {
    ...Object.fromEntries(
      Object.entries(ctx)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    ),
    customer_name: customerName,
    customerName,
    product_or_service: productOrService,
    productOrService,
    lead_source: leadSource,
    leadSource,
    employee_name: employeeName,
    employeeName,
    contact_number: contactNumber,
    contactNumber,
    company_name: companyName,
    companyName,
  };
}

/**
 * Replaces {{variable}} placeholders with resolved values, optionally escaping HTML,
 * and strips any unresolved placeholders so raw {{...}} tokens are never sent.
 */
export function resolveTemplateVariables(
  templateText: string,
  context: TemplateVariableContext = {},
  options: { escapeHtml?: boolean; preserveKeys?: string[] } = {},
): string {
  if (!templateText || typeof templateText !== 'string') return '';
  const map = buildTemplateVariableMap(context);
  const preserve = new Set(options.preserveKeys || ['logoUrl', 'primaryColor', 'resetLink', 'loginUrl']);

  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const val = map[key];
    if (val === undefined || val === null) {
      return '';
    }
    if (options.escapeHtml && !preserve.has(key)) {
      return escapeHtmlValue(String(val));
    }
    return String(val);
  });
}
