import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SecurityService } from '../services/security.service';

/**
 * Guard for the login endpoint that enforces per-email brute-force protection.
 * After 5 failed attempts, the account is locked for 15 minutes.
 *
 * This works alongside the global ThrottlerGuard (per-IP) to provide
 * defense-in-depth: even if an attacker rotates IPs, the per-email
 * limit still kicks in.
 *
 * Apply to POST /auth/login BEFORE the actual authentication logic.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const email = request.body?.email;

    if (!email || typeof email !== 'string') {
      // Let validation pipe handle missing email
      return true;
    }

    const locked = await this.security.isLoginLocked(email);
    if (locked) {
      const ip = request.ip || request.socket?.remoteAddress || 'unknown';
      this.security.logSecurityEvent('LOGIN_LOCKED', { email, ip });
      throw new HttpException(
        'Too many failed login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
