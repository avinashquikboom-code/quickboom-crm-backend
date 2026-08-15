import { SetMetadata } from '@nestjs/common';

export interface RequiredPermission {
  module: string;
  action: string;
}

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: RequiredPermission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
