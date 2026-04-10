import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Blocks external (agent) users — only internal (admin/super-admin) users pass.
 * Must be applied AFTER AdminGuard (which sets request.user).
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: any }>();
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.role !== 'internal') {
      throw new ForbiddenException('Admin-only access');
    }
    return true;
  }
}
