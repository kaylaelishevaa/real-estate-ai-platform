/**
 * HTTP-level e2e for the listings REST surface.
 *
 * Boots a real Nest + Fastify app over the listings module with the SAME global
 * pipes and the {success, data} response envelope as production, but without the
 * Redis-backed PublicApiGuard — so it runs with no DB, network, or API key
 * (ConfigService stub → FakeLlmClient). It exercises routing, DTO validation,
 * status codes, the envelope, and the draft/active flow end to end.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { SnakeCaseInterceptor } from '../../common/interceptors/snake-case.interceptor';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';

const COMPLETE_DIRECT = [
  'Jalur : Direct',
  'Nama Properti : South Hills',
  'Unit : 5A',
  'Tipe Properti : Apartemen',
  'Tipe Listing : Jual',
  'Harga Jual : 4M',
  'Kamar Tidur : 2',
  'Kamar Mandi : 1',
  'Luas Bangunan : 60',
  'Kondisi : Furnished',
  'Owner : Budi',
  'HP Owner : 08123456789',
].join('\n');

describe('Listings REST (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        ListingsService,
        { provide: ConfigService, useValue: { get: () => undefined } }, // no key → FakeLlmClient
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new SnakeCaseInterceptor(), new ResponseInterceptor());

    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/listings → wrapped list of seeded listings, each with a status', async () => {
    const res = await request(http).get('/api/listings').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(res.body.data.every((r: { status: string }) => r.status === 'active' || r.status === 'draft')).toBe(true);
  });

  it('POST /api/listings/parse → 201, writes a complete listing as active', async () => {
    const res = await request(http).post('/api/listings/parse').send({ text: COMPLETE_DIRECT }).expect(201);
    expect(res.body.data.status).toBe('written');
    expect(res.body.data.record_status).toBe('active');
    expect(res.body.data.listing.nama_properti_normalized).toBe('South Hills');
  });

  it('POST /api/listings/parse → an incomplete message is saved as a draft', async () => {
    const res = await request(http)
      .post('/api/listings/parse')
      .send({ text: 'Nama Properti : Halcyon Tower\nTipe Properti : Apartemen\nTipe Listing : Jual' })
      .expect(201);
    expect(res.body.data.status).toBe('written');
    expect(res.body.data.record_status).toBe('draft');
    expect(res.body.data.missing.length).toBeGreaterThan(0);
  });

  it('POST /api/listings/parse → 400 when the body fails validation (empty text)', async () => {
    await request(http).post('/api/listings/parse').send({ text: '' }).expect(400);
  });

  it('PATCH /api/listings/:id → updates a field and bumps the revision', async () => {
    const id = (await request(http).get('/api/listings')).body.data[0].id;
    const before = (await request(http).get(`/api/listings/${encodeURIComponent(id)}`)).body.data;

    const res = await request(http)
      .patch(`/api/listings/${encodeURIComponent(id)}`)
      .send({ kondisi: 'Unfurnished' })
      .expect(200);

    expect(res.body.data.listing.kondisi).toBe('Unfurnished');
    expect(res.body.data.revision).toBe(before.revision + 1);
  });

  it('GET /api/listings/:id → 404 for an unknown id', async () => {
    await request(http).get('/api/listings/does-not-exist').expect(404);
  });

  it('DELETE /api/listings/:id → 204, then the listing is gone (404)', async () => {
    const id = (await request(http).get('/api/listings')).body.data[0].id;
    await request(http).delete(`/api/listings/${encodeURIComponent(id)}`).expect(204);
    await request(http).get(`/api/listings/${encodeURIComponent(id)}`).expect(404);
  });
});
