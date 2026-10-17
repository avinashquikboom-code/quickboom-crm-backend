import { SetMetadata } from '@nestjs/common';
export const ACCOUNT_TYPES_KEY = 'accountTypes';
export const AccountTypes = (...types: string[]) => SetMetadata(ACCOUNT_TYPES_KEY, types);
