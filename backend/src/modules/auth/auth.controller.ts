import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LoginThrottleGuard } from '../../common/guards/login-throttle.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SecurityService } from '../../common/services/security.service';

const COOKIE_NAME = 'access_token';
const SEVEN_DAYS = 60 * 60 * 24 * 7; // seconds

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly security: SecurityService,
  ) {}

  /**
   * POST /auth/login
   * Returns { access_token, user } wrapped by ResponseInterceptor as:
   * { success: true, data: { access_token, user: { id, email, profile, ... } } }
   *
   * Also sets an httpOnly cookie so browser clients don't need to manage the token.
   */
  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottleGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const data = await this.authService.login(dto);

    res.setCookie(COOKIE_NAME, data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: SEVEN_DAYS,
      path: '/',
      sameSite: 'lax',
    });

    return data; // ResponseInterceptor wraps → { success: true, data: { access_token, user } }
  }

  /**
   * POST /auth/refresh
   * Validates the current JWT and returns a fresh access_token.
   */
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  refresh(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const data = this.authService.refresh(user);

    res.setCookie(COOKIE_NAME, data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: SEVEN_DAYS,
      path: '/',
      sameSite: 'lax',
    });

    return data;
  }

  /**
   * GET /auth/me
   * Returns the authenticated user's profile.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: any) {
    const { permissions, role_name } = await this.authService.getPermissions(user.id);
    return { ...user, permissions, role_name };
  }

  /**
   * POST /auth/logout
   * Stateless — clears the cookie. The JWT remains technically valid until it
   * expires (7 days), but the client no longer has it.
   */
  @Post('logout')
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    // Blacklist the current token so it can't be reused
    const token =
      req.cookies?.['access_token'] ??
      req.cookies?.['admin_token'] ??
      req.headers?.authorization?.replace('Bearer ', '');
    if (token) {
      await this.security.blacklistToken(token, SEVEN_DAYS);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.clearCookie('admin_token', { path: '/' });
    return { message: 'Logged out successfully' };
  }

  /**
   * POST /auth/forgot-password
   * Sends a password reset link to the given email (if it exists).
   */
  @Post('forgot-password')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  /**
   * POST /auth/reset-password
   * Resets the user's password using a valid reset token.
   */
  @Post('reset-password')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body.token, body.password);
  }
}
