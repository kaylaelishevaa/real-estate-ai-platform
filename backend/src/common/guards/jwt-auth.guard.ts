import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Validates a JWT supplied either as:
 *   - Cookie: access_token
 *   - Header: Authorization: Bearer <token>
 *
 * On success, attaches the validated user to request.user.
 * Use @UseGuards(JwtAuthGuard) on any route or controller that requires auth.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
