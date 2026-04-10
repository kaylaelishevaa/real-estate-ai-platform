import { SetMetadata } from '@nestjs/common';
import { PERMISSION_KEY } from '../guards/permission.guard';

export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
