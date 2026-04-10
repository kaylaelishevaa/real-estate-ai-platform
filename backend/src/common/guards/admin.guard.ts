import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Combined JWT + admin role guard.
 * Extracts JWT from cookie or Authorization header, verifies it,
 * looks up the user, and checks isAdmin === true.
 * Attaches the user (sans password) to request.user.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();

    // Extract token from cookie or Authorization header
    const token =
      request.cookies?.['access_token'] ??
      this.extractBearerToken(request.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    let payload: { sub: number; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: (() => {
          const s = this.config.get<string>('JWT_SECRET');
          if (!s) throw new Error('JWT_SECRET environment variable is required');
          return s;
        })(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.role !== 'internal' && user.role !== 'external') {
      throw new UnauthorizedException('Admin access required');
    }

    // Attach user to request (sans password)
    const { password: _pw, ...safeUser } = user;
    request.user = safeUser;

    return true;
  }

  private extractBearerToken(header?: string): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }
}
