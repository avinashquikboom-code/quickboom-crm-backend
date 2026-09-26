import { RecordCreatedFrom } from '@prisma/client';

/**
 * Authoritative resolver for the creation platform origin (MOBILE_APP vs ADMIN_PANEL).
 * Prioritizes actual client application identification headers (x-client-type, user-agent)
 * over arbitrary payload claims or naive user-role assumptions.
 */
export function resolveCreatedFrom(
  req?: any,
  user?: any,
  explicitValue?: string | RecordCreatedFrom | null,
): RecordCreatedFrom {
  const headers = req?.headers || {};
  const clientType = String(
    headers['x-client-type'] ||
    headers['x-source-platform'] ||
    headers['x-platform'] ||
    ''
  ).toLowerCase().trim();
  const userAgent = String(headers['user-agent'] || '').toLowerCase();

  // 1. Mobile App Client Detection
  if (
    clientType === 'mobile' ||
    clientType === 'mobile_app' ||
    userAgent.includes('dart') ||
    userAgent.includes('flutter') ||
    userAgent.includes('okhttp') ||
    userAgent.includes('cfnetwork') ||
    headers['x-device-info']
  ) {
    return RecordCreatedFrom.MOBILE_APP;
  }

  // 2. Admin Panel Client Detection
  if (clientType === 'admin' || clientType === 'admin_panel' || clientType === 'web') {
    return RecordCreatedFrom.ADMIN_PANEL;
  }

  // 3. Explicit parameter from internal services or Data Capture flow
  if (explicitValue === RecordCreatedFrom.MOBILE_APP || explicitValue === 'MOBILE_APP') {
    return RecordCreatedFrom.MOBILE_APP;
  }
  if (explicitValue === RecordCreatedFrom.ADMIN_PANEL || explicitValue === 'ADMIN_PANEL') {
    return RecordCreatedFrom.ADMIN_PANEL;
  }

  // 4. Fallback if client headers were omitted/proxied
  const role = String(user?.role || user?.roleType || req?.user?.role || '').toUpperCase();
  if (role === 'EMPLOYEE' || role === 'CUSTOMER') {
    return RecordCreatedFrom.MOBILE_APP;
  }

  return RecordCreatedFrom.ADMIN_PANEL;
}
