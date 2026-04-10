import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const PERMISSION_KEY = 'permission';

const USER_TYPE = 'App\\Models\\User';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No permission metadata → route is open to any authenticated admin
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest<{ user: any }>();
    if (!user) throw new ForbiddenException('Not authenticated');

    // Fetch user roles
    const userRoles = await this.prisma.modelHasRole.findMany({
      where: { modelType: USER_TYPE, modelId: user.id },
      include: { role: { select: { id: true, name: true } } },
    });
    const roleIds = userRoles.map((r) => r.roleId);

    // Attach role metadata to user for downstream controllers/services
    const roleName = userRoles[0]?.role?.name ?? '';
    user.roleName = roleName;
    user.agentScope = roleName === 'agent';

    if (!roleIds.length) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }

    // Check if any role has the required permission
    // Normalize: decorators use underscores (view_listing) but DB uses spaces (view listing)
    const normalised = required.replace(/_/g, ' ');
    const match = await this.prisma.roleHasPermission.findFirst({
      where: {
        roleId: { in: roleIds },
        permission: { name: { in: [required, normalised] } },
      },
    });

    if (!match) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }

    return true;
  }
}
