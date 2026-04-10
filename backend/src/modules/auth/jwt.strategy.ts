import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityService } from '../../common/services/security.service';

// ---------------------------------------------------------------------------
// JWT payload shape (what we sign at login)
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------

/** Extracts the raw JWT token from the request for blacklist checks. */
function extractRawToken(req: any): string | null {
  return (
    req?.cookies?.['access_token'] ??
    req?.cookies?.['admin_token'] ??
    req?.headers?.authorization?.replace('Bearer ', '') ??
    null
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly security: SecurityService,
  ) {
    super({
      /**
       * Try cookie first, then fall back to Authorization: Bearer header.
       * The cookie is populated by @fastify/cookie after app.register().
       */
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => req?.cookies?.['access_token'] ?? req?.cookies?.['admin_token'] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET environment variable is required');
        return secret;
      })(),
      passReqToCallback: true,
    });
  }

  /**
   * Called after the token signature is verified.
   * The return value is attached to request.user.
   */
  async validate(req: any, payload: JwtPayload) {
    // Check if token has been blacklisted (logged out)
    const rawToken = extractRawToken(req);
    if (rawToken) {
      const blacklisted = await this.security.isTokenBlacklisted(rawToken);
      if (blacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    });

    if (!user) throw new UnauthorizedException('Token user not found');

    // Strip password before attaching to request
    const { password: _pw, ...safe } = user;
    return {
      ...safe,
      isAdmin: user.role === 'internal',
      is_admin: user.role === 'internal',
      isAgent: user.role === 'external',
      is_agent: user.role === 'external',
    };
  }
}
