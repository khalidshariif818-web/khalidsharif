import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { SupabaseLibraryRepository } from '../src/server/db/supabaseRepository.ts';
import { SupabaseStorageService } from '../src/server/services/storage.ts';

interface QueryTrace {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  filters: Array<{ method: string; args: unknown[] }>;
  payload?: unknown;
}

function createMockSupabaseClient(options?: {
  onQuery?: (trace: QueryTrace) => { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
  onRpc?: (fn: string, params: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };
  onUpload?: (bucket: string, objectPath: string, bytes: Uint8Array, opts: unknown) => { error: { message: string } | null };
  onDownload?: (bucket: string, objectPath: string) => { data: Blob | null; error: { message: string } | null };
}) {
  const traces: QueryTrace[] = [];

  const from = (table: string) => {
    const trace: QueryTrace = { table, op: 'select', filters: [] };

    const resolveResult = () => {
      traces.push({ ...trace, filters: [...trace.filters] });
      const res = options?.onQuery?.(trace);
      return {
        data: res?.data ?? null,
        error: res?.error ?? null,
        count: res?.count ?? 0,
      };
    };

    const builder: Record<string, unknown> = {
      select: (...args: unknown[]) => {
        trace.filters.push({ method: 'select', args });
        return builder;
      },
      insert: (payload: unknown) => {
        trace.op = 'insert';
        trace.payload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        trace.op = 'update';
        trace.payload = payload;
        return builder;
      },
      upsert: (payload: unknown, opts?: unknown) => {
        trace.op = 'upsert';
        trace.payload = payload;
        trace.filters.push({ method: 'upsertOpts', args: [opts] });
        return builder;
      },
      delete: () => {
        trace.op = 'delete';
        return builder;
      },
      eq: (col: string, val: unknown) => {
        trace.filters.push({ method: 'eq', args: [col, val] });
        return builder;
      },
      neq: (col: string, val: unknown) => {
        trace.filters.push({ method: 'neq', args: [col, val] });
        return builder;
      },
      in: (col: string, val: unknown[]) => {
        trace.filters.push({ method: 'in', args: [col, val] });
        return builder;
      },
      or: (expr: string) => {
        trace.filters.push({ method: 'or', args: [expr] });
        return builder;
      },
      gte: (col: string, val: unknown) => {
        trace.filters.push({ method: 'gte', args: [col, val] });
        return builder;
      },
      lte: (col: string, val: unknown) => {
        trace.filters.push({ method: 'lte', args: [col, val] });
        return builder;
      },
      order: (col: string, opts?: unknown) => {
        trace.filters.push({ method: 'order', args: [col, opts] });
        return builder;
      },
      range: (fromIdx: number, toIdx: number) => {
        trace.filters.push({ method: 'range', args: [fromIdx, toIdx] });
        return builder;
      },
      limit: (n: number) => {
        trace.filters.push({ method: 'limit', args: [n] });
        return builder;
      },
      single: () => Promise.resolve(resolveResult()),
      maybeSingle: () => Promise.resolve(resolveResult()),
      then: (onFulfilled: (val: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
        Promise.resolve(resolveResult()).then(onFulfilled, onRejected),
    };

    return builder;
  };

  const rpc = async (fn: string, params: Record<string, unknown>) => {
    const res = options?.onRpc?.(fn, params);
    return {
      data: res?.data ?? null,
      error: res?.error ?? null,
    };
  };

  const storage = {
    from: (bucket: string) => ({
      upload: async (objectPath: string, bytes: Uint8Array, opts?: unknown) => {
        if (options?.onUpload) return options.onUpload(bucket, objectPath, bytes, opts);
        return { data: { path: objectPath }, error: null };
      },
      getPublicUrl: (objectPath: string) => ({
        data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${objectPath}` },
      }),
      download: async (objectPath: string) => {
        if (options?.onDownload) return options.onDownload(bucket, objectPath);
        return { data: null, error: { message: 'Not found' } };
      },
    }),
  };

  return {
    client: { from, rpc, storage } as unknown as SupabaseClient,
    traces,
  };
}

describe('Supabase Backend Adapter & Storage Integration', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksdl-supa-unit-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('switches createApp() runtime automatically to supabase_postgres when Supabase URL & service role key are present', async () => {
    const { client } = createMockSupabaseClient({
      onQuery: (trace) => {
        if (trace.table === 'categories' || trace.table === 'books') {
          return { data: [], error: null, count: 1 };
        }
        return { data: [], error: null, count: 0 };
      },
    });

    const config: ServerConfig = {
      appUrl: 'http://localhost:3000',
      nodeEnv: 'test',
      sessionSecret: 'unit-test-secret-key-32-bytes-min!',
      supabaseUrl: 'https://demo-project.supabase.co',
      supabaseAnonKey: 'anon-key',
      supabaseServiceRoleKey: 'service-role-key',
      adminBootstrapToken: '',
      premierBankGatewayUrl: '',
      premierBankMerchantId: '',
      premierBankApiKey: '',
      premierBankWebhookSecret: '',
      resendApiKey: '',
      emailFrom: 'test@example.com',
    };

    const { app, runtime } = await createApp({ config, supabase: client });
    expect(runtime.databaseMode).toBe('supabase_postgres');
    expect(runtime.repo).toBeInstanceOf(SupabaseLibraryRepository);
    expect(runtime.storage).toBeInstanceOf(SupabaseStorageService);

    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { databaseMode: string; ok: boolean };
    expect(healthJson).toMatchObject({ ok: true, databaseMode: 'supabase_postgres' });
  });

  it('avoids Postgres 22P02 UUID errors by routing slugs/orderRefs to text columns and UUIDs to id.eq', async () => {
    const bookUuid = '11111111-1111-4111-8111-111111111111';
    const orderUuid = '22222222-2222-4222-8222-222222222222';
    const { client, traces } = createMockSupabaseClient({
      onQuery: (trace) => {
        if (trace.table === 'books') {
          return {
            data: {
              id: bookUuid,
              slug: 'monsoon-ports-of-the-benadir-coast',
              title: 'Monsoon Ports',
              subtitle: '',
              author: 'Khalid Sharif',
              description: 'History',
              category_id: '33333333-3333-4333-8333-333333333333',
              language: 'en',
              is_free: false,
              price_cents: 1850,
              currency: 'USD',
              status: 'published',
              is_featured: true,
              is_recommended: false,
              popularity_score: 5,
              watermark_enabled: true,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'orders') {
          return {
            data: {
              id: orderUuid,
              order_reference: 'KSDL-ABC-1234',
              user_id: '44444444-4444-4444-8444-444444444444',
              subtotal_cents: 1850,
              discount_cents: 0,
              total_cents: 1850,
              currency: 'USD',
              status: 'awaiting_payment',
              payment_method_code: 'premier_bank_gateway',
              notes: '',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        return { data: [] };
      },
    });

    const repo = new SupabaseLibraryRepository(client);

    // Non-UUID book slug must query .eq('slug', ...) and never .or('id.eq...')
    await repo.getBookBySlugOrId('monsoon-ports-of-the-benadir-coast');
    const slugTrace = traces.find((t) => t.table === 'books')!;
    expect(slugTrace.filters.some((f) => f.method === 'eq' && f.args[0] === 'slug')).toBe(true);
    expect(slugTrace.filters.some((f) => f.method === 'or')).toBe(false);

    // Valid UUID book ID queries .or('id.eq...,slug.eq...')
    traces.length = 0;
    await repo.getBookBySlugOrId(bookUuid);
    const uuidTrace = traces.find((t) => t.table === 'books')!;
    expect(uuidTrace.filters.some((f) => f.method === 'or' && String(f.args[0]).includes(`id.eq.${bookUuid}`))).toBe(true);

    // Non-UUID order reference queries .eq('order_reference', ...) and never .or('id.eq...')
    traces.length = 0;
    await repo.getOrderById('KSDL-ABC-1234');
    const orderRefTrace = traces.find((t) => t.table === 'orders')!;
    expect(orderRefTrace.filters.some((f) => f.method === 'eq' && f.args[0] === 'order_reference')).toBe(true);
    expect(orderRefTrace.filters.some((f) => f.method === 'or')).toBe(false);
  });

  it('executes authoritative checkout creation and delegates verification & first-admin setup to Postgres RPCs', async () => {
    const userUuid = '44444444-4444-4444-8444-444444444444';
    const bookUuid = '11111111-1111-4111-8111-111111111111';
    const orderUuid = '22222222-2222-4222-8222-222222222222';
    const paymentUuid = '55555555-5555-4555-8555-555555555555';

    const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    let adminExists = false;

    const { client } = createMockSupabaseClient({
      onQuery: (trace) => {
        if (trace.table === 'books') {
          return {
            data: {
              id: bookUuid,
              slug: 'paid-monograph',
              title: 'Paid Monograph',
              author: 'Khalid Sharif',
              description: 'Desc',
              category_id: '33333333-3333-4333-8333-333333333333',
              language: 'en',
              is_free: false,
              price_cents: 2000,
              currency: 'USD',
              status: 'published',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'entitlements') {
          return { data: null };
        }
        if (trace.table === 'site_settings') {
          return { data: { value: { SCHOLAR10: 10 } } };
        }
        if (trace.table === 'orders') {
          return {
            data: {
              id: orderUuid,
              order_reference: 'KSDL-TEST-01',
              user_id: userUuid,
              subtotal_cents: 2000,
              discount_cents: 200,
              total_cents: 1800,
              currency: 'USD',
              status: 'paid',
              payment_method_code: 'premier_bank_gateway',
              notes: '',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'payments') {
          return {
            data: {
              id: paymentUuid,
              order_id: orderUuid,
              user_id: userUuid,
              provider_code: 'premier_bank_gateway',
              transaction_reference: 'TX-TEST-01',
              provider_payment_id: 'PB-999',
              amount_cents: 1800,
              currency: 'USD',
              status: 'verified',
              created_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'profiles') {
          if (trace.filters.some((f) => f.method === 'eq' && f.args[0] === 'email')) {
            return { data: null };
          }
          return {
            data: {
              id: userUuid,
              email: 'owner@example.com',
              full_name: 'Owner',
              preferred_language: 'so',
              preferred_theme: 'light',
              email_notifications: true,
              account_status: 'active',
              created_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'user_roles') {
          return { data: [{ role: 'customer' }, { role: 'super_admin' }] };
        }
        return { data: [] };
      },
      onRpc: (fn, params) => {
        rpcCalls.push({ fn, params });
        if (fn === 'create_authoritative_order_atomic') {
          return { data: { order_id: orderUuid, payment_id: paymentUuid }, error: null };
        }
        if (fn === 'verify_payment_and_grant_entitlement') {
          return { data: { status: 'verified', order_id: orderUuid }, error: null };
        }
        if (fn === 'setup_first_admin_atomic') {
          if (adminExists) {
            return { data: null, error: { message: 'ADMIN_ALREADY_EXISTS' } };
          }
          adminExists = true;
          return { data: userUuid, error: null };
        }
        return { data: null, error: null };
      },
    });

    const repo = new SupabaseLibraryRepository(client);

    const createdOrder = await repo.createAuthoritativeOrder({
      userId: userUuid,
      bookIds: [bookUuid],
      paymentMethodCode: 'premier_bank_gateway',
      discountCode: 'scholar10',
    });

    const orderRpc = rpcCalls.find((c) => c.fn === 'create_authoritative_order_atomic');
    expect(orderRpc?.params).toMatchObject({
      p_user_id: userUuid,
      p_subtotal_cents: 2000,
      p_discount_cents: 200,
      p_total_cents: 1800,
      p_payment_method_code: 'premier_bank_gateway',
    });
    expect(createdOrder.order.id).toBe(orderUuid);

    const verified = await repo.processVerifiedPaymentAtomic({
      paymentId: paymentUuid,
      providerPaymentId: 'PB-999',
    });
    expect(verified.alreadyVerified).toBe(false);
    expect(verified.order.status).toBe('paid');
    expect(rpcCalls.some((c) => c.fn === 'verify_payment_and_grant_entitlement')).toBe(true);

    const admin = await repo.setupFirstAdminAtomic({
      email: 'owner@example.com',
      rawPassword: 'StrongPassword123',
      passwordHash: 'hashed',
      verifyPasswordFn: () => true,
      fullName: 'Owner',
      preferredLanguage: 'so',
    });
    expect(admin.roles).toContain('super_admin');

    await expect(
      repo.setupFirstAdminAtomic({
        email: 'second@example.com',
        rawPassword: 'StrongPassword123',
        passwordHash: 'hashed',
        verifyPasswordFn: () => true,
        fullName: 'Second',
        preferredLanguage: 'so',
      })
    ).rejects.toThrow('ADMIN_ALREADY_EXISTS');
  });

  it('uploads covers/PDFs to Supabase Storage buckets and falls back to local disk when cloud download misses', async () => {
    const uploadSpy = vi.fn(
      (_bucket: string, _objectPath: string, _bytes: Uint8Array, _opts: unknown) => ({ error: null as { message: string } | null })
    );
    const { client } = createMockSupabaseClient({
      onUpload: (bucket, objectPath, bytes, opts) => {
        uploadSpy(bucket, objectPath, bytes, opts);
        return { error: null };
      },
      onDownload: (_bucket, objectPath) => {
        if (objectPath === 'cloud-book.pdf') {
          return { data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null };
        }
        return { data: null, error: { message: 'Object not found' } };
      },
    });

    const storage = new SupabaseStorageService(client);

    const coverUrl = await storage.uploadPublicCover('../evil-path/cover.png', new Uint8Array([137, 80]), 'image/png');
    expect(uploadSpy).toHaveBeenCalledWith('book-covers', 'cover.png', expect.any(Uint8Array), {
      contentType: 'image/png',
      upsert: true,
    });
    expect(coverUrl).toBe('https://example.supabase.co/storage/v1/object/public/book-covers/cover.png');

    const storedPdfName = await storage.uploadPrivatePdf('/tmp/book.pdf', new Uint8Array([37, 80, 68, 70]));
    expect(storedPdfName).toBe('book.pdf');
    expect(uploadSpy).toHaveBeenCalledWith('book-pdfs', 'book.pdf', expect.any(Uint8Array), {
      contentType: 'application/pdf',
      upsert: true,
    });

    const fromCloud = await storage.readPrivatePdf('cloud-book.pdf');
    expect(Array.from(fromCloud || [])).toEqual([37, 80, 68, 70]);

    const missing = await storage.readPrivatePdf('missing.pdf');
    expect(missing).toBeNull();
  });

  it('supports Supabase user management filters, per-user free book granting, and quick book updates', async () => {
    const userUuid = '44444444-4444-4444-8444-444444444444';
    const bookUuid = '11111111-1111-4111-8111-111111111111';
    const { client, traces } = createMockSupabaseClient({
      onQuery: (trace) => {
        if (trace.table === 'profiles') {
          if (trace.filters.some((f) => f.method === 'limit')) {
            return {
              data: [
                {
                  id: userUuid,
                  email: 'paused@example.com',
                  full_name: 'Paused Reader',
                  preferred_language: 'so',
                  preferred_theme: 'light',
                  email_notifications: true,
                  account_status: 'paused',
                  created_at: '2026-01-01T00:00:00Z',
                },
              ],
            };
          }
          return {
            data: {
              id: userUuid,
              email: 'paused@example.com',
              full_name: 'Paused Reader',
              preferred_language: 'so',
              preferred_theme: 'light',
              email_notifications: true,
              account_status: 'paused',
              created_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        if (trace.table === 'user_roles') {
          return { data: [{ user_id: userUuid, role: 'customer' }] };
        }
        if (trace.table === 'entitlements') {
          if (trace.op === 'select') {
            return {
              data: [
                {
                  user_id: userUuid,
                  book_id: bookUuid,
                  source_type: 'admin_grant',
                  status: 'active',
                  granted_at: '2026-01-01T00:00:00Z',
                  books: {
                    title: 'Monsoon Ports',
                    author: 'Khalid Sharif',
                    is_free: false,
                    price_cents: 1850,
                    currency: 'USD',
                    status: 'published',
                  },
                },
              ],
            };
          }
          return { data: [] };
        }
        if (trace.table === 'books') {
          return {
            data: {
              id: bookUuid,
              slug: 'monsoon-ports',
              title: 'Monsoon Ports',
              author: 'Khalid Sharif',
              description: 'History',
              category_id: '33333333-3333-4333-8333-333333333333',
              language: 'en',
              is_free: true,
              price_cents: 0,
              currency: 'USD',
              status: 'published',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          };
        }
        return { data: [] };
      },
    });

    const repo = new SupabaseLibraryRepository(client);
    const list = await repo.listCustomers('paused', 'paused');
    expect(list[0]).toMatchObject({ accountStatus: 'paused', activeBooksCount: 1 });
    const profFilterTrace = traces.find((t) => t.table === 'profiles' && t.op === 'select')!;
    expect(profFilterTrace.filters.some((f) => f.method === 'eq' && f.args[0] === 'account_status' && f.args[1] === 'paused')).toBe(true);

    const updatedBook = await repo.quickUpdateBook(bookUuid, { isFree: true, priceCents: 0, status: 'published' });
    expect(updatedBook.isFree).toBe(true);
    expect(updatedBook.priceCents).toBe(0);
  });

  it('filters active promotions in listPromotions and delegates getSalesReport to RPC with query fallback', async () => {
    const promoRows = [
      {
        id: 'promo-active',
        name: 'Active Library Sale',
        scope: 'library',
        target_id: null,
        discount_type: 'percent',
        discount_value: 20,
        starts_at: '2020-01-01T00:00:00Z',
        ends_at: '2099-01-01T00:00:00Z',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'promo-expired',
        name: 'Expired Sale',
        scope: 'library',
        target_id: null,
        discount_type: 'percent',
        discount_value: 50,
        starts_at: '2020-01-01T00:00:00Z',
        ends_at: '2021-01-01T00:00:00Z',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'promo-paused',
        name: 'Paused Sale',
        scope: 'library',
        target_id: null,
        discount_type: 'fixed_cents',
        discount_value: 300,
        starts_at: null,
        ends_at: null,
        is_active: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    let rpcShouldFail = false;
    const { client } = createMockSupabaseClient({
      onQuery: (trace) => {
        if (trace.table === 'promotions') return { data: promoRows };
        if (trace.table === 'books') {
          return { data: [{ id: 'b1', title: 'Fallback Book', author: 'Khalid', popularity_score: 10 }] };
        }
        if (trace.table === 'purchases') {
          return { data: [{ book_id: 'b1', amount_paid_cents: 1200 }] };
        }
        if (trace.table === 'orders') {
          return { data: [{ created_at: '2026-02-01T10:00:00Z', total_cents: 1200 }] };
        }
        return { data: [] };
      },
      onRpc: (fn) => {
        if (fn === 'get_sales_report_summary') {
          if (rpcShouldFail) {
            return { data: null, error: { message: 'RPC unavailable' } };
          }
          return {
            data: {
              popularBooks: [{ bookId: 'b-rpc', title: 'RPC Book', author: 'Khalid', salesCount: 4, revenueCents: 4800 }],
              dailyRevenue: [{ day: '2026-02-01', orderCount: 4, revenueCents: 4800 }],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    const repo = new SupabaseLibraryRepository(client);
    const allPromos = await repo.listPromotions(false);
    expect(allPromos).toHaveLength(3);

    const activePromos = await repo.listPromotions(true);
    expect(activePromos.map((p) => p.id)).toEqual(['promo-active']);

    const rpcReport = await repo.getSalesReport('2026-02-01', '2026-02-10');
    expect(rpcReport.popularBooks[0]?.bookId).toBe('b-rpc');
    expect(rpcReport.dailyRevenue[0]?.revenueCents).toBe(4800);

    rpcShouldFail = true;
    const fallbackReport = await repo.getSalesReport('2026-02-01', '2026-02-10');
    expect(fallbackReport.popularBooks[0]).toMatchObject({ bookId: 'b1', salesCount: 1, revenueCents: 1200 });
    expect(fallbackReport.dailyRevenue[0]).toMatchObject({ day: '2026-02-01', orderCount: 1, revenueCents: 1200 });
  });
});
