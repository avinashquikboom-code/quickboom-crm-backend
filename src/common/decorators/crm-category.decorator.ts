import { SetMetadata } from '@nestjs/common';
import { CrmEmployeeCategory } from '../crm/crm-employee-category';

export const CRM_CATEGORY_KEY = 'crmEmployeeCategories';

/** Restrict an employee CRM route to BPO, Visitor, or both. Admins are unchanged. */
export const CrmCategory = (...categories: Array<Exclude<CrmEmployeeCategory, 'NONE'>>) =>
  SetMetadata(CRM_CATEGORY_KEY, categories);
