import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const USER_TYPE = 'App\\Models\\User';

/**
 * Guard that restricts access to super admin users only.
 * Use on sensitive endpoints like role management, user role assignment,
 * and any operation that could lead to privilege escalation.
 *
 * Must be applied AFTER AdminGuard (which sets request.user).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{ user: any }>();
    if (!user) throw new ForbiddenException('Not authenticated');

    const isSuperAdmin = await this.isSuperAdmin(Number(user.id));
    if (!isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
    }

    return true;
  }

  private async isSuperAdmin(userId: number): Promise<boolean> {
    const match = await this.prisma.modelHasRole.findFirst({
      where: {
        modelId: userId,
        modelType: USER_TYPE,
        role: { name: 'super admin' },
      },
    });
    return !!match;
  }
}
