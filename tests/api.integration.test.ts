import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { escapeCsvCell, signToken } from '../src/server/security.ts';

describe('Khalid Sharif Digital Library — Full API, Security & E2E Integration Tests', () => {
  let tmpDir: string;
  let config: ServerConfig;
  let app: Awaited<ReturnType<typeof createApp>>['app'];
  let repo: Awaited<ReturnType<typeof createApp>>['runtime']['repo'];

  let customerCookie = '';
  let adminCookie = '';
  let customerId = '';
  let paidBookId = '';
  let freeBookId = '';

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksdl-test-'));
    config = {
      appUrl: 'http://localhost:3000',
      nodeEnv: 'test',
      sessionSecret: 'integration-test-secret-key-32-bytes!',
      supabaseUrl: '',
      supabaseAnonKey: '',
      supabaseServiceRoleKey: '',
      adminBootstrapToken: 'bootstrap-secret-token',
      premierBankGatewayUrl: 'https://premierbank.invalid/checkout',
      premierBankMerchantId: 'PB-MERCHANT-001',
      premierBankApiKey: 'pb-api-key-test',
      premierBankWebhookSecret: 'premier-bank-webhook-hmac-secret-12345',
      resendApiKey: '',
      emailFrom: 'test@example.com',
    };

    const created = await createApp({ config });
    app = created.app;
    repo = created.runtime.repo;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves homepage, catalog search, and book details from database', async () => {
    const homeRes = await app.request('/api/homepage');
    expect(homeRes.status).toBe(200);
    const homeJson = (await homeRes.json()) as { collections: { featured: Array<{ id: string; isFree: boolean }> } };
    expect(homeJson.collections.featured.length).toBeGreaterThan(0);

    const catalogRes = await app.request('/api/books?q=Benadir');
    expect(catalogRes.status).toBe(200);
    const catalogJson = (await catalogRes.json()) as { items: Array<{ id: string; isFree: boolean }> };
    expect(catalogJson.items.length).toBe(1);
    paidBookId = catalogJson.items[0].id;

    const freeRes = await app.request('/api/books?price=free');
    const freeJson = (await freeRes.json()) as { items: Array<{ id: string; isFree: boolean }> };
    expect(freeJson.items.length).toBeGreaterThan(0);
    freeBookId = freeJson.items[0].id;
  });

  it('registers customer, rejects invalid login, and prevents customer access to admin routes', async () => {
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reader@example.com',
        password: 'StrongPassword123',
        fullName: 'Amina Reader',
        preferredLanguage: 'so',
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as { user: { id: string; roles: string[] } };
    expect(regData.user.roles).toEqual(['customer']);
    customerId = regData.user.id;
    customerCookie = regRes.headers.get('set-cookie')?.split(';')[0] || '';
    expect(customerCookie).toContain('ksdl_session=');

    const badLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com', password: 'WrongPassword' }),
    });
    expect(badLogin.status).toBe(401);

    // Normal customer cannot access admin routes
    const adminAttempt = await app.request('/api/admin/overview', {
      headers: { Cookie: customerCookie },
    });
    expect(adminAttempt.status).toBe(403);
  });

  it('allows free book reading, blocks paid book PDF access without entitlement, and rejects invalid/expired PDF tokens', async () => {
    const freeSession = await app.request(`/api/books/${freeBookId}/pdf-session`, { method: 'POST' });
    expect(freeSession.status).toBe(200);
    const { signedUrl } = (await freeSession.json()) as { signedUrl: string };
    const freePdfRes = await app.request(signedUrl);
    expect(freePdfRes.status).toBe(200);
    expect(freePdfRes.headers.get('content-type')).toBe('application/pdf');

    // Paid book blocked for unauthenticated and non-entitled customer
    const paidUnauth = await app.request(`/api/books/${paidBookId}/pdf-session`, { method: 'POST' });
    expect(paidUnauth.status).toBe(403);

    const paidNoEnt = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(paidNoEnt.status).toBe(403);

    // Expired PDF token rejected
    const expiredToken = signToken({ sub: customerId, typ: 'pdf_access', bookId: paidBookId }, config.sessionSecret, -60);
    const expiredRes = await app.request(`/api/books/${paidBookId}/pdf?token=${encodeURIComponent(expiredToken)}`);
    expect(expiredRes.status).toBe(401);
  });

  it('handles wishlist, cart, manual payment pending verification (no premature unlock), and admin verification unlock', async () => {
    // Wishlist & Cart
    const wishRes = await app.request(`/api/account/wishlist/${paidBookId}`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(wishRes.status).toBe(201);

    const cartRes = await app.request(`/api/cart/${paidBookId}`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(cartRes.status).toBe(201);

    // Enable manual_transfer in test so manual verification flow can also be exercised
    await repo.updatePaymentProviderConfig('manual_transfer', {
      isEnabled: true,
      instructionsEn: 'Test manual transfer',
      instructionsSo: 'Tijaabo',
      instructionsAr: 'اختبار',
    });

    // Checkout with manual_transfer
    const checkoutRes = await app.request('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({
        bookIds: [paidBookId],
        paymentMethodCode: 'manual_transfer',
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const { order } = (await checkoutRes.json()) as { order: { id: string; status: string; totalCents: number } };
    expect(order.status).toBe('awaiting_payment');
    expect(order.totalCents).toBe(1850);

    // Submitting manual reference moves order to processing, book MUST remain locked
    const refRes = await app.request(`/api/orders/${order.id}/manual-reference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ customerReference: 'BANK-REF-7788' }),
    });
    expect(refRes.status).toBe(200);
    const refJson = (await refRes.json()) as { order: { status: string } };
    expect(refJson.order.status).toBe('processing');

    const stillLocked = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(stillLocked.status).toBe(403);

    // Provision admin and login
    const adminReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'AdminPassword123',
        fullName: 'Library Admin',
      }),
    });
    const adminUser = (await adminReg.json()) as { user: { id: string } };
    adminCookie = adminReg.headers.get('set-cookie')?.split(';')[0] || '';
    await repo.grantAdminRole(adminUser.user.id, null, 'super_admin');

    // Admin verifies payment -> atomic unlock
    const verifyRes = await app.request(`/api/admin/orders/${order.id}/verify-payment`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as { order: { status: string } };
    expect(verifyJson.order.status).toBe('paid');

    // Customer can now open paid PDF & save reading progress
    const unlockedSession = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(unlockedSession.status).toBe(200);
    const { signedUrl } = (await unlockedSession.json()) as { signedUrl: string };
    const pdfRes = await app.request(signedUrl);
    expect(pdfRes.status).toBe(200);

    const progRes = await app.request(`/api/reader/${paidBookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ currentPage: 3, totalPages: 6 }),
    });
    expect(progRes.status).toBe(200);

    // Admin refund revokes entitlement immediately
    const refundRes = await app.request(`/api/admin/orders/${order.id}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ reason: 'Test refund' }),
    });
    expect(refundRes.status).toBe(200);

    const revokedSession = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: customerCookie },
    });
    expect(revokedSession.status).toBe(403);
  });

  it('verifies Premier Bank Gateway HMAC signatures, rejects invalid signatures, and guarantees idempotent webhook processing', async () => {
    const { order, payment } = await repo.createAuthoritativeOrder({
      userId: customerId,
      bookIds: [paidBookId],
      paymentMethodCode: 'premier_bank_gateway',
    });

    const payload = JSON.stringify({
      eventId: 'pb-evt-unique-001',
      eventType: 'premier_bank.card_payment',
      transactionReference: payment.transactionReference,
      providerPaymentId: 'pb-mc-visa-999',
      status: 'APPROVED',
    });

    // Invalid signature rejected
    const badSigRes = await app.request('/api/webhooks/payments/premier_bank_gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-premier-signature': 'tampered-signature' },
      body: payload,
    });
    expect(badSigRes.status).toBe(401);

    // Valid HMAC signature succeeds
    const validSig = crypto.createHmac('sha256', config.premierBankWebhookSecret).update(payload).digest('hex');
    const okRes = await app.request('/api/webhooks/payments/premier_bank_gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-premier-signature': validSig },
      body: payload,
    });
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as { status: string; order: { id: string; status: string } };
    expect(okJson.status).toBe('verified');
    expect(okJson.order.id).toBe(order.id);
    expect(okJson.order.status).toBe('paid');

    // Duplicate webhook ignored idempotently
    const dupRes = await app.request('/api/webhooks/payments/premier_bank_gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-premier-signature': validSig },
      body: payload,
    });
    expect(dupRes.status).toBe(200);
    const dupJson = (await dupRes.json()) as { status: string };
    expect(dupJson.status).toBe('duplicate_ignored');
  });

  it('validates admin book creation and rejects untrusted non-PDF uploads', async () => {
    const createRes = await app.request('/api/admin/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Test Archival Edition',
        slug: 'test-archival-edition',
        author: 'Khalid Sharif',
        description: 'A detailed archival test volume for verifying upload rules.',
        categoryId: 'cat-history',
        language: 'en',
        isFree: true,
        priceCents: 0,
        status: 'published',
      }),
    });
    expect(createRes.status).toBe(201);
    const createdBook = (await createRes.json()) as { book: { id: string } };

    // Reject fake PDF file with wrong magic bytes
    const fd = new FormData();
    fd.append('file', new File(['not a real pdf'], 'malicious.pdf', { type: 'application/pdf' }));
    const uploadRes = await app.request(`/api/admin/books/${createdBook.book.id}/upload-pdf`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: fd,
    });
    expect(uploadRes.status).toBe(400);
  });

  it('serves default 252611086006 contacts publicly and enforces admin CRUD for multi-type contacts and discount codes', async () => {
    const pubRes = await app.request('/api/contact-channels');
    expect(pubRes.status).toBe(200);
    const pubJson = (await pubRes.json()) as { channels: Array<{ type: string; value: string; isPrimary: boolean }> };
    expect(pubJson.channels.some((c) => c.value.includes('252611086006') && c.type === 'phone' && c.isPrimary)).toBe(true);
    expect(pubJson.channels.some((c) => c.value.includes('252611086006') && c.type === 'whatsapp')).toBe(true);

    // Non-admin rejected
    const forbiddenContacts = await app.request('/api/admin/contacts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ channels: [] }),
    });
    expect(forbiddenContacts.status).toBe(403);

    const forbiddenDiscounts = await app.request('/api/admin/discount-codes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ codes: [] }),
    });
    expect(forbiddenDiscounts.status).toBe(403);

    // Admin updates contact channels with multiple types (phone, whatsapp, email, telegram, hidden address)
    const updateContactsRes = await app.request('/api/admin/contacts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        channels: [
          {
            id: 'c-phone',
            type: 'phone',
            label: 'Main Hotline',
            value: '+252611086006',
            url: 'tel:+252611086006',
            isPrimary: true,
            isEnabled: true,
            sortOrder: 1,
          },
          {
            id: 'c-email',
            type: 'email',
            label: 'Editorial Desk',
            value: 'info@khalidshariflibrary.so',
            url: '',
            isPrimary: false,
            isEnabled: true,
            sortOrder: 2,
          },
          {
            id: 'c-hidden',
            type: 'address',
            label: 'Internal Archive',
            value: 'Mogadishu',
            url: '',
            isPrimary: false,
            isEnabled: false,
            sortOrder: 3,
          },
        ],
      }),
    });
    expect(updateContactsRes.status).toBe(200);

    // Public list excludes disabled channels
    const pubAfter = await app.request('/api/contact-channels');
    const pubAfterJson = (await pubAfter.json()) as { channels: Array<{ id: string; type: string }> };
    expect(pubAfterJson.channels.map((c) => c.id)).toEqual(['c-phone', 'c-email']);

    // Admin updates discount codes and checkout validates the new code
    const updateDiscRes = await app.request('/api/admin/discount-codes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        codes: [
          { code: 'RAMADAN25', percent: 25 },
          { code: 'SCHOLAR10', percent: 10 },
        ],
      }),
    });
    expect(updateDiscRes.status).toBe(200);

    const validateDiscRes = await app.request('/api/checkout/validate-discount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ code: 'ramadan25' }),
    });
    expect(validateDiscRes.status).toBe(200);
    const validateDiscJson = (await validateDiscRes.json()) as { valid: boolean; discountPercent: number };
    expect(validateDiscJson).toMatchObject({ valid: true, discountPercent: 25 });
  });

  it('enforces admin-only POST /api/admin/login and atomic one-time first-admin setup', async () => {
    // Normal customer rejected at /api/admin/login
    const custAdminLogin = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com', password: 'StrongPassword123' }),
    });
    expect(custAdminLogin.status).toBe(403);

    // Real admin succeeds at /api/admin/login
    const okAdminLogin = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'AdminPassword123' }),
    });
    expect(okAdminLogin.status).toBe(200);

    // Fresh instance with no admin allows one-time atomic setup, then locks permanently
    const freshDir = fs.mkdtempSync(path.join(tmpDir, 'fresh-admin-'));
    const fresh = await createApp({
      config: {
        ...config,
        adminBootstrapToken: '',
      },
    });

    const statusBefore = await fresh.app.request('/api/admin/access-status');
    expect(statusBefore.status).toBe(200);
    expect(await statusBefore.json()).toEqual({ hasAdmin: false, requiresBootstrapToken: false });

    const setupRes = await fresh.app.request('/api/admin/setup-first-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@gmail.com',
        password: 'OwnerPassword123',
        fullName: 'Khalid Owner',
      }),
    });
    expect(setupRes.status).toBe(201);
    const setupJson = (await setupRes.json()) as { user: { roles: string[]; email: string }; sessionToken: string };
    expect(setupJson.user.email).toBe('owner@gmail.com');
    expect(setupJson.user.roles).toContain('super_admin');
    expect(setupJson.sessionToken).toBeTruthy();

    // Second setup attempt must fail with 409
    const secondSetup = await fresh.app.request('/api/admin/setup-first-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@gmail.com',
        password: 'AttackerPassword123',
      }),
    });
    expect(secondSetup.status).toBe(409);

    const statusAfter = await fresh.app.request('/api/admin/access-status');
    expect(await statusAfter.json()).toEqual({ hasAdmin: true, requiresBootstrapToken: false });
  });

  it('saves encrypted gateway credentials in admin, never leaks secrets, and completes Mastercard Hosted Checkout flow', async () => {
    // Non-admin cannot save or test gateway credentials
    const unauthSave = await app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: 'https://ap-gateway.mastercard.com',
        merchantId: 'TEST_MERCHANT',
        apiKey: 'secret-key-9999',
      }),
    });
    expect(unauthSave.status).toBe(403);

    // Admin saves MPGS Hosted Checkout credentials dynamically (no server restart needed)
    const saveRes = await app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: 'https://mpgs.mock.invalid',
        merchantId: 'PB_LIVE_007',
        apiVersion: '73',
        apiKey: 'mpgs-api-secret-8877',
        webhookSecret: 'mpgs-notif-secret-5566',
      }),
    });
    expect(saveRes.status).toBe(200);
    const saveJson = (await saveRes.json()) as {
      isConnected: boolean;
      credentials: {
        gatewayMode: string;
        hasApiKey: boolean;
        apiKeyMasked: string;
        hasWebhookSecret: boolean;
        webhookSecretMasked: string;
      };
    };
    expect(saveJson.isConnected).toBe(true);
    expect(saveJson.credentials.gatewayMode).toBe('mpgs_hosted');
    expect(saveJson.credentials.hasApiKey).toBe(true);
    expect(saveJson.credentials.apiKeyMasked).toBe('••••••••8877');
    expect(JSON.stringify(saveJson)).not.toContain('mpgs-api-secret-8877');
    expect(JSON.stringify(saveJson)).not.toContain('mpgs-notif-secret-5566');

    // GET providers never leaks plaintext keys either
    const providersRes = await app.request('/api/admin/payment-providers', {
      headers: { Cookie: adminCookie },
    });
    expect(providersRes.status).toBe(200);
    const providersText = await providersRes.text();
    expect(providersText).not.toContain('mpgs-api-secret-8877');
    expect(providersText).not.toContain('mpgs-notif-secret-5566');

    // Blank save preserves previously encrypted secrets
    const blankPreserveRes = await app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: 'https://mpgs.mock.invalid',
        merchantId: 'PB_LIVE_007',
        apiVersion: '73',
      }),
    });
    expect(blankPreserveRes.status).toBe(200);
    const blankPreserveJson = (await blankPreserveRes.json()) as {
      isConnected: boolean;
      credentials: { apiKeyMasked: string };
    };
    expect(blankPreserveJson.isConnected).toBe(true);
    expect(blankPreserveJson.credentials.apiKeyMasked).toBe('••••••••8877');

    // Create a second paid book for testing MPGS Hosted Checkout initiation + return verification
    const paid2Res = await app.request('/api/admin/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Mogadishu Civic Records',
        slug: 'mogadishu-civic-records',
        author: 'Khalid Sharif',
        description: 'Archival monograph on Mogadishu municipal records.',
        categoryId: 'cat-history',
        language: 'en',
        isFree: false,
        priceCents: 1400,
        status: 'published',
      }),
    });
    expect(paid2Res.status).toBe(201);
    const paidBook2Id = ((await paid2Res.json()) as { book: { id: string } }).book.id;

    // Mock global fetch temporarily for MPGS INITIATE_CHECKOUT session creation
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          result: 'SUCCESS',
          session: { id: 'SESSION000288889999' },
          successIndicator: 'IND_SECRET_9911',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    let createdOrderRef = '';
    try {
      const checkoutRes = await app.request('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
        body: JSON.stringify({
          bookIds: [paidBook2Id],
          paymentMethodCode: 'premier_bank_gateway',
        }),
      });
      expect(checkoutRes.status).toBe(201);
      const checkoutJson = (await checkoutRes.json()) as {
        order: { orderReference: string; status: string };
        initiation: { redirectUrl?: string };
      };
      createdOrderRef = checkoutJson.order.orderReference;
      expect(checkoutJson.order.status).toBe('awaiting_payment');
      expect(checkoutJson.initiation.redirectUrl).toContain('SESSION000288889999');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Wrong resultIndicator must NOT unlock
    const badVerify = await app.request(`/api/orders/${createdOrderRef}/verify-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ resultIndicator: 'WRONG_INDICATOR' }),
    });
    expect(badVerify.status).toBe(200);
    expect(((await badVerify.json()) as { verified: boolean }).verified).toBe(false);

    // Matching successIndicator atomically verifies order & grants entitlement
    const goodVerify = await app.request(`/api/orders/${createdOrderRef}/verify-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ resultIndicator: 'IND_SECRET_9911' }),
    });
    expect(goodVerify.status).toBe(200);
    const goodJson = (await goodVerify.json()) as { verified: boolean; order: { status: string } };
    expect(goodJson.verified).toBe(true);
    expect(goodJson.order.status).toBe('paid');
    expect(await repo.hasActiveEntitlement(customerId, paidBook2Id)).toBe(true);

    // Clearing admin overrides reverts source back to 'env' when env vars are set
    const clearRes = await app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: '',
        merchantId: '',
        clearSecrets: true,
      }),
    });
    expect(clearRes.status).toBe(200);
    const clearJson = (await clearRes.json()) as { isConnected: boolean; credentials: { source: string } };
    expect(clearJson.credentials.source).toBe('env');
    expect(clearJson.isConnected).toBe(true);

    // Clean client-handoff instance (NO env keys configured at startup)
    const handoffDir = fs.mkdtempSync(path.join(tmpDir, 'handoff-'));
    const handoff = await createApp({
      config: {
        ...config,
        adminBootstrapToken: '',
        premierBankGatewayUrl: '',
        premierBankMerchantId: '',
        premierBankApiKey: '',
        premierBankWebhookSecret: '',
      },
    });
    const handoffAdmin = await handoff.app.request('/api/admin/setup-first-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client-owner@gmail.com', password: 'ClientPassword123' }),
    });
    const handoffToken = ((await handoffAdmin.json()) as { sessionToken: string }).sessionToken;

    const beforeSaveMethods = await handoff.app.request('/api/payment-methods');
    const beforePremier = ((await beforeSaveMethods.json()) as { methods: Array<{ code: string; isConnected: boolean }> }).methods.find(
      (m) => m.code === 'premier_bank_gateway'
    );
    expect(beforePremier?.isConnected).toBe(false);

    const activateHandoff = await handoff.app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handoffToken}` },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: 'https://ap-gateway.mastercard.com',
        merchantId: 'CLIENT_MERCHANT_99',
        apiKey: 'client-live-api-key',
      }),
    });
    expect(activateHandoff.status).toBe(200);
    expect(((await activateHandoff.json()) as { isConnected: boolean }).isConnected).toBe(true);

    const afterSaveMethods = await handoff.app.request('/api/payment-methods');
    const afterPremier = ((await afterSaveMethods.json()) as { methods: Array<{ code: string; isConnected: boolean }> }).methods.find(
      (m) => m.code === 'premier_bank_gateway'
    );
    expect(afterPremier?.isConnected).toBe(true);

    const disconnectHandoff = await handoff.app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handoffToken}` },
      body: JSON.stringify({
        gatewayMode: 'mpgs_hosted',
        gatewayUrl: '',
        merchantId: '',
        clearSecrets: true,
      }),
    });
    expect(disconnectHandoff.status).toBe(200);
    expect(((await disconnectHandoff.json()) as { isConnected: boolean }).isConnected).toBe(false);
  });

  it('supports admin review moderation and customer status/role management with self-protection guards', async () => {
    // Customer creates a review on paidBookId
    const postRev = await app.request(`/api/books/${paidBookId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ rating: 5, comment: 'Essential reading on Benadir heritage.' }),
    });
    expect(postRev.status).toBe(201);
    const reviewId = ((await postRev.json()) as { review: { id: string } }).review.id;

    // Admin lists reviews and hides this review
    const listRevs = await app.request('/api/admin/reviews', { headers: { Cookie: adminCookie } });
    expect(listRevs.status).toBe(200);
    const revJson = (await listRevs.json()) as { reviews: Array<{ id: string; isPublished: boolean }> };
    expect(revJson.reviews.some((r) => r.id === reviewId && r.isPublished)).toBe(true);

    const hideRes = await app.request(`/api/admin/reviews/${reviewId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isPublished: false }),
    });
    expect(hideRes.status).toBe(200);
    expect((await repo.listReviewsForBook(paidBookId)).some((r) => r.id === reviewId)).toBe(false);

    const delRes = await app.request(`/api/admin/reviews/${reviewId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    // Admin suspends and reactivates customer, toggles customer admin role
    const suspendRes = await app.request(`/api/admin/customers/${customerId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ accountStatus: 'suspended' }),
    });
    expect(suspendRes.status).toBe(200);
    expect(((await suspendRes.json()) as { customer: { accountStatus: string } }).customer.accountStatus).toBe('suspended');

    const blockedMe = await app.request('/api/auth/me', { headers: { Cookie: customerCookie } });
    expect(((await blockedMe.json()) as { user: unknown }).user).toBeNull();

    const activateRes = await app.request(`/api/admin/customers/${customerId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ accountStatus: 'active' }),
    });
    expect(activateRes.status).toBe(200);

    const promoteRes = await app.request(`/api/admin/customers/${customerId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isAdmin: true }),
    });
    expect(promoteRes.status).toBe(200);
    expect(((await promoteRes.json()) as { customer: { roles: string[] } }).customer.roles).toContain('admin');

    const demoteRes = await app.request(`/api/admin/customers/${customerId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isAdmin: false }),
    });
    expect(demoteRes.status).toBe(200);
    expect(((await demoteRes.json()) as { customer: { roles: string[] } }).customer.roles).not.toContain('admin');
  });

  it('provides full user management: create user, pause/suspend/reactivate (blocking active PDF tokens), grant/revoke free books, password reset, and quick book controls', async () => {
    // 1. Admin creates a new user with initial free access to paidBookId
    const createRes = await app.request('/api/admin/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        email: 'vip-scholar@example.com',
        password: 'InitialPassword123',
        fullName: 'VIP Scholar',
        preferredLanguage: 'so',
        accountStatus: 'active',
        isAdmin: false,
        grantAll: false,
        bookIds: [paidBookId],
      }),
    });
    expect(createRes.status).toBe(201);
    const createdJson = (await createRes.json()) as { customer: { id: string; email: string; accountStatus: string } };
    const vipId = createdJson.customer.id;
    expect(createdJson.customer.accountStatus).toBe('active');

    // 2. VIP user logs in and gets an active PDF session + signed URL for paidBookId
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vip-scholar@example.com', password: 'InitialPassword123' }),
    });
    expect(loginRes.status).toBe(200);
    let vipCookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

    const pdfSessionRes = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: vipCookie },
    });
    expect(pdfSessionRes.status).toBe(200);
    const { signedUrl } = (await pdfSessionRes.json()) as { signedUrl: string };
    const pdfOk = await app.request(signedUrl);
    expect(pdfOk.status).toBe(200);

    // 3. Admin pauses the VIP user -> blocks login, invalidates session, AND blocks existing signed PDF URL immediately
    const pauseRes = await app.request(`/api/admin/customers/${vipId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ accountStatus: 'paused' }),
    });
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as { customer: { accountStatus: string } }).customer.accountStatus).toBe('paused');

    const pausedList = await app.request('/api/admin/customers?status=paused', { headers: { Cookie: adminCookie } });
    expect(pausedList.status).toBe(200);
    const pausedJson = (await pausedList.json()) as { customers: Array<{ id: string; activeBooksCount: number }> };
    expect(pausedJson.customers.some((c) => c.id === vipId && c.activeBooksCount === 1)).toBe(true);

    const pausedMe = await app.request('/api/auth/me', { headers: { Cookie: vipCookie } });
    expect(((await pausedMe.json()) as { user: unknown }).user).toBeNull();

    const pausedPdf = await app.request(signedUrl);
    expect(pausedPdf.status).toBe(403);

    const pausedLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vip-scholar@example.com', password: 'InitialPassword123' }),
    });
    expect(pausedLogin.status).toBe(403);
    expect(((await pausedLogin.json()) as { error: string }).error.toLowerCase()).toContain('paused');

    // 4. Admin reactivates user -> access restored
    const reactivateRes = await app.request(`/api/admin/customers/${vipId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ accountStatus: 'active' }),
    });
    expect(reactivateRes.status).toBe(200);

    const restoredPdf = await app.request(signedUrl);
    expect(restoredPdf.status).toBe(200);

    // 5. Revoke specific book, unlock ALL books free, then revoke all
    const revokeOneRes = await app.request(`/api/admin/customers/${vipId}/books/${paidBookId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(revokeOneRes.status).toBe(200);

    const lockedAfterRevoke = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: vipCookie },
    });
    expect(lockedAfterRevoke.status).toBe(403);

    const grantAllRes = await app.request(`/api/admin/customers/${vipId}/books/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ grantAll: true }),
    });
    expect(grantAllRes.status).toBe(200);
    const grantAllJson = (await grantAllRes.json()) as { entitlements: Array<{ bookId: string; status: string }> };
    expect(grantAllJson.entitlements.filter((e) => e.status === 'active').length).toBeGreaterThanOrEqual(2);

    const unlockedAllPdf = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: vipCookie },
    });
    expect(unlockedAllPdf.status).toBe(200);

    const revokeAllRes = await app.request(`/api/admin/customers/${vipId}/books/revoke-all`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(revokeAllRes.status).toBe(200);
    const lockedAfterRevokeAll = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: vipCookie },
    });
    expect(lockedAfterRevokeAll.status).toBe(403);

    // 6. Admin updates user profile + resets password; user logs in with new password
    const editUserRes = await app.request(`/api/admin/customers/${vipId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        fullName: 'VIP Scholar Updated',
        preferredLanguage: 'en',
        accountStatus: 'active',
        newPassword: 'UpdatedPassword999',
      }),
    });
    expect(editUserRes.status).toBe(200);

    const newLoginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vip-scholar@example.com', password: 'UpdatedPassword999' }),
    });
    expect(newLoginRes.status).toBe(200);
    vipCookie = newLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
    expect(vipCookie).toContain('ksdl_session=');

    const detailsRes = await app.request(`/api/admin/customers/${vipId}`, { headers: { Cookie: adminCookie } });
    expect(detailsRes.status).toBe(200);
    const detailsJson = (await detailsRes.json()) as { customer: { fullName: string }; entitlements: unknown[] };
    expect(detailsJson.customer.fullName).toBe('VIP Scholar Updated');

    // 7. Quick book price & status control
    const makeFreeRes = await app.request(`/api/admin/books/${paidBookId}/quick`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isFree: true, priceCents: 0 }),
    });
    expect(makeFreeRes.status).toBe(200);
    expect(((await makeFreeRes.json()) as { book: { isFree: boolean; priceCents: number } }).book).toMatchObject({
      isFree: true,
      priceCents: 0,
    });

    const restorePaidRes = await app.request(`/api/admin/books/${paidBookId}/quick`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isFree: false, priceCents: 1850, status: 'published' }),
    });
    expect(restorePaidRes.status).toBe(200);
    expect(((await restorePaidRes.json()) as { book: { isFree: boolean; priceCents: number } }).book).toMatchObject({
      isFree: false,
      priceCents: 1850,
    });
  });

  it('revokes sessions on logout, change-password, and reset-password, and rejects replay of single-use tokens', async () => {
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'session-guard@example.com',
        password: 'StartPassword123',
        fullName: 'Session Guard Reader',
      }),
    });
    expect(reg.status).toBe(201);
    const regJson = (await reg.json()) as { user: { id: string } };
    const firstCookie = reg.headers.get('set-cookie')?.split(';')[0] || '';

    // Logout revokes existing session token
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: firstCookie },
    });
    expect(logoutRes.status).toBe(200);
    const meAfterLogout = await app.request('/api/auth/me', { headers: { Cookie: firstCookie } });
    expect(((await meAfterLogout.json()) as { user: unknown }).user).toBeNull();

    // Re-login and test change-password
    const login1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'session-guard@example.com', password: 'StartPassword123' }),
    });
    expect(login1.status).toBe(200);
    const preChangeCookie = login1.headers.get('set-cookie')?.split(';')[0] || '';

    const badChange = await app.request('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: preChangeCookie },
      body: JSON.stringify({ currentPassword: 'WrongPassword123', newPassword: 'NextPassword123' }),
    });
    expect(badChange.status).toBe(401);

    const goodChange = await app.request('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: preChangeCookie },
      body: JSON.stringify({ currentPassword: 'StartPassword123', newPassword: 'NextPassword123' }),
    });
    expect(goodChange.status).toBe(200);
    const changeJson = (await goodChange.json()) as { ok: boolean; sessionToken: string };
    expect(changeJson.ok).toBe(true);
    expect(changeJson.sessionToken).toBeTruthy();

    // Old pre-change session is invalidated immediately
    const meWithOld = await app.request('/api/auth/me', { headers: { Cookie: preChangeCookie } });
    expect(((await meWithOld.json()) as { user: unknown }).user).toBeNull();

    // New session token works
    const meWithNew = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${changeJson.sessionToken}` },
    });
    expect(((await meWithNew.json()) as { user: { id: string } | null }).user?.id).toBe(regJson.user.id);

    // Single-use reset-password token works once and rejects replay
    const resetToken = signToken({ sub: regJson.user.id, typ: 'password_reset' }, config.sessionSecret, 600);
    const reset1 = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, newPassword: 'FinalPassword123' }),
    });
    expect(reset1.status).toBe(200);

    const resetReplay = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, newPassword: 'AnotherPassword123' }),
    });
    expect(resetReplay.status).toBe(400);

    // Session before reset is invalidated
    const meAfterReset = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${changeJson.sessionToken}` },
    });
    expect(((await meAfterReset.json()) as { user: unknown }).user).toBeNull();

    // Single-use email verification token works once and rejects replay
    const verifyToken = signToken({ sub: regJson.user.id, typ: 'email_verify' }, config.sessionSecret, 600);
    const verify1 = await app.request('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    expect(verify1.status).toBe(200);

    const verifyReplay = await app.request('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    expect(verifyReplay.status).toBe(400);
  });

  it('persists billingEmail/billingPhone, rejects webhook amount/currency mismatches, and enforces ADMIN_BOOTSTRAP_TOKEN in production', async () => {
    // Refresh customerCookie because an earlier test suspended & reactivated reader@example.com (which revoked prior sessions)
    const reloginCust = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com', password: 'StrongPassword123' }),
    });
    expect(reloginCust.status).toBe(200);
    customerCookie = reloginCust.headers.get('set-cookie')?.split(';')[0] || '';

    // Revert admin overrides cleanly to env config so webhook HMAC tests use config.premierBankWebhookSecret
    await app.request('/api/admin/payment-providers/premier_bank_gateway/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        gatewayMode: 'rest_redirect',
        gatewayUrl: '',
        merchantId: '',
        clearSecrets: true,
      }),
    });

    const billingBookRes = await app.request('/api/admin/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Billing & Webhook Verification Monograph',
        slug: 'billing-webhook-verification-monograph',
        author: 'Khalid Sharif',
        description: 'Monograph used for billing contact persistence and webhook checks.',
        categoryId: 'cat-history',
        language: 'en',
        isFree: false,
        priceCents: 2200,
        status: 'published',
      }),
    });
    expect(billingBookRes.status).toBe(201);
    const billingBookId = ((await billingBookRes.json()) as { book: { id: string } }).book.id;

    const checkoutRes = await app.request('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({
        bookIds: [billingBookId],
        paymentMethodCode: 'manual_transfer',
        billingEmail: 'billing-desk@example.com',
        billingPhone: '+252611086006',
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const checkoutJson = (await checkoutRes.json()) as {
      order: { id: string; billingEmail?: string; billingPhone?: string; payment: { transactionReference: string; amountCents: number } };
    };
    expect(checkoutJson.order.billingEmail).toBe('billing-desk@example.com');
    expect(checkoutJson.order.billingPhone).toBe('+252611086006');

    const fetchedOrder = await app.request(`/api/orders/${checkoutJson.order.id}`, {
      headers: { Cookie: customerCookie },
    });
    expect(fetchedOrder.status).toBe(200);
    expect(((await fetchedOrder.json()) as { order: { billingEmail: string; billingPhone: string } }).order).toMatchObject({
      billingEmail: 'billing-desk@example.com',
      billingPhone: '+252611086006',
    });

    // Reject webhook amount & currency mismatches on premier_bank_gateway order
    const gwOrder = await repo.createAuthoritativeOrder({
      userId: customerId,
      bookIds: [billingBookId],
      paymentMethodCode: 'premier_bank_gateway',
    });

    const wrongAmountPayload = JSON.stringify({
      eventId: 'pb-evt-mismatch-amt',
      eventType: 'premier_bank.card_payment',
      transactionReference: gwOrder.payment.transactionReference,
      providerPaymentId: 'pb-mismatch-1',
      status: 'APPROVED',
      amountCents: 100,
      currency: 'USD',
    });
    const wrongAmountSig = crypto
      .createHmac('sha256', config.premierBankWebhookSecret)
      .update(wrongAmountPayload)
      .digest('hex');
    const wrongAmountRes = await app.request('/api/webhooks/payments/premier_bank_gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-premier-signature': wrongAmountSig },
      body: wrongAmountPayload,
    });
    expect(wrongAmountRes.status).toBe(400);

    const wrongCurrPayload = JSON.stringify({
      eventId: 'pb-evt-mismatch-curr',
      eventType: 'premier_bank.card_payment',
      transactionReference: gwOrder.payment.transactionReference,
      providerPaymentId: 'pb-mismatch-2',
      status: 'APPROVED',
      amountCents: gwOrder.order.totalCents,
      currency: 'EUR',
    });
    const wrongCurrSig = crypto
      .createHmac('sha256', config.premierBankWebhookSecret)
      .update(wrongCurrPayload)
      .digest('hex');
    const wrongCurrRes = await app.request('/api/webhooks/payments/premier_bank_gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-premier-signature': wrongCurrSig },
      body: wrongCurrPayload,
    });
    expect(wrongCurrRes.status).toBe(400);

    // Production bootstrap guard when ADMIN_BOOTSTRAP_TOKEN is unset
    const prodDir = fs.mkdtempSync(path.join(tmpDir, 'prod-guard-'));
    const prod = await createApp({
      config: {
        ...config,
        nodeEnv: 'production',
        adminBootstrapToken: '',
      },
    });
    const prodSetup = await prod.app.request('/api/admin/setup-first-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'OwnerPassword123' }),
    });
    expect(prodSetup.status).toBe(403);
  });

  it('enforces super_admin hierarchy and protects the last active super_admin', async () => {
    // Super admin creates a regular admin
    const createRegAdmin = await app.request('/api/admin/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        email: 'junior-admin@example.com',
        password: 'JuniorPassword123',
        fullName: 'Junior Admin',
        isAdmin: true,
      }),
    });
    expect(createRegAdmin.status).toBe(201);
    const juniorId = ((await createRegAdmin.json()) as { customer: { id: string } }).customer.id;

    const juniorLogin = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'junior-admin@example.com', password: 'JuniorPassword123' }),
    });
    expect(juniorLogin.status).toBe(200);
    const juniorCookie = juniorLogin.headers.get('set-cookie')?.split(';')[0] || '';

    // Regular admin cannot create another admin or toggle roles
    const forbiddenCreateAdmin = await app.request('/api/admin/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: juniorCookie },
      body: JSON.stringify({
        email: 'unauth-admin@example.com',
        password: 'Password1234',
        fullName: 'Unauthorized Admin',
        isAdmin: true,
      }),
    });
    expect(forbiddenCreateAdmin.status).toBe(403);

    const forbiddenRoleChange = await app.request(`/api/admin/customers/${customerId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: juniorCookie },
      body: JSON.stringify({ isAdmin: true }),
    });
    expect(forbiddenRoleChange.status).toBe(403);

    // Regular admin cannot suspend or modify the super_admin account
    const meAdmin = await app.request('/api/auth/me', { headers: { Cookie: adminCookie } });
    const superAdminId = ((await meAdmin.json()) as { user: { id: string } }).user.id;

    const forbiddenSuspendSuper = await app.request(`/api/admin/customers/${superAdminId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: juniorCookie },
      body: JSON.stringify({ accountStatus: 'suspended' }),
    });
    expect(forbiddenSuspendSuper.status).toBe(403);

    // Cleanup junior admin role back to customer
    const revokeJunior = await app.request(`/api/admin/customers/${juniorId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isAdmin: false }),
    });
    expect(revokeJunior.status).toBe(200);
  });

  it('supports per-book sale prices, promotions CRUD, non-stacking totals, verified purchase reviews, and category delete guards', async () => {
    // 1. Create an empty category and delete it cleanly
    const emptyCatRes = await app.request('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        slug: 'temp-empty-cat',
        nameEn: 'Temporary Category',
        nameSo: 'Qayb Ku Meel Gaar ah',
        nameAr: 'تصنيف مؤقت',
        descriptionEn: 'English desc',
        descriptionSo: 'Somali desc',
        descriptionAr: 'وصف عربي',
        sortOrder: 99,
        isPublished: false,
      }),
    });
    expect(emptyCatRes.status).toBe(201);
    const emptyCatId = ((await emptyCatRes.json()) as { category: { id: string } }).category.id;

    // Non-empty category cannot be deleted (409)
    const nonEmptyDel = await app.request('/api/admin/categories/cat-history', {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(nonEmptyDel.status).toBe(409);

    const emptyDel = await app.request(`/api/admin/categories/${emptyCatId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(emptyDel.status).toBe(200);

    // 2. Create a paid book with salePriceCents ($20.00 regular, $15.00 sale)
    const promoBookRes = await app.request('/api/admin/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Benadir Trade Chronicles',
        slug: 'benadir-trade-chronicles',
        author: 'Khalid Sharif',
        description: 'Comprehensive trade chronicles along the Benadir littoral.',
        categoryId: 'cat-history',
        language: 'en',
        isFree: false,
        priceCents: 2000,
        salePriceCents: 1500,
        status: 'published',
      }),
    });
    expect(promoBookRes.status).toBe(201);
    const promoBookId = ((await promoBookRes.json()) as { book: { id: string } }).book.id;

    // 3. Create a 40% book promotion -> effectivePriceCents becomes 1200 ($12.00)
    const createPromo = await app.request('/api/admin/promotions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Chronicles Launch 40%',
        scope: 'book',
        targetId: promoBookId,
        discountType: 'percent',
        discountValue: 40,
        isActive: true,
      }),
    });
    expect(createPromo.status).toBe(201);
    const promoId = ((await createPromo.json()) as { promotion: { id: string } }).promotion.id;

    const bookDetailRes = await app.request('/api/books/benadir-trade-chronicles');
    expect(bookDetailRes.status).toBe(200);
    const bookDetailJson = (await bookDetailRes.json()) as {
      book: { priceCents: number; salePriceCents: number; effectivePriceCents: number; promotionLabel: string };
    };
    expect(bookDetailJson.book.priceCents).toBe(2000);
    expect(bookDetailJson.book.salePriceCents).toBe(1500);
    expect(bookDetailJson.book.effectivePriceCents).toBe(1200);
    expect(bookDetailJson.book.promotionLabel).toBe('-40%');

    // Non-stacking checkout with RAMADAN25 (25% = 1500) vs 40% book promotion (1200) uses 1200
    const promoCheckout = await app.request('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({
        bookIds: [promoBookId],
        paymentMethodCode: 'manual_transfer',
        discountCode: 'RAMADAN25',
      }),
    });
    expect(promoCheckout.status).toBe(201);
    const promoOrder = ((await promoCheckout.json()) as { order: { id: string; subtotalCents: number; discountCents: number; totalCents: number } }).order;
    expect(promoOrder.subtotalCents).toBe(2000);
    expect(promoOrder.discountCents).toBe(800);
    expect(promoOrder.totalCents).toBe(1200);

    // Non-entitled customer review has verifiedPurchase: false
    const unverifiedRev = await app.request(`/api/books/${promoBookId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ rating: 4, comment: 'Looking forward to reading the full chronicle.' }),
    });
    expect(unverifiedRev.status).toBe(201);
    expect(((await unverifiedRev.json()) as { review: { verifiedPurchase?: boolean } }).review.verifiedPurchase).toBe(false);

    // Admin verifies order -> customer now has entitlement -> updated review has verifiedPurchase: true
    await app.request(`/api/admin/orders/${promoOrder.id}/verify-payment`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const verifiedRev = await app.request(`/api/books/${promoBookId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: customerCookie },
      body: JSON.stringify({ rating: 5, comment: 'Verified purchase and thorough historical documentation.' }),
    });
    expect(verifiedRev.status).toBe(201);
    expect(((await verifiedRev.json()) as { review: { verifiedPurchase?: boolean } }).review.verifiedPurchase).toBe(true);

    // Delete promotion cleans up cleanly
    const delPromo = await app.request(`/api/admin/promotions/${promoId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delPromo.status).toBe(200);
  });

  it('exposes only Mastercard / Visa payment providers, supports HTTP Range & HEAD PDF streaming, free sample previews, PDF receipts, pagination, CSV export, and security/CSRF headers', async () => {
    // 1. Public & Admin payment endpoints strictly expose Mastercard / Visa only (online_gateway)
    const publicMethodsRes = await app.request('/api/payment-methods');
    expect(publicMethodsRes.status).toBe(200);
    const publicMethods = ((await publicMethodsRes.json()) as { methods: Array<{ code: string; providerType: string }> }).methods;
    expect(publicMethods.length).toBeGreaterThan(0);
    expect(publicMethods.every((m) => m.providerType === 'online_gateway' && m.code === 'premier_bank_gateway')).toBe(true);

    const adminProvidersRes = await app.request('/api/admin/payment-providers', {
      headers: { Cookie: adminCookie },
    });
    expect(adminProvidersRes.status).toBe(200);
    const adminProviders = ((await adminProvidersRes.json()) as { providers: Array<{ code: string; providerType: string }> }).providers;
    expect(adminProviders.length).toBeGreaterThan(0);
    expect(adminProviders.every((p) => p.providerType === 'online_gateway' && p.code === 'premier_bank_gateway')).toBe(true);

    // 2. Security headers & CSRF Origin verification
    expect(publicMethodsRes.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(publicMethodsRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');

    const csrfRes = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: customerCookie,
        Origin: 'https://evil-attacker.invalid',
      },
      body: JSON.stringify({ fullName: 'Blocked CSRF' }),
    });
    expect(csrfRes.status).toBe(403);
    expect(((await csrfRes.json()) as { code?: string }).code).toBe('CSRF_ORIGIN_MISMATCH');

    // 3. HTTP Range (206 / 416) & HEAD support on full PDF stream
    const freeSessRes = await app.request(`/api/books/${freeBookId}/pdf-session`, { method: 'POST' });
    expect(freeSessRes.status).toBe(200);
    const { signedUrl: freePdfUrl } = (await freeSessRes.json()) as { signedUrl: string };

    const headPdfRes = await app.request(freePdfUrl, { method: 'HEAD' });
    expect(headPdfRes.status).toBe(200);
    expect(headPdfRes.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(headPdfRes.headers.get('content-length'))).toBeGreaterThan(100);

    const rangePdfRes = await app.request(freePdfUrl, {
      headers: { Range: 'bytes=0-99' },
    });
    expect(rangePdfRes.status).toBe(206);
    expect(rangePdfRes.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
    const partialBuf = new Uint8Array(await rangePdfRes.arrayBuffer());
    expect(partialBuf.byteLength).toBe(100);
    expect(Buffer.from(partialBuf.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const invalidRangeRes = await app.request(freePdfUrl, {
      headers: { Range: 'bytes=99999999-' },
    });
    expect(invalidRangeRes.status).toBe(416);

    // 4. Non-entitled user is blocked from paid book PDF and sample-session endpoint is removed
    const guestReaderReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sample-guest@example.com',
        password: 'StrongPassword123',
        fullName: '=CMD("calc")',
      }),
    });
    expect(guestReaderReg.status).toBe(201);
    const guestCookie = guestReaderReg.headers.get('set-cookie')?.split(';')[0] || '';

    const fullBlockedRes = await app.request(`/api/books/${paidBookId}/pdf-session`, {
      method: 'POST',
      headers: { Cookie: guestCookie },
    });
    expect(fullBlockedRes.status).toBe(403);

    const sampleRemovedRes = await app.request(`/api/books/${paidBookId}/sample-session`, {
      method: 'POST',
      headers: { Cookie: guestCookie },
    });
    expect(sampleRemovedRes.status).toBe(404);

    // 5. PDF Order Receipt download + cross-user access guard
    const custOrdersRes = await app.request('/api/account/orders', {
      headers: { Cookie: customerCookie },
    });
    expect(custOrdersRes.status).toBe(200);
    const custOrders = ((await custOrdersRes.json()) as { orders: Array<{ id: string }> }).orders;
    expect(custOrders.length).toBeGreaterThan(0);
    const targetOrderId = custOrders[0].id;

    const receiptRes = await app.request(`/api/orders/${targetOrderId}/receipt`, {
      headers: { Cookie: customerCookie },
    });
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.headers.get('content-type')).toBe('application/pdf');
    const receiptBytes = new Uint8Array(await receiptRes.arrayBuffer());
    expect(Buffer.from(receiptBytes.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const otherReceiptRes = await app.request(`/api/orders/${targetOrderId}/receipt`, {
      headers: { Cookie: guestCookie },
    });
    expect(otherReceiptRes.status).toBe(404);

    // 6. Server-side pagination & RFC 4180 CSV export with formula neutralization
    const pagedOrdersRes = await app.request('/api/admin/orders?page=1&pageSize=1', {
      headers: { Cookie: adminCookie },
    });
    expect(pagedOrdersRes.status).toBe(200);
    const pagedOrders = (await pagedOrdersRes.json()) as { orders: unknown[]; total: number; page: number; pageSize: number };
    expect(pagedOrders.orders.length).toBe(1);
    expect(pagedOrders.total).toBeGreaterThanOrEqual(2);
    expect(pagedOrders.page).toBe(1);
    expect(pagedOrders.pageSize).toBe(1);

    const pagedCustomersRes = await app.request('/api/admin/customers?page=1&pageSize=2', {
      headers: { Cookie: adminCookie },
    });
    expect(pagedCustomersRes.status).toBe(200);
    const pagedCustomers = (await pagedCustomersRes.json()) as { customers: unknown[]; total: number; page: number; pageSize: number };
    expect(pagedCustomers.customers.length).toBe(2);
    expect(pagedCustomers.total).toBeGreaterThanOrEqual(3);

    const ordersCsvRes = await app.request('/api/admin/orders/export', {
      headers: { Cookie: adminCookie },
    });
    expect(ordersCsvRes.status).toBe(200);
    expect(ordersCsvRes.headers.get('content-type')).toContain('text/csv');
    expect(await ordersCsvRes.text()).toContain('Order Reference,Status,Customer Name');

    const customersCsvRes = await app.request('/api/admin/customers/export', {
      headers: { Cookie: adminCookie },
    });
    expect(customersCsvRes.status).toBe(200);
    const customersCsv = await customersCsvRes.text();
    expect(customersCsv).toContain('sample-guest@example.com');
    expect(customersCsv).toContain("'=CMD(");
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
  });

  it('enforces email verification before checkout when enabled and enforces persistent DB rate limiting with Retry-After', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksdl-hardening-'));
    try {
      const isolatedConfig: ServerConfig = {
        ...config,
        requireEmailVerification: true,
      };
      const { app: hardenedApp, runtime: hardenedRuntime } = await createApp({ config: isolatedConfig });
      await hardenedRuntime.repo.updatePaymentProviderConfig('manual_transfer', {
        isEnabled: true,
        instructionsEn: 'Test transfer',
        instructionsSo: 'Tijaabo',
        instructionsAr: 'اختبار',
      });

      const regRes = await hardenedApp.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'verify-check@example.com',
          password: 'StrongPassword123',
          fullName: 'Verify Check User',
        }),
      });
      expect(regRes.status).toBe(201);
      const userJson = (await regRes.json()) as { user: { id: string; emailVerified: boolean } };
      expect(userJson.user.emailVerified).toBe(false);
      const userCookie = regRes.headers.get('set-cookie')?.split(';')[0] || '';

      const catRes = await hardenedApp.request('/api/books?price=paid');
      const paidId = ((await catRes.json()) as { items: Array<{ id: string }> }).items[0].id;

      // Checkout blocked while unverified
      const blockedCheckout = await hardenedApp.request('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ bookIds: [paidId], paymentMethodCode: 'manual_transfer' }),
      });
      expect(blockedCheckout.status).toBe(403);
      expect(((await blockedCheckout.json()) as { code?: string }).code).toBe('EMAIL_VERIFICATION_REQUIRED');

      // Resend verification succeeds, then verifying signed token unlocks checkout
      const resendRes = await hardenedApp.request('/api/auth/resend-verification', {
        method: 'POST',
        headers: { Cookie: userCookie },
      });
      expect(resendRes.status).toBe(200);

      const verifyToken = signToken({ sub: userJson.user.id, typ: 'email_verify' }, isolatedConfig.sessionSecret, 86400);
      const verifyRes = await hardenedApp.request(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`);
      expect(verifyRes.status).toBe(200);

      const allowedCheckout = await hardenedApp.request('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ bookIds: [paidId], paymentMethodCode: 'manual_transfer' }),
      });
      expect(allowedCheckout.status).toBe(201);

      // Persistent DB rate limiting blocks after exceeding resend-verification limit (5/60s)
      const secondUserReg = await hardenedApp.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ratelimit-user@example.com',
          password: 'StrongPassword123',
          fullName: 'Rate Limit User',
        }),
      });
      const secondCookie = secondUserReg.headers.get('set-cookie')?.split(';')[0] || '';
      let hit429 = false;
      for (let i = 0; i < 6; i++) {
        const res = await hardenedApp.request('/api/auth/resend-verification', {
          method: 'POST',
          headers: { Cookie: secondCookie },
        });
        if (res.status === 429) {
          hit429 = true;
          expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
          expect(((await res.json()) as { code?: string }).code).toBe('RATE_LIMIT_EXCEEDED');
          break;
        }
      }
      expect(hit429).toBe(true);
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it('uploads valid cover images, rejects invalid cover files, attaches/clears coverUrl via quick update, and respects x-forwarded-host when trustProxy is enabled', async () => {
    // 1. Valid PNG upload via multipart/form-data
    const tinyPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const validFd = new FormData();
    validFd.append('file', new Blob([tinyPng], { type: 'image/png' }), 'cover.png');

    const upRes = await app.request('/api/admin/upload-cover', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: validFd,
    });
    expect(upRes.status).toBe(201);
    const { coverUrl } = (await upRes.json()) as { coverUrl: string };
    expect(coverUrl).toMatch(/^\/uploads\/covers\/cover-.*\.png$/);

    const servedCoverRes = await app.request(coverUrl);
    expect(servedCoverRes.status).toBe(200);
    expect(servedCoverRes.headers.get('content-type')).toBe('image/png');

    // 2. Reject invalid image signature
    const badFd = new FormData();
    badFd.append('file', new Blob([Buffer.from('not-an-image-bytes')], { type: 'image/png' }), 'fake.png');
    const badUpRes = await app.request('/api/admin/upload-cover', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: badFd,
    });
    expect(badUpRes.status).toBe(400);

    // 3. Attach and clear coverUrl via quick update
    const attachRes = await app.request(`/api/admin/books/${paidBookId}/quick`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ coverUrl }),
    });
    expect(attachRes.status).toBe(200);
    expect(((await attachRes.json()) as { book: { coverUrl: string | null } }).book.coverUrl).toBe(coverUrl);

    const clearRes = await app.request(`/api/admin/books/${paidBookId}/quick`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ coverUrl: null }),
    });
    expect(clearRes.status).toBe(200);
    expect(((await clearRes.json()) as { book: { coverUrl: string | null } }).book.coverUrl).toBeNull();

    // 4. trustProxy allows matching X-Forwarded-Host Origin on cookie-authenticated POST
    const proxyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksdl-proxy-'));
    try {
      const { app: proxyApp, runtime: proxyRuntime } = await createApp({
        config: {
          ...config,
          trustProxy: true,
        },
      });
      await proxyRuntime.repo.listCategories(true);
      const regRes = await proxyApp.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'proxy-user@example.com', password: 'StrongPassword123', fullName: 'Proxy User' }),
      });
      const proxyCookie = regRes.headers.get('set-cookie')?.split(';')[0] || '';
      const forwardedOk = await proxyApp.request('/api/account/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: proxyCookie,
          Host: 'localhost:3000',
          'X-Forwarded-Host': 'preview.example.run.app',
          Origin: 'https://preview.example.run.app',
        },
        body: JSON.stringify({
          fullName: 'Proxy Verified User',
          preferredLanguage: 'en',
          preferredTheme: 'light',
          emailNotifications: true,
        }),
      });
      expect(forwardedOk.status).toBe(200);
    } finally {
      fs.rmSync(proxyDir, { recursive: true, force: true });
    }
  });
});

