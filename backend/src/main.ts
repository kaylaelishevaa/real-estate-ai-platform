// Ensure BigInt values survive JSON.stringify (Prisma uses BigInt for IDs/prices)
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { SnakeCaseInterceptor } from './common/interceptors/snake-case.interceptor';
import { StripEmptyStringsPipe } from './common/pipes/strip-empty.pipe';
import { join } from 'path';

async function bootstrap() {
  // Validate required environment variables
  const required = ['JWT_SECRET', 'DATABASE_URL'];
  const optional_warn = ['AWS_S3_BUCKET', 'AWS_CDN_URL', 'MAIL_HOST', 'MAIL_USER'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Required environment variable ${key} is not set. Aborting startup.`);
    }
  }
  for (const key of optional_warn) {
    if (!process.env[key]) {
      console.warn(`Warning: ${key} is not set. Some features may not work.`);
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 2 * 1024 * 1024, // 2 MB max request body
      connectionTimeout: 30_000, // 30s connection timeout
      keepAliveTimeout: 5_000, // 5s keep-alive timeout
    }),
  );

  // ── Security: HTTP headers ─────────────────────────────────────────────────
  // CSP is disabled because this is a pure API server (no HTML rendered).
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // ── Compression ────────────────────────────────────────────────────────────
  await app.register(fastifyCompress);

  // ── Cookie support ─────────────────────────────────────────────────────────
  await app.register(fastifyCookie);

  // ── Multipart support ──────────────────────────────────────────────────────
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB max per file
      files: 1, // one file per request
    },
  });

  // ── CORS ───────────────────────────────────────────────────────────────────
  // localhost origins are only allowed in development.
  const allowedOrigins: string[] = [];
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:3001');
  }
  const frontendUrl = process.env.FRONTEND_URL;
  const adminUrl = process.env.ADMIN_URL;
  if (frontendUrl) allowedOrigins.push(frontendUrl);
  if (adminUrl) allowedOrigins.push(adminUrl);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global prefix ──────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Static files (placeholder images, uploads) ────────────────────────────
  // __dirname is dist/src/ when compiled, so go up 2 levels to project root
  app.useStaticAssets({
    root: join(__dirname, '..', '..', 'public', 'placeholder'),
    prefix: '/placeholder/',
    decorateReply: false,
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new StripEmptyStringsPipe(),
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalInterceptors(new SnakeCaseInterceptor());

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Server running on http://localhost:${port}`);
}
void bootstrap();
