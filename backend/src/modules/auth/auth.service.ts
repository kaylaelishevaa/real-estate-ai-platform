import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityService } from '../../common/services/security.service';
import { LoginDto } from './dto/login.dto';
import * as nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
  ) {}

  /**
   * Issue a fresh access_token for an already-authenticated user.
   */
  refresh(user: { id: number | bigint; email: string; role: string }) {
    const payload = { sub: Number(user.id), email: user.email, role: user.role };
    return { access_token: this.jwtService.sign(payload) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { profile: true },
    });

    if (!user) {
      await this.security.recordFailedLogin(dto.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      await this.security.recordFailedLogin(dto.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — clear failed attempt counter
    await this.security.clearFailedLogins(dto.email);

    const payload = { sub: Number(user.id), email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload);

    // Strip the hashed password from the response
    const { password: _pw, ...rest } = user;
    const safeUser = {
      ...rest,
      isAdmin: user.role === 'internal',
      is_admin: user.role === 'internal',
      isAgent: user.role === 'external',
      is_agent: user.role === 'external',
    };

    // Resolve role-based permissions and role name
    const { permissions, role_name } = await this.resolveUserPermissions(user.id);

    return { access_token, user: safeUser, permissions, role_name };
  }

  // ── Password reset ──────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    // Always return success to prevent email enumeration
    if (!user) return { message: 'If the email exists, a reset link has been sent.' };

    // Generate a reset token (random hex)
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Store as OTP with 60-minute expiry
    await this.prisma.otp.create({
      data: {
        otpableType: 'App\\Models\\User',
        otpableId: user.id,
        code: token,
        expiredAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
      },
    });

    // Send reset email
    const adminUrl = this.config.get<string>('ADMIN_URL') ?? 'http://localhost:3001';
    try {
      const transporter = nodemailer.createTransport({
        host: this.config.get<string>('MAIL_HOST'),
        port: this.config.get<number>('MAIL_PORT', 587),
        auth: {
          user: this.config.get<string>('MAIL_USER'),
          pass: this.config.get<string>('MAIL_PASSWORD'),
        },
      });
      await transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM'),
        to: user.email,
        subject: 'Password Reset',
        html: `<p>Hi ${user.profile?.firstName ?? 'there'},</p><p>Click <a href="${adminUrl}/reset-password?token=${token}">here</a> to reset your password.</p>`,
      });
    } catch {
      // Log but don't expose failure
    }

    return { message: 'If the email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const otp = await this.prisma.otp.findFirst({
      where: {
        otpableType: 'App\\Models\\User',
        code: token,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('Invalid or expired reset token');
    if (otp.expiredAt < new Date()) {
      await this.prisma.otp.delete({ where: { id: otp.id } });
      throw new BadRequestException('Reset token has expired');
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: Number(otp.otpableId) },
      data: { password: hashed },
    });

    // Delete the used token
    await this.prisma.otp.delete({ where: { id: otp.id } });

    return { message: 'Password has been reset successfully.' };
  }

  // ── Permissions resolver ──────────────────────────────────────────────────

  /** Resolve the user's role name from modelHasRole + role tables. */
  async getUserRoleName(userId: number | bigint): Promise<string> {
    const USER_TYPE = 'App\\Models\\User';
    const userRoles = await this.prisma.modelHasRole.findMany({
      where: { modelType: USER_TYPE, modelId: userId },
      include: { role: { select: { name: true } } },
    });
    return userRoles[0]?.role?.name ?? '';
  }

  /** Public wrapper so the controller can call it for GET /auth/me */
  async getPermissions(userId: number | bigint): Promise<{ permissions: Record<string, boolean>; role_name: string }> {
    return this.resolveUserPermissions(userId);
  }

  private async resolveUserPermissions(
    userId: number | bigint,
  ): Promise<{ permissions: Record<string, boolean>; role_name: string }> {
    const USER_TYPE = 'App\\Models\\User';

    const allPerms = await this.prisma.permission.findMany({
      select: { name: true },
      orderBy: { id: 'asc' },
    });

    const userRoles = await this.prisma.modelHasRole.findMany({
      where: { modelType: USER_TYPE, modelId: userId },
      include: { role: { select: { id: true, name: true } } },
    });
    const roleIds = userRoles.map((r) => r.roleId);
    const role_name = userRoles[0]?.role?.name ?? '';

    const granted = roleIds.length
      ? await this.prisma.roleHasPermission.findMany({
          where: { roleId: { in: roleIds } },
          include: { permission: { select: { name: true } } },
        })
      : [];

    const grantedSet = new Set(granted.map((g) => g.permission.name));
    const map: Record<string, boolean> = {};
    for (const p of allPerms) {
      map[p.name] = grantedSet.has(p.name);
    }
    return { permissions: map, role_name };
  }
}
