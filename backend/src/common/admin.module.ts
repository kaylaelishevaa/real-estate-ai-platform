import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

/**
 * Shared module that provides JwtService for AdminGuard.
 * Import this into any module whose controllers use @UseGuards(AdminGuard).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: (() => {
          const s = config.get<string>('JWT_SECRET');
          if (!s) throw new Error('JWT_SECRET environment variable is required');
          return s;
        })(),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  exports: [JwtModule],
})
export class AdminModule {}
