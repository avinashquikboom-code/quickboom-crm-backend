import { SetMetadata } from '@nestjs/common';
export const WORKSPACE_ACTION_KEY = 'workspaceAction';
export const WorkspaceAction = (...actions: { module: string; action: string }[]) => SetMetadata(WORKSPACE_ACTION_KEY, actions);
