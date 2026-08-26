import { Injectable } from '@nestjs/common';

@Injectable()
export class QBIdGenerator {
  /**
   * Generates formatted QB identifier (e.g. QB-ADMIN-001, QB-CADMIN-001, QB-EMP-001, QB-CUST-001)
   */
  generateQBUserId(role: string, id: number): string {
    const normalizedRole = (role || '').toUpperCase();
    const paddedId = String(id).padStart(3, '0');

    switch (normalizedRole) {
      case 'SUPER_ADMIN':
        return `QB-ADMIN-${paddedId}`;
      case 'COMPANY_ADMIN':
      case 'CUSTOMER_ADMIN':
        return `QB-CADMIN-${paddedId}`;
      case 'EMPLOYEE':
        return `QB-EMP-${paddedId}`;
      case 'CUSTOMER':
        return `QB-CUST-${paddedId}`;
      default:
        return `QB-USER-${paddedId}`;
    }
  }

  /**
   * Parses QB identifier back into role and numeric ID
   */
  parseQBUserId(qbId: string): { role: string; id: number } | null {
    if (!qbId || typeof qbId !== 'string') return null;

    const parts = qbId.split('-');
    if (parts.length !== 3 || parts[0] !== 'QB') return null;

    const prefix = parts[1];
    const numericId = parseInt(parts[2], 10);
    if (isNaN(numericId)) return null;

    let role = 'CUSTOM';
    switch (prefix) {
      case 'ADMIN':
        role = 'SUPER_ADMIN';
        break;
      case 'CADMIN':
        role = 'COMPANY_ADMIN';
        break;
      case 'EMP':
        role = 'EMPLOYEE';
        break;
      case 'CUST':
        role = 'CUSTOMER';
        break;
      default:
        role = 'CUSTOM';
    }

    return { role, id: numericId };
  }
}
