import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { ServerConfig } from './config.ts';
import { loadServerConfig } from './config.ts';
import type { ILibraryRepository } from './db/interface.ts';
import { SupabaseLibraryRepository } from './db/supabaseRepository.ts';
import { ensureSupabaseSeedData } from './db/supabaseSeed.ts';
import { applyUserWatermark } from './pdf/generator.ts';
import { buildRangePdfResponse } from './http/pdfRange.ts';
import { generateOrderReceiptPdf } from './pdf/receipt.ts';
import {
  escapeCsvCell,
  hashPassword,
  sha256Hex,
  signToken,
  validateImageMagicBytes,
  validatePdfMagicBytes,
  verifyPassword,
  verifyToken,
} from './security.ts';
import { createEmailService } from './services/email.ts';
import { createPaymentAdapterRegistry, ManualTransferAdapter } from './services/payments.ts';
import { validateGatewayUrl } from './services/secrets.ts';
import { SupabaseStorageService, type IStorageService } from './services/storage.ts';
import {
  adminBookQuickUpdateSchema,
  adminCreateUserSchema,
  adminGrantBooksSchema,
  adminSetupSchema,
  adminUpdateCustomerSchema,
  bookMutationSchema,
  bookmarkCreateSchema,
  categoryMutationSchema,
  changePasswordSchema,
  checkoutCreateSchema,
  contactChannelsUpdateSchema,
  customerRoleUpdateSchema,
  customerStatusUpdateSchema,
  discountCodesUpdateSchema,
  forgotPasswordSchema,
  loginSchema,
  manualReferenceSubmitSchema,
  manualPaymentProviderCreateSchema,
  parsePaginationQuery,
  paymentGatewayCredentialsUpdateSchema,
  paymentProviderUpdateSchema,
  promotionMutationSchema,
  readingProgressSchema,
  registerSchema,
  resetPasswordSchema,
  reviewCreateSchema,
  reviewModerationSchema,
  supabaseSessionExchangeSchema,
  updateProfileSchema,
} from '../shared/validation.ts';
import { canUserAccessBookPdf } from '../shared/commerce.ts';
import type { AccountStatus, UserProfile } from '../shared/types.ts';

const SESSION_COOKIE_NAME = 'ksdl_session';

export interface AppRuntimeContext {
  config: ServerConfig;
  supabase: SupabaseClient;
  storage: IStorageService;
  repo: ILibraryRepository;
  databaseMode: 'supabase_postgres';
}

type HonoEnv = {
  Variables: {
    user: UserProfile | null;
  };
};

export async function createApp(customContext?: Partial<AppRuntimeContext>): Promise<{
  app: Hono<HonoEnv>;
  runtime: AppRuntimeContext;
}> {
  const config = customContext?.config || loadServerConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Supabase is the only supported database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before starting the server.'
    );
  }

  const supabase = customContext?.supabase || createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureSupabaseSeedData(supabase);
  const repo = customContext?.repo || new SupabaseLibraryRepository(supabase);
  const storage = customContext?.storage || new SupabaseStorageService(supabase);
  const databaseMode = 'supabase_postgres' as const;

  const emailService = createEmailService(config);
  const gatewayEnvFallback = {
    gatewayUrl: config.premierBankGatewayUrl,
    merchantId: config.premierBankMerchantId,
    apiKey: config.premierBankApiKey,
    webhookSecret: config.premierBankWebhookSecret,
    sessionSecret: config.sessionSecret,
    gatewayEncryptionKey: config.gatewayEncryptionKey,
    appUrl: config.appUrl,
  };
  const paymentAdapters = createPaymentAdapterRegistry(config, () =>
    repo.getResolvedGatewayConfig('premier_bank_gateway', gatewayEnvFallback)
  );

  const resolvePaymentAdapter = (provider: { code: string; providerType: 'online_gateway' | 'manual' }) =>
    provider.providerType === 'manual'
      ? new ManualTransferAdapter(provider.code)
      : paymentAdapters.get(provider.code);

  const app = new Hono<HonoEnv>();

  function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
    const cfIp = c.req.header('cf-connecting-ip')?.trim();
    if (cfIp) return cfIp;
    if (config.trustProxy) {
      const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (xff) return xff;
    }
    return 'local';
  }

  async function enforceRateLimit(
    c: Context<HonoEnv>,
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<Response | null> {
    const rl = await repo.consumeRateLimit(key, maxRequests, windowSeconds);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return c.json(
        {
          error: 'Too many requests. Please wait before retrying.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSec: rl.retryAfterSec,
        },
        429
      );
    }
    return null;
  }

  async function issueSessionToken(userId: string): Promise<string> {
    const sv = await repo.getSessionVersion(userId);
    return signToken({ sub: userId, typ: 'session', sv }, config.sessionSecret, 60 * 60 * 24 * 7);
  }

  function isHttpsRequest(c: { req: { url: string; header: (name: string) => string | undefined } }): boolean {
    const xfProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    return xfProto === 'https' || c.req.url.startsWith('https://');
  }

  function extractOriginHost(headerVal: string | undefined): string | null {
    if (!headerVal) return null;
    try {
      return new URL(headerVal).host.toLowerCase();
    } catch {
      return null;
    }
  }

  // Global security headers (CSP, HSTS, Clickjacking & MIME sniffing defenses)
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' blob:",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://*.supabase.co",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self' https:",
      ].join('; ')
    );
    if (isHttpsRequest(c)) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (c.req.path.startsWith('/api/account') || c.req.path.startsWith('/api/admin') || c.req.path.startsWith('/api/orders')) {
      c.header('Cache-Control', 'no-store');
    }
  });

  // CSRF origin validation for cookie-authenticated state-changing requests
  app.use('/api/*', async (c, next) => {
    const method = c.req.method.toUpperCase();
    const isUnsafe = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isUnsafe && !c.req.path.startsWith('/api/webhooks/')) {
      const authHeader = c.req.header('authorization');
      const hasBearer = Boolean(authHeader?.startsWith('Bearer '));
      const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
      if (cookieToken && !hasBearer) {
        const originHost = extractOriginHost(c.req.header('origin')) || extractOriginHost(c.req.header('referer'));
        if (originHost) {
          const allowedHosts = new Set<string>();
          try {
            allowedHosts.add(new URL(config.appUrl).host.toLowerCase());
          } catch {
            // ignore malformed appUrl
          }
          const reqHost = c.req.header('host')?.trim().toLowerCase();
          if (reqHost) allowedHosts.add(reqHost);
          if (config.trustProxy) {
            const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
            if (forwardedHost) allowedHosts.add(forwardedHost);
          }
          if (!allowedHosts.has(originHost)) {
            return c.json({ error: 'Cross-site request rejected', code: 'CSRF_ORIGIN_MISMATCH' }, 403);
          }
        }
      }
    }
    await next();
  });

  // Session resolution middleware (cookie or Bearer token; never trusts client-supplied userId)
  app.use('/api/*', async (c, next) => {
    const authHeader = c.req.header('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
    const token = bearerToken || cookieToken;
    let user: UserProfile | null = null;
    if (token) {
      const payload = verifyToken(token, config.sessionSecret, 'session');
      if (payload) {
        const [profile, currentSv] = await Promise.all([
          repo.getUserProfileById(payload.sub),
          repo.getSessionVersion(payload.sub),
        ]);
        const svValid = payload.sv !== undefined ? payload.sv === currentSv : currentSv <= 1;
        if (
          profile &&
          profile.accountStatus === 'active' &&
          svValid &&
          (!config.requireEmailVerification || profile.emailVerified)
        ) {
          user = profile;
        }
      }
    }
    c.set('user', user);
    await next();
  });

  function applySessionCookie(c: Context<HonoEnv>, sessionToken: string): void {
    const isHttps = isHttpsRequest(c);
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: isHttps ? 'None' : 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      secure: isHttps,
    });
  }

  function requireAuth(c: { get: (k: 'user') => UserProfile | null }): UserProfile {
    const user = c.get('user');
    if (!user) {
      throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
    }
    return user;
  }

  function requireAdmin(c: { get: (k: 'user') => UserProfile | null }): UserProfile {
    const user = requireAuth(c);
    if (!user.roles.includes('admin') && !user.roles.includes('super_admin')) {
      throw new HttpError(403, 'Administrator privileges required', 'ADMIN_REQUIRED');
    }
    return user;
  }

  // Health & SEO
  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      service: 'Khalid Sharif Digital Library',
      databaseMode,
      emailConfigured: emailService.isConfigured(),
      emailVerificationRequired: Boolean(config.requireEmailVerification),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/robots.txt', (c) => {
    const body = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /admin-login',
      'Disallow: /account',
      'Disallow: /checkout',
      'Disallow: /reader',
      'Disallow: /api/',
      `Sitemap: ${config.appUrl}/sitemap.xml`,
    ].join('\n');
    return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  });

  app.get('/sitemap.xml', async (c) => {
    const books = (await repo.listBooks({ pageSize: 500 })).items;
    const categories = await repo.listCategories(false);
    const urls = [
      `${config.appUrl}/`,
      `${config.appUrl}/catalog`,
      `${config.appUrl}/categories`,
      `${config.appUrl}/about`,
      `${config.appUrl}/contact`,
      `${config.appUrl}/privacy`,
      `${config.appUrl}/terms`,
      `${config.appUrl}/refund-policy`,
      ...categories.map((cat) => `${config.appUrl}/categories/${cat.slug}`),
      ...books.map((b) => `${config.appUrl}/books/${b.slug}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>`;
    return c.text(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  });

  // ---- AUTH ROUTES ----
  app.post('/api/auth/register', async (c) => {
    const clientIp = getClientIp(c);
    const limited = await enforceRateLimit(c, `register:${clientIp}`, 30, 60);
    if (limited) return limited;

    const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid registration data' }, 400);
    }

    try {
      const user = await repo.createCustomerUser({
        email: parsed.data.email,
        passwordHash: hashPassword(parsed.data.password),
        fullName: parsed.data.fullName,
        preferredLanguage: parsed.data.preferredLanguage,
      });

      const verifyToken = signToken({ sub: user.id, typ: 'email_verify' }, config.sessionSecret, 86400);
      const emailResult = await emailService.send({
        to: user.email,
        subject: 'Verify your Khalid Sharif Digital Library account',
        html: `<p>Welcome ${user.fullName}. Verify your account: <a href="${config.appUrl}/verify-email?token=${verifyToken}">Verify Email</a></p>`,
        text: `Verify your account: ${config.appUrl}/verify-email?token=${verifyToken}`,
      });

      if (config.requireEmailVerification) {
        return c.json({ verificationRequired: true, emailDelivery: emailResult }, 201);
      }

      const sessionToken = await issueSessionToken(user.id);
      applySessionCookie(c, sessionToken);

      return c.json({ user, sessionToken, emailDelivery: emailResult }, 201);
    } catch (err) {
      if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
        return c.json({ error: 'An account with this email already exists' }, 409);
      }
      throw err;
    }
  });

  app.post('/api/auth/login', async (c) => {
    const clientIp = getClientIp(c);
    const limited = await enforceRateLimit(c, `login:${clientIp}`, 30, 60);
    if (limited) return limited;

    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'Email and password are required' }, 400);
    }

    const creds = await repo.findAuthCredentialsByEmail(parsed.data.email);
    if (!creds || !verifyPassword(parsed.data.password, creds.passwordHash)) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    if (creds.accountStatus === 'paused') {
      return c.json(
        { error: 'Your account is temporarily paused. Please contact support to reactivate.' },
        403
      );
    }
    if (creds.accountStatus !== 'active') {
      return c.json({ error: 'Account is suspended' }, 403);
    }

    const user = (await repo.getUserProfileById(creds.id))!;
    if (config.requireEmailVerification && !user.emailVerified) {
      return c.json(
        { error: 'Please verify your email using the link we sent before signing in.', code: 'EMAIL_VERIFICATION_REQUIRED' },
        403
      );
    }
    const sessionToken = await issueSessionToken(user.id);
    applySessionCookie(c, sessionToken);

    return c.json({ user, sessionToken });
  });

  app.post('/api/auth/logout', async (c) => {
    const currentUser = c.get('user');
    if (currentUser) {
      await repo.incrementSessionVersion(currentUser.id);
    }
    const isHttps = isHttpsRequest(c);
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: isHttps ? 'None' : 'Lax',
      secure: isHttps,
    });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const user = c.get('user');
    return c.json({ user });
  });

  app.post('/api/auth/forgot-password', async (c) => {
    const clientIp = getClientIp(c);
    const limited = await enforceRateLimit(c, `forgot:${clientIp}`, 20, 60);
    if (limited) return limited;

    const parsed = forgotPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Valid email is required' }, 400);

    const creds = await repo.findAuthCredentialsByEmail(parsed.data.email);
    if (!creds) {
      return c.json({
        accepted: true,
        emailSent: false,
        emailStatus: emailService.isConfigured() ? 'not_applicable' : 'not_configured',
        message: emailService.isConfigured()
          ? 'If an account matches this email, a reset link has been sent.'
          : 'Password reset emails are currently unavailable. Please contact support for assistance.',
      });
    }

    const resetToken = signToken({ sub: creds.id, typ: 'password_reset' }, config.sessionSecret, 1800);
    const emailResult = await emailService.send({
      to: parsed.data.email,
      subject: 'Reset your Khalid Sharif Digital Library password',
      html: `<p>Reset your password: <a href="${config.appUrl}/reset-password?token=${resetToken}">Reset Password</a></p>`,
      text: `Reset your password: ${config.appUrl}/reset-password?token=${resetToken}`,
    });

    return c.json({
      accepted: true,
      emailSent: emailResult.sent,
      emailStatus: emailResult.status,
      reason: emailResult.reason,
    });
  });

  app.post('/api/auth/reset-password', async (c) => {
    const limited = await enforceRateLimit(c, `reset:${getClientIp(c)}`, 20, 60);
    if (limited) return limited;

    const parsed = resetPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid reset payload' }, 400);

    const payload = verifyToken(parsed.data.token, config.sessionSecret, 'password_reset');
    if (!payload) return c.json({ error: 'Reset token is invalid or expired' }, 400);

    const tokenHash = sha256Hex(payload.jti || parsed.data.token);
    const consumed = await repo.consumeSingleUseToken(
      tokenHash,
      'password_reset',
      new Date(payload.exp * 1000).toISOString()
    );
    if (!consumed) {
      return c.json({ error: 'Reset token has already been used' }, 400);
    }

    await repo.updatePasswordHash(payload.sub, hashPassword(parsed.data.newPassword));
    return c.json({ ok: true });
  });

  async function verifyEmailTokenString(rawToken: string): Promise<{ ok: boolean; error?: string }> {
    const payload = rawToken ? verifyToken(rawToken, config.sessionSecret, 'email_verify') : null;
    if (!payload) return { ok: false, error: 'Verification token is invalid or expired' };

    const tokenHash = sha256Hex(payload.jti || rawToken);
    const consumed = await repo.consumeSingleUseToken(
      tokenHash,
      'email_verify',
      new Date(payload.exp * 1000).toISOString()
    );
    if (!consumed) {
      return { ok: false, error: 'Verification token has already been used' };
    }

    await repo.markEmailVerified(payload.sub);
    return { ok: true };
  }

  app.post('/api/auth/verify-email', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const result = await verifyEmailTokenString(body.token || '');
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true });
  });

  app.get('/api/auth/verify-email', async (c) => {
    const token = c.req.query('token') || '';
    const result = await verifyEmailTokenString(token);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true });
  });

  app.post('/api/auth/resend-verification', async (c) => {
    const limited = await enforceRateLimit(c, `resend-verify:${getClientIp(c)}`, 5, 3600);
    if (limited) return limited;

    const parsed = forgotPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Valid email is required' }, 400);

    const creds = await repo.findAuthCredentialsByEmail(parsed.data.email);
    const user = creds ? await repo.getUserProfileById(creds.id) : null;
    if (!user || user.emailVerified) return c.json({ ok: true });

    const verifyToken = signToken({ sub: user.id, typ: 'email_verify' }, config.sessionSecret, 86400);
    const emailDelivery = await emailService.send({
      to: user.email,
      subject: 'Verify your Khalid Sharif Digital Library account',
      html: `<p>Hello ${user.fullName}, please verify your account: <a href="${config.appUrl}/verify-email?token=${verifyToken}">Verify Email</a></p>`,
      text: `Verify your account: ${config.appUrl}/verify-email?token=${verifyToken}`,
    });

    return c.json({ ok: true, emailSent: emailDelivery.sent });
  });

  app.post('/api/auth/supabase-session', async (c) => {
    const limited = await enforceRateLimit(c, `supabase-session:${getClientIp(c)}`, 20, 60);
    if (limited) return limited;

    if (!supabase) {
      return c.json({ error: 'Supabase authentication is not enabled on this server' }, 400);
    }

    const parsed = supabaseSessionExchangeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid Supabase access token' }, 400);
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(parsed.data.accessToken);
    if (authErr || !authData?.user || !authData.user.email) {
      return c.json({ error: 'Invalid or expired Supabase session token' }, 401);
    }

    const email = authData.user.email.trim().toLowerCase();
    let creds = await repo.findAuthCredentialsByEmail(email);
    let userId: string;

    if (!creds) {
      const metadataName =
        typeof authData.user.user_metadata?.full_name === 'string' && authData.user.user_metadata.full_name.trim().length >= 2
          ? authData.user.user_metadata.full_name.trim()
          : email.split('@')[0] || 'Library Reader';
      const created = await repo.createCustomerUser({
        email,
        passwordHash: hashPassword(crypto.randomBytes(24).toString('hex')),
        fullName: metadataName,
        preferredLanguage: 'so',
      });
      userId = created.id;
    } else {
      if (creds.accountStatus === 'paused') {
        return c.json({ error: 'Your account is temporarily paused. Please contact support to reactivate.' }, 403);
      }
      if (creds.accountStatus !== 'active') {
        return c.json({ error: 'Account is suspended' }, 403);
      }
      userId = creds.id;
    }

    let profile = await repo.getUserProfileById(userId);
    if (!profile) {
      return c.json({ error: 'User profile could not be resolved' }, 404);
    }

    if (authData.user.email_confirmed_at && !profile.emailVerified) {
      await repo.markEmailVerified(profile.id);
      profile = (await repo.getUserProfileById(profile.id))!;
    }

    const sessionToken = await issueSessionToken(profile.id);
    applySessionCookie(c, sessionToken);
    return c.json({ user: profile, sessionToken });
  });

  // Public status check; exposes setup state only, never the bootstrap token itself.
  app.get('/api/admin/bootstrap-status', async (c) => {
    return c.json({
      bootstrapTokenConfigured: Boolean(config.adminBootstrapToken),
      hasAdmin: await repo.hasAnyAdmin(),
    });
  });

  // Secure admin bootstrap using explicit server environment token (never hardcoded)
  app.post('/api/admin/bootstrap', async (c) => {
    const limited = await enforceRateLimit(c, `bootstrap:${getClientIp(c)}`, 15, 60);
    if (limited) return limited;

    const user = requireAuth(c);
    if (!config.adminBootstrapToken) {
      return c.json({ error: 'ADMIN_BOOTSTRAP_TOKEN is not configured on this server' }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { bootstrapToken?: string };
    const provided = body.bootstrapToken || '';
    const a = Buffer.from(provided);
    const b = Buffer.from(config.adminBootstrapToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return c.json({ error: 'Invalid bootstrap token' }, 403);
    }
    await repo.grantAdminRole(user.id, user.id, 'super_admin');
    await repo.logAdminAction({
      actorUserId: user.id,
      action: 'admin_bootstrap',
      entityType: 'user_roles',
      entityId: user.id,
    });
    return c.json({ user: await repo.getUserProfileById(user.id) });
  });

  app.get('/api/admin/access-status', async (c) => {
    return c.json({
      hasAdmin: await repo.hasAnyAdmin(),
      requiresBootstrapToken: Boolean(config.adminBootstrapToken),
    });
  });

  app.post('/api/admin/setup-first-admin', async (c) => {
    const clientIp = getClientIp(c);
    const limited = await enforceRateLimit(c, `admin-setup:${clientIp}`, 15, 60);
    if (limited) return limited;

    if (config.nodeEnv === 'production' && !config.adminBootstrapToken) {
      return c.json({ error: 'First administrator setup requires ADMIN_BOOTSTRAP_TOKEN in production' }, 403);
    }

    const parsed = adminSetupSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid administrator setup payload' }, 400);
    }

    if (config.adminBootstrapToken) {
      const provided = parsed.data.bootstrapToken || '';
      const a = Buffer.from(provided);
      const b = Buffer.from(config.adminBootstrapToken);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return c.json({ error: 'Invalid administrator setup token' }, 403);
      }
    }

    try {
      const user = await repo.setupFirstAdminAtomic({
        email: parsed.data.email,
        rawPassword: parsed.data.password,
        passwordHash: hashPassword(parsed.data.password),
        verifyPasswordFn: verifyPassword,
        fullName: parsed.data.fullName || 'Library Admin',
        preferredLanguage: 'so',
      });

      const sessionToken = await issueSessionToken(user.id);
      applySessionCookie(c, sessionToken);
      await repo.logAdminAction({
        actorUserId: user.id,
        action: 'admin_setup_first',
        entityType: 'user_roles',
        entityId: user.id,
      });

      return c.json({ user, sessionToken }, 201);
    } catch (err) {
      if (err instanceof Error && err.message === 'ADMIN_ALREADY_EXISTS') {
        return c.json({ error: 'An administrator account already exists. Please sign in.' }, 409);
      }
      if (err instanceof Error && err.message === 'EXISTING_ACCOUNT_PASSWORD_MISMATCH') {
        return c.json({ error: 'An account with this email already exists with a different password.' }, 409);
      }
      throw err;
    }
  });

  app.post('/api/admin/login', async (c) => {
    const clientIp = getClientIp(c);
    const limited = await enforceRateLimit(c, `admin-login:${clientIp}`, 30, 60);
    if (limited) return limited;

    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'Email and password are required' }, 400);
    }

    const creds = await repo.findAuthCredentialsByEmail(parsed.data.email);
    if (!creds || !verifyPassword(parsed.data.password, creds.passwordHash)) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    if (creds.accountStatus === 'paused') {
      return c.json(
        { error: 'Your account is temporarily paused. Please contact support to reactivate.' },
        403
      );
    }
    if (creds.accountStatus !== 'active') {
      return c.json({ error: 'Account is suspended' }, 403);
    }
    if (!(await repo.isAdmin(creds.id))) {
      return c.json({ error: 'Administrator privileges required' }, 403);
    }

    const user = (await repo.getUserProfileById(creds.id))!;
    const sessionToken = await issueSessionToken(user.id);
    applySessionCookie(c, sessionToken);
    await repo.logAdminAction({
      actorUserId: user.id,
      action: 'admin_login',
      entityType: 'profiles',
      entityId: user.id,
    });

    return c.json({ user, sessionToken });
  });

  // ---- PUBLIC STOREFRONT & CATALOG ----
  app.get('/api/homepage', async (c) => {
    const [sections, categories, featuredRes, latestRes, popularRes, recommendedRes, freeRes, paidRes] =
      await Promise.all([
        repo.listHomepageSections(false),
        repo.listCategories(false),
        repo.listBooks({ featuredOnly: true, pageSize: 6 }),
        repo.listBooks({ sort: 'newest', pageSize: 6 }),
        repo.listBooks({ sort: 'popular', pageSize: 6 }),
        repo.listBooks({ recommendedOnly: true, pageSize: 6 }),
        repo.listBooks({ priceFilter: 'free', pageSize: 6 }),
        repo.listBooks({ priceFilter: 'paid', pageSize: 6 }),
      ]);
    return c.json({
      sections,
      categories,
      collections: {
        featured: featuredRes.items,
        latest: latestRes.items,
        popular: popularRes.items,
        recommended: recommendedRes.items,
        free: freeRes.items,
        paid: paidRes.items,
      },
    });
  });

  app.get('/api/contact-channels', async (c) => {
    return c.json({ channels: await repo.listContactChannels(false) });
  });

  app.get('/api/categories', async (c) => {
    return c.json({ categories: await repo.listCategories(false) });
  });

  app.get('/api/categories/:slug', async (c) => {
    const category = await repo.getCategoryBySlug(c.req.param('slug'), false);
    if (!category) return c.json({ error: 'Category not found' }, 404);
    const books = (await repo.listBooks({ categorySlug: category.slug, pageSize: 50 })).items;
    return c.json({ category, books });
  });

  app.get('/api/books', async (c) => {
    const search = c.req.query('q') || '';
    const category = c.req.query('category') || 'all';
    const price = (c.req.query('price') || 'all') as 'all' | 'free' | 'paid';
    const language = c.req.query('lang') || 'all';
    const sort = (c.req.query('sort') || 'newest') as 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'alpha';
    const page = Number(c.req.query('page') || 1);
    const pageSize = Number(c.req.query('pageSize') || 12);

    const result = await repo.listBooks({
      search,
      categorySlug: category,
      priceFilter: price,
      language,
      sort,
      page,
      pageSize,
    });
    return c.json(result);
  });

  app.get('/api/books/:slugOrId', async (c) => {
    const user = c.get('user');
    const isAdmin = user ? await repo.isAdmin(user.id) : false;
    const book = await repo.getBookBySlugOrId(c.req.param('slugOrId'), isAdmin);
    if (!book) return c.json({ error: 'Book not found' }, 404);

    const hasEntitlement = user ? await repo.hasActiveEntitlement(user.id, book.id) : false;
    const canRead = canUserAccessBookPdf({ book, hasActiveEntitlement: hasEntitlement, isAdmin });
    const [related, reviews, readerState, wishlist, cart] = await Promise.all([
      repo.getRelatedBooks(book, 4),
      repo.listReviewsForBook(book.id),
      user && canRead ? repo.getReaderState(user.id, book.id) : Promise.resolve(null),
      user ? repo.getWishlist(user.id) : Promise.resolve([]),
      user ? repo.getCartItems(user.id) : Promise.resolve([]),
    ]);

    return c.json({
      book,
      access: {
        canRead,
        hasEntitlement,
        inWishlist: wishlist.some((b) => b.id === book.id),
        inCart: cart.some((ci) => ci.bookId === book.id),
      },
      related,
      reviews,
      readerState,
    });
  });

  app.post('/api/books/:id/reviews', async (c) => {
    const user = requireAuth(c);
    const book = await repo.getBookBySlugOrId(c.req.param('id'), false);
    if (!book) return c.json({ error: 'Book not found' }, 404);
    const parsed = reviewCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid review' }, 400);
    const review = await repo.upsertReview(user.id, book.id, parsed.data.rating, parsed.data.comment);
    return c.json({ review }, 201);
  });

  app.get('/api/promotions/active', async (c) => {
    return c.json({ promotions: await repo.listPromotions(true) });
  });

  // ---- PROTECTED PDF ACCESS & READER ----
  app.post('/api/books/:id/pdf-session', async (c) => {
    const user = c.get('user');
    const limited = await enforceRateLimit(c, `pdf:${user?.id || getClientIp(c)}`, 120, 60);
    if (limited) return limited;

    const isAdmin = user ? await repo.isAdmin(user.id) : false;
    const book = await repo.getBookBySlugOrId(c.req.param('id'), isAdmin);
    if (!book) return c.json({ error: 'Book not found' }, 404);

    const hasEntitlement = user ? await repo.hasActiveEntitlement(user.id, book.id) : false;
    const allowed = canUserAccessBookPdf({ book, hasActiveEntitlement: hasEntitlement, isAdmin });
    if (!allowed) {
      return c.json(
        {
          error: user
            ? 'Verified purchase entitlement is required to read this paid book.'
            : 'Please sign in and purchase this book to read it.',
        },
        403
      );
    }

    const fileMeta = await repo.getActiveBookFile(book.id);
    if (!fileMeta) {
      return c.json({ error: 'This book is not available for reading right now.' }, 404);
    }

    // Short-lived (5-minute) signed PDF access token
    const token = signToken(
      { sub: user?.id || 'guest-free-reader', typ: 'pdf_access', bookId: book.id },
      config.sessionSecret,
      300
    );

    return c.json({
      signedUrl: `/api/books/${book.id}/pdf?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 300,
    });
  });

  async function handleProtectedPdfRequest(c: Context<HonoEnv>): Promise<Response> {
    const bookId = c.req.param('id') || '';
    const token = c.req.query('token') || '';
    const payload = verifyToken(token, config.sessionSecret, 'pdf_access');
    if (!payload || payload.bookId !== bookId) {
      return c.json({ error: 'Invalid or expired PDF access token' }, 401);
    }

    let readerProfile: UserProfile | null = null;
    if (payload.sub !== 'guest-free-reader') {
      readerProfile = await repo.getUserProfileById(payload.sub);
      if (!readerProfile || readerProfile.accountStatus !== 'active') {
        return c.json({ error: 'Account is not active' }, 403);
      }
    }

    const book = await repo.getBookBySlugOrId(bookId, true);
    if (!book) return c.json({ error: 'Book not found' }, 404);

    // Re-verify live entitlement in DB for paid books
    if (!book.isFree) {
      const isAdmin = await repo.isAdmin(payload.sub);
      const entitled = await repo.hasActiveEntitlement(payload.sub, book.id);
      if (!isAdmin && (!entitled || book.status !== 'published')) {
        return c.json({ error: 'Access revoked or entitlement missing' }, 403);
      }
    } else if (book.status !== 'published' && !(await repo.isAdmin(payload.sub))) {
      return c.json({ error: 'Book is not published' }, 403);
    }

    const fileMeta = await repo.getActiveBookFile(book.id);
    if (!fileMeta) return c.json({ error: 'This book file is temporarily unavailable. Please contact support.' }, 404);

    let bytes = await storage.readPrivatePdf(fileMeta.storagePath);
    if (!bytes) {
      return c.json({ error: 'This book file is temporarily unavailable. Please contact support.' }, 404);
    }

    if (!book.isFree && book.watermarkEnabled && readerProfile) {
      bytes = await applyUserWatermark(
        bytes,
        `Licensed to ${readerProfile.email} · Khalid Sharif Digital Library`
      );
    }

    return buildRangePdfResponse({
      rangeHeader: c.req.header('range'),
      method: c.req.method,
      pdfBytes: bytes,
      headers: {
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  app.get('/api/books/:id/pdf', handleProtectedPdfRequest);
  app.on('HEAD', '/api/books/:id/pdf', handleProtectedPdfRequest);

  app.get('/api/reader/:bookId/state', async (c) => {
    const user = requireAuth(c);
    const isAdmin = await repo.isAdmin(user.id);
    const book = await repo.getBookBySlugOrId(c.req.param('bookId'), isAdmin);
    if (!book) return c.json({ error: 'Book not found' }, 404);
    if (!canUserAccessBookPdf({ book, hasActiveEntitlement: await repo.hasActiveEntitlement(user.id, book.id), isAdmin })) {
      return c.json({ error: 'Access denied' }, 403);
    }
    return c.json(await repo.getReaderState(user.id, book.id));
  });

  app.put('/api/reader/:bookId/progress', async (c) => {
    const user = requireAuth(c);
    const isAdmin = await repo.isAdmin(user.id);
    const book = await repo.getBookBySlugOrId(c.req.param('bookId'), isAdmin);
    if (!book) return c.json({ error: 'Book not found' }, 404);
    if (!canUserAccessBookPdf({ book, hasActiveEntitlement: await repo.hasActiveEntitlement(user.id, book.id), isAdmin })) {
      return c.json({ error: 'Access denied' }, 403);
    }
    const parsed = readingProgressSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid reading progress' }, 400);
    const progress = await repo.saveReadingProgress(user.id, book.id, parsed.data.currentPage, parsed.data.totalPages);
    return c.json({ progress });
  });

  app.post('/api/reader/:bookId/bookmarks', async (c) => {
    const user = requireAuth(c);
    const isAdmin = await repo.isAdmin(user.id);
    const book = await repo.getBookBySlugOrId(c.req.param('bookId'), isAdmin);
    if (!book) return c.json({ error: 'Book not found' }, 404);
    if (!canUserAccessBookPdf({ book, hasActiveEntitlement: await repo.hasActiveEntitlement(user.id, book.id), isAdmin })) {
      return c.json({ error: 'Access denied' }, 403);
    }
    const parsed = bookmarkCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid bookmark' }, 400);
    const bookmarks = await repo.addBookmark(user.id, book.id, parsed.data.pageNumber, parsed.data.label);
    return c.json({ bookmarks }, 201);
  });

  app.delete('/api/reader/:bookId/bookmarks/:bookmarkId', async (c) => {
    const user = requireAuth(c);
    const bookmarks = await repo.deleteBookmark(user.id, c.req.param('bookId'), c.req.param('bookmarkId'));
    return c.json({ bookmarks });
  });

  // ---- CUSTOMER ACCOUNT ----
  app.patch('/api/account/profile', async (c) => {
    const user = requireAuth(c);
    const parsed = updateProfileSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid settings' }, 400);
    const updated = await repo.updateProfile(user.id, parsed.data);
    return c.json({ user: updated });
  });

  app.post('/api/account/change-password', async (c) => {
    const user = requireAuth(c);
    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid password payload' }, 400);
    }
    const creds = await repo.findAuthCredentialsByEmail(user.email);
    if (!creds || !verifyPassword(parsed.data.currentPassword, creds.passwordHash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
    await repo.updatePasswordHash(user.id, hashPassword(parsed.data.newPassword));
    const sessionToken = await issueSessionToken(user.id);
    applySessionCookie(c, sessionToken);
    return c.json({ ok: true, sessionToken });
  });

  app.get('/api/account/library', async (c) => {
    const user = requireAuth(c);
    return c.json({ items: await repo.listLibraryBooks(user.id) });
  });

  app.post('/api/account/library/claim-free/:bookId', async (c) => {
    const user = requireAuth(c);
    try {
      const entitlement = await repo.claimFreeBook(user.id, c.req.param('bookId'));
      return c.json({ entitlement }, 201);
    } catch {
      return c.json({ error: 'Book is not available as a free edition' }, 400);
    }
  });

  app.get('/api/account/history', async (c) => {
    const user = requireAuth(c);
    return c.json({ items: await repo.listReadingHistory(user.id) });
  });

  app.get('/api/account/wishlist', async (c) => {
    const user = requireAuth(c);
    return c.json({ items: await repo.getWishlist(user.id) });
  });

  app.post('/api/account/wishlist/:bookId', async (c) => {
    const user = requireAuth(c);
    const book = await repo.getBookBySlugOrId(c.req.param('bookId'), false);
    if (!book) return c.json({ error: 'Book not found' }, 404);
    await repo.addToWishlist(user.id, book.id);
    return c.json({ items: await repo.getWishlist(user.id) }, 201);
  });

  app.delete('/api/account/wishlist/:bookId', async (c) => {
    const user = requireAuth(c);
    await repo.removeFromWishlist(user.id, c.req.param('bookId'));
    return c.json({ items: await repo.getWishlist(user.id) });
  });

  app.get('/api/account/notifications', async (c) => {
    const user = requireAuth(c);
    return c.json({ items: await repo.listNotifications(user.id) });
  });

  app.post('/api/account/notifications/:id/read', async (c) => {
    const user = requireAuth(c);
    await repo.markNotificationRead(user.id, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/account/orders', async (c) => {
    const user = requireAuth(c);
    return c.json({ orders: await repo.listOrdersForUser(user.id) });
  });

  // ---- CART & CHECKOUT ----
  app.get('/api/cart', async (c) => {
    const user = requireAuth(c);
    const items = await repo.getCartItems(user.id);
    const subtotalCents = items.reduce((s, i) => s + i.book.priceCents, 0);
    const effectiveSubtotalCents = items.reduce((s, i) => s + (i.book.effectivePriceCents ?? i.book.priceCents), 0);
    return c.json({ items, subtotalCents, effectiveSubtotalCents });
  });

  app.post('/api/cart/:bookId', async (c) => {
    const user = requireAuth(c);
    try {
      await repo.addToCart(user.id, c.req.param('bookId'));
      const items = await repo.getCartItems(user.id);
      const subtotalCents = items.reduce((s, i) => s + i.book.priceCents, 0);
      const effectiveSubtotalCents = items.reduce((s, i) => s + (i.book.effectivePriceCents ?? i.book.priceCents), 0);
      return c.json({ items, subtotalCents, effectiveSubtotalCents }, 201);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'BOOK_NOT_FOUND') {
        return c.json({ error: 'Book not found' }, 404);
      }
      if (code === 'FREE_BOOK_NO_CART') {
        return c.json({ error: 'This edition is free and can be read directly without adding to your cart.' }, 400);
      }
      if (code === 'ALREADY_OWNED') {
        return c.json({ error: 'This book is already in your library.' }, 400);
      }
      return c.json({ error: 'Unable to add book to cart' }, 400);
    }
  });

  app.delete('/api/cart/:bookId', async (c) => {
    const user = requireAuth(c);
    await repo.removeFromCart(user.id, c.req.param('bookId'));
    const items = await repo.getCartItems(user.id);
    const subtotalCents = items.reduce((s, i) => s + i.book.priceCents, 0);
    const effectiveSubtotalCents = items.reduce((s, i) => s + (i.book.effectivePriceCents ?? i.book.priceCents), 0);
    return c.json({ items, subtotalCents, effectiveSubtotalCents });
  });

  app.get('/api/payment-methods', async (c) => {
    const configs = (await repo.listPaymentProviders()).filter(
      (p) => p.isEnabled
    );
    const resolvedPremier = await repo.getResolvedGatewayConfig('premier_bank_gateway', gatewayEnvFallback);
    const enriched = await Promise.all(
      configs.map(async (cfg) => {
        const adapter = resolvePaymentAdapter(cfg);
        return {
          ...cfg,
          publicConfig:
            cfg.code === 'premier_bank_gateway'
              ? { ...cfg.publicConfig, gatewayMode: resolvedPremier.gatewayMode }
              : cfg.publicConfig,
          isConnected: adapter ? await adapter.isConnected() : false,
        };
      })
    );
    return c.json({ methods: enriched });
  });

  app.get('/api/payment-methods/:code', async (c) => {
    const method = (await repo.listPaymentProviders()).find((p) => p.code === c.req.param('code'));
    if (!method) return c.json({ error: 'Payment method not found' }, 404);
    return c.json({
      method: {
        code: method.code,
        displayName: method.displayName,
        providerType: method.providerType,
        isEnabled: method.isEnabled,
        instructionsEn: method.instructionsEn,
        instructionsSo: method.instructionsSo,
        instructionsAr: method.instructionsAr,
        publicConfig: method.publicConfig,
      },
    });
  });

  app.post('/api/checkout/validate-discount', async (c) => {
    const user = requireAuth(c);
    const limited = await enforceRateLimit(c, `promo:${user.id}`, 40, 60);
    if (limited) return limited;

    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const discountPercent = await repo.getDiscountRatePercent(rawCode);
    return c.json({
      valid: discountPercent > 0,
      code: discountPercent > 0 ? rawCode : '',
      discountPercent,
    });
  });

  app.post('/api/checkout', async (c) => {
    const user = requireAuth(c);
    const limited = await enforceRateLimit(c, `checkout:${user.id}`, 40, 60);
    if (limited) return limited;

    if (config.requireEmailVerification && !user.emailVerified) {
      return c.json(
        {
          error: 'Please verify your email address before completing checkout.',
          code: 'EMAIL_VERIFICATION_REQUIRED',
        },
        403
      );
    }

    const parsed = checkoutCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload' }, 400);
    }

    const providerConfigs = await repo.listPaymentProviders();
    const selectedConfig = providerConfigs.find((p) => p.code === parsed.data.paymentMethodCode && p.isEnabled);
    const adapter = selectedConfig ? resolvePaymentAdapter(selectedConfig) : undefined;

    if (!selectedConfig || !adapter) {
      return c.json({ error: 'Selected payment method is not enabled' }, 400);
    }
    if (!(await adapter.isConnected())) {
      return c.json(
        {
          error: `Payment method "${selectedConfig.displayName}" is not currently active. Please choose another method or try again later.`,
        },
        503
      );
    }

    try {
      const { order, payment } = await repo.createAuthoritativeOrder({
        userId: user.id,
        bookIds: parsed.data.bookIds,
        paymentMethodCode: parsed.data.paymentMethodCode,
        discountCode: parsed.data.discountCode,
        billingEmail: parsed.data.billingEmail,
        billingPhone: parsed.data.billingPhone,
        notes: parsed.data.notes,
      });

      const initResult = await adapter.initiatePayment({
        orderId: order.id,
        orderReference: order.orderReference,
        transactionReference: payment.transactionReference,
        amountCents: order.totalCents,
        currency: order.currency,
        customerEmail: parsed.data.billingEmail || user.email,
        returnUrl: `${config.appUrl}/checkout/result`,
      });

      await repo.updatePaymentInitiation(
        payment.id,
        initResult.providerPaymentId,
        initResult.status,
        initResult.gatewayMetadata
      );
      const updatedOrder = (await repo.getOrderById(order.id))!;

      return c.json(
        {
          order: updatedOrder,
          initiation: initResult,
        },
        201
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Checkout failed' }, 400);
    }
  });

  app.get('/api/orders/:orderId', async (c) => {
    const user = requireAuth(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || (order.userId !== user.id && !(await repo.isAdmin(user.id)))) {
      return c.json({ error: 'Order not found' }, 404);
    }
    const paymentMethod = order.payment
      ? (await repo.listPaymentProviders()).find((provider) => provider.code === order.payment?.providerCode) || null
      : null;
    return c.json({ order, paymentMethod });
  });

  app.get('/api/orders/:orderId/receipt', async (c) => {
    const user = requireAuth(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || (order.userId !== user.id && !(await repo.isAdmin(user.id)))) {
      return c.json({ error: 'Order not found' }, 404);
    }
    const pdfBytes = await generateOrderReceiptPdf({ order });
    const safeRef = order.orderReference.replace(/[^A-Za-z0-9_-]/g, '');
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="receipt-${safeRef || order.id}.pdf"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.post('/api/orders/:orderId/verify-return', async (c) => {
    const user = requireAuth(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || (order.userId !== user.id && !(await repo.isAdmin(user.id)))) {
      return c.json({ error: 'Order not found' }, 404);
    }
    if (order.status === 'paid') {
      return c.json({ verified: true, order });
    }
    if (!order.payment) {
      return c.json({ error: 'Payment details not found for this order.' }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as { resultIndicator?: string };
    const adapter = paymentAdapters.get(order.payment.providerCode);
    if (!adapter || !adapter.verifyHostedReturn) {
      return c.json({ verified: false, order });
    }

    const metadata = await repo.getPaymentGatewayMetadata(order.payment.id);
    const result = await adapter.verifyHostedReturn({
      orderReference: order.orderReference,
      transactionReference: order.payment.transactionReference,
      amountCents: order.totalCents,
      currency: order.currency,
      resultIndicator: typeof body.resultIndicator === 'string' ? body.resultIndicator : undefined,
      metadata,
    });

    if (!result.verified) {
      return c.json({ verified: false, reason: result.reason || 'Awaiting payment confirmation', order });
    }

    const verified = await repo.processVerifiedPaymentAtomic({
      paymentId: order.payment.id,
      providerPaymentId: result.providerPaymentId,
    });
    return c.json({ verified: true, order: verified.order });
  });

  app.post('/api/orders/:orderId/manual-reference', async (c) => {
    const user = requireAuth(c);
    const targetOrder = await repo.getOrderById(c.req.param('orderId'));
    const paymentProvider = targetOrder?.payment
      ? (await repo.listPaymentProviders()).find((provider) => provider.code === targetOrder.payment?.providerCode)
      : null;
    if (!targetOrder || targetOrder.userId !== user.id) return c.json({ error: 'Order not found' }, 404);
    if (paymentProvider?.providerType !== 'manual') {
      return c.json({ error: 'Payment references are only accepted for manual payment methods.' }, 400);
    }
    const parsed = manualReferenceSubmitSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid reference' }, 400);
    }
    try {
      const order = await repo.submitManualPaymentReference(user.id, c.req.param('orderId'), parsed.data.customerReference);
      return c.json({ order });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'ORDER_NOT_FOUND') {
        return c.json({ error: 'Order not found' }, 404);
      }
      if (code === 'INVALID_ORDER_STATE') {
        return c.json({ error: 'This order can no longer be updated.' }, 400);
      }
      return c.json({ error: 'Unable to submit payment reference' }, 400);
    }
  });

  // ---- TRUSTED PAYMENT WEBHOOKS (Signature Verified & Idempotent) ----
  app.post('/api/webhooks/payments/:providerCode', async (c) => {
    const limited = await enforceRateLimit(c, `wh:${getClientIp(c)}`, 120, 60);
    if (limited) return limited;

    const providerCode = c.req.param('providerCode');
    const adapter = paymentAdapters.get(providerCode);
    if (!adapter || adapter.providerType === 'manual') {
      return c.json({ error: 'Unsupported webhook provider' }, 404);
    }
    if (!(await adapter.isConnected())) {
      return c.json({ error: 'Provider webhook secret is not configured' }, 503);
    }

    const rawBody = await c.req.text();
    const headers: Record<string, string | undefined> = {
      'x-premier-signature': c.req.header('x-premier-signature'),
      'x-webhook-signature': c.req.header('x-webhook-signature'),
      'x-notification-secret': c.req.header('x-notification-secret'),
    };

    const sigValid = await adapter.verifyWebhookSignature(rawBody, headers);
    if (!sigValid) {
      return c.json({ error: 'Invalid webhook signature' }, 401);
    }

    let evt;
    try {
      evt = adapter.parseWebhookEvent(rawBody);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Malformed webhook event' }, 400);
    }

    const payment = await repo.findPaymentByTransactionReference(evt.transactionReference);
    if (!payment) {
      return c.json({ error: 'Referenced payment record not found' }, 404);
    }

    if (evt.amountCents !== undefined && evt.amountCents !== payment.amountCents) {
      return c.json({ error: 'Webhook payment amount mismatch' }, 400);
    }
    if (evt.currency && evt.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      return c.json({ error: 'Webhook payment currency mismatch' }, 400);
    }

    const isNewEvent = await repo.recordWebhookEventIfNew({
      providerCode,
      externalEventId: evt.externalEventId,
      eventType: evt.eventType,
      signatureVerified: true,
      paymentId: payment.id,
      payload: rawBody,
    });

    if (!isNewEvent) {
      return c.json({ ok: true, status: 'duplicate_ignored' });
    }

    if (evt.targetStatus === 'verified') {
      const result = await repo.processVerifiedPaymentAtomic({
        paymentId: payment.id,
        providerPaymentId: evt.providerPaymentId,
      });
      return c.json({ ok: true, status: result.alreadyVerified ? 'already_verified' : 'verified', order: result.order });
    }

    const updatedOrder = await repo.markPaymentFailedOrCancelled({
      paymentId: payment.id,
      targetStatus: evt.targetStatus,
      reason: evt.failureReason,
    });
    return c.json({ ok: true, status: evt.targetStatus, order: updatedOrder });
  });

  // ---- ADMIN API ROUTES (Strictly Protected Server-Side) ----
  app.get('/api/admin/overview', async (c) => {
    requireAdmin(c);
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const [metrics, allOrders, allLogs, reports] = await Promise.all([
      repo.getAdminMetrics(startDate, endDate),
      repo.listAllOrders(),
      repo.listAdminLogs(),
      repo.getSalesReport(startDate, endDate),
    ]);
    return c.json({
      metrics,
      recentOrders: allOrders.slice(0, 8),
      recentLogs: allLogs.slice(0, 10),
      reports,
    });
  });

  app.get('/api/admin/books', async (c) => {
    requireAdmin(c);
    const q = c.req.query('q') || '';
    const { page, pageSize } = parsePaginationQuery({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      defaultPageSize: 50,
      maxPageSize: 100,
    });
    return c.json(await repo.listBooks({ search: q, includeNonPublished: true, page, pageSize }));
  });

  app.post('/api/admin/books', async (c) => {
    const admin = requireAdmin(c);
    const parsed = bookMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid book data' }, 400);

    try {
      const book = await repo.upsertBook(null, admin.id, parsed.data);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'create_book',
        entityType: 'books',
        entityId: book.id,
        details: { title: book.title, status: book.status },
      });
      return c.json({ book }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to create book' }, 400);
    }
  });

  app.put('/api/admin/books/:id', async (c) => {
    const admin = requireAdmin(c);
    const parsed = bookMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid book data' }, 400);

    const book = await repo.upsertBook(c.req.param('id'), admin.id, parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_book',
      entityType: 'books',
      entityId: book.id,
      details: { title: book.title, status: book.status, priceCents: book.priceCents },
    });
    return c.json({ book });
  });

  app.patch('/api/admin/books/:id/quick', async (c) => {
    const admin = requireAdmin(c);
    const parsed = adminBookQuickUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid quick update payload' }, 400);
    }
    try {
      const book = await repo.quickUpdateBook(c.req.param('id'), parsed.data);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'quick_update_book',
        entityType: 'books',
        entityId: book.id,
        details: { isFree: book.isFree, priceCents: book.priceCents, status: book.status },
      });
      return c.json({ book });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Book not found' }, 404);
    }
  });

  app.delete('/api/admin/books/:id', async (c) => {
    const admin = requireAdmin(c);
    const id = c.req.param('id');
    await repo.archiveBook(id);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'archive_book',
      entityType: 'books',
      entityId: id,
    });
    return c.json({ ok: true });
  });

  // Admin File Uploads with strict magic-byte validation
  app.post('/api/admin/books/:id/upload-pdf', async (c) => {
    const admin = requireAdmin(c);
    const bookId = c.req.param('id');
    const book = await repo.getBookBySlugOrId(bookId, true);
    if (!book) return c.json({ error: 'Book not found' }, 404);

    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'PDF file is required' }, 400);
    }
    const fileName = typeof (file as File).name === 'string' && (file as File).name ? (file as File).name : `${book.slug}.pdf`;
    if (file.size === 0 || file.size > 50 * 1024 * 1024) {
      return c.json({ error: 'PDF must be between 1 byte and 50 MB' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validatePdfMagicBytes(bytes)) {
      return c.json({ error: 'Invalid file signature. Only authentic PDF files are permitted.' }, 400);
    }

    const safeName = `${book.slug}-${Date.now()}.pdf`;
    const storagePath = await storage.uploadPrivatePdf(safeName, bytes);

    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    await repo.attachBookPdfFile({
      bookId: book.id,
      storagePath,
      originalFilename: fileName,
      fileSizeBytes: bytes.byteLength,
      checksum,
    });

    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'upload_book_pdf',
      entityType: 'book_files',
      entityId: book.id,
      details: { filename: fileName, sizeBytes: bytes.byteLength },
    });

    return c.json({ ok: true, filename: fileName, sizeBytes: bytes.byteLength });
  });

  app.post('/api/admin/upload-cover', async (c) => {
    const admin = requireAdmin(c);
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'Cover image file is required' }, 400);
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'Image must be under 10 MB' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = validateImageMagicBytes(bytes);
    if (!detectedMime) {
      return c.json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.' }, 400);
    }

    const ext = detectedMime === 'image/png' ? '.png' : detectedMime === 'image/webp' ? '.webp' : '.jpg';
    const filename = `cover-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const coverUrl = await storage.uploadPublicCover(filename, bytes, detectedMime);

    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'upload_cover',
      entityType: 'storage',
      entityId: filename,
    });

    return c.json({ coverUrl }, 201);
  });

  // Categories Admin
  app.get('/api/admin/categories', async (c) => {
    requireAdmin(c);
    return c.json({ categories: await repo.listCategories(true) });
  });

  app.post('/api/admin/categories', async (c) => {
    const admin = requireAdmin(c);
    const parsed = categoryMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid category' }, 400);
    const category = await repo.upsertCategory(null, parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'create_category',
      entityType: 'categories',
      entityId: category.id,
    });
    return c.json({ category }, 201);
  });

  app.put('/api/admin/categories/:id', async (c) => {
    const admin = requireAdmin(c);
    const parsed = categoryMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid category' }, 400);
    const category = await repo.upsertCategory(c.req.param('id'), parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_category',
      entityType: 'categories',
      entityId: category.id,
    });
    return c.json({ category });
  });

  app.delete('/api/admin/categories/:id', async (c) => {
    const admin = requireAdmin(c);
    try {
      const id = c.req.param('id');
      await repo.deleteCategory(id);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'delete_category',
        entityType: 'categories',
        entityId: id,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'CATEGORY_HAS_BOOKS') {
        return c.json({ error: 'Cannot delete a category that still contains books' }, 409);
      }
      throw err;
    }
  });

  // Orders & Payment Verification Admin
  app.get('/api/admin/orders', async (c) => {
    requireAdmin(c);
    const { page, pageSize } = parsePaginationQuery({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      defaultPageSize: 25,
      maxPageSize: 100,
    });
    const result = await repo.listOrdersPaginated({
      statusFilter: c.req.query('status'),
      search: c.req.query('q'),
      page,
      pageSize,
    });
    return c.json({
      orders: result.items,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  });

  app.get('/api/admin/orders/export', async (c) => {
    requireAdmin(c);
    const orders = await repo.listAllOrdersForExport({
      statusFilter: c.req.query('status'),
      search: c.req.query('q'),
    });
    const header = [
      'Order Reference',
      'Status',
      'Customer Name',
      'Customer Email',
      'Billing Email',
      'Billing Phone',
      'Payment Method',
      'Transaction Reference',
      'Subtotal USD',
      'Discount USD',
      'Total USD',
      'Currency',
      'Created At',
    ];
    const rows = orders.map((o) => [
      o.orderReference,
      o.status,
      o.customerName || '',
      o.customerEmail || '',
      o.billingEmail || '',
      o.billingPhone || '',
      o.paymentMethodCode === 'premier_bank_gateway' ? 'Mastercard / Visa' : o.paymentMethodCode,
      o.payment?.transactionReference || '',
      (o.subtotalCents / 100).toFixed(2),
      (o.discountCents / 100).toFixed(2),
      (o.totalCents / 100).toFixed(2),
      o.currency,
      o.createdAt,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="orders-export.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.post('/api/admin/orders/:orderId/verify-payment', async (c) => {
    const admin = requireAdmin(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || !order.payment) return c.json({ error: 'Order or payment not found' }, 404);

    try {
      const result = await repo.processVerifiedPaymentAtomic({
        paymentId: order.payment.id,
        verifiedByAdminId: admin.id,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'verify_payment_manual',
        entityType: 'orders',
        entityId: order.id,
        details: { orderReference: order.orderReference, totalCents: order.totalCents },
      });
      return c.json({ order: result.order });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Verification failed' }, 400);
    }
  });

  app.post('/api/admin/orders/:orderId/reject-payment', async (c) => {
    const admin = requireAdmin(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || !order.payment) return c.json({ error: 'Order or payment not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };

    try {
      const updated = await repo.markPaymentFailedOrCancelled({
        paymentId: order.payment.id,
        targetStatus: 'failed',
        reason: body.reason || 'Payment reference could not be verified by administrator.',
        actorAdminId: admin.id,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'reject_payment_manual',
        entityType: 'orders',
        entityId: order.id,
        details: { reason: body.reason },
      });
      return c.json({ order: updated });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Action failed' }, 400);
    }
  });

  app.post('/api/admin/orders/:orderId/refund', async (c) => {
    const admin = requireAdmin(c);
    const order = await repo.getOrderById(c.req.param('orderId'));
    if (!order || !order.payment) return c.json({ error: 'Order not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };

    try {
      const updated = await repo.markPaymentFailedOrCancelled({
        paymentId: order.payment.id,
        targetStatus: 'refunded',
        reason: body.reason || 'Refunded by administrator',
        actorAdminId: admin.id,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'refund_order',
        entityType: 'orders',
        entityId: order.id,
      });
      return c.json({ order: updated });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Refund failed' }, 400);
    }
  });

  // Payment Providers & Homepage Sections Admin
  app.get('/api/admin/payment-providers', async (c) => {
    requireAdmin(c);
    const list = await repo.listPaymentProviders();
    const providers = await Promise.all(
      list.map(async (cfg) => {
        const adapter = resolvePaymentAdapter(cfg);
        return {
          ...cfg,
          isConnected: adapter ? await adapter.isConnected() : false,
          missingRequirements: adapter ? await adapter.missingRequirements() : [],
          credentials:
            cfg.providerType === 'online_gateway'
              ? await repo.getGatewayCredentialsAdminView(cfg.code, gatewayEnvFallback)
              : undefined,
        };
      })
    );
    return c.json({ providers });
  });

  app.post('/api/admin/payment-providers', async (c) => {
    const admin = requireAdmin(c);
    const parsed = manualPaymentProviderCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid manual payment method' }, 400);
    }
    const slug = parsed.data.displayName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 52);
    if (!slug) return c.json({ error: 'Payment method name must contain letters or numbers.' }, 400);
    const code = `manual_${slug}`;
    try {
      const provider = await repo.createManualPaymentProvider({ code, ...parsed.data });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'create_manual_payment_method',
        entityType: 'payment_provider_configs',
        entityId: provider.code,
        details: { displayName: provider.displayName },
      });
      return c.json({ provider }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create payment method';
      const duplicate = message.includes('UNIQUE') || message.includes('duplicate key');
      return c.json({ error: duplicate ? 'A payment method with this name already exists.' : message }, duplicate ? 409 : 500);
    }
  });

  app.put('/api/admin/payment-providers/:code', async (c) => {
    const admin = requireAdmin(c);
    const code = c.req.param('code');
    const exists = (await repo.listPaymentProviders()).some((provider) => provider.code === code);
    if (!exists) return c.json({ error: 'Payment method not found' }, 404);
    const parsed = paymentProviderUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid payment method settings' }, 400);
    }
    const currentProvider = (await repo.listPaymentProviders()).find((provider) => provider.code === code)!;
    if (
      currentProvider.providerType === 'manual' &&
      parsed.data.isEnabled &&
      !parsed.data.instructionsEn &&
      !parsed.data.instructionsSo &&
      !parsed.data.instructionsAr
    ) {
      return c.json({ error: 'Add payment instructions before enabling this manual method.' }, 400);
    }
    const updated = await repo.updatePaymentProviderConfig(code, parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_payment_provider',
      entityType: 'payment_provider_configs',
      entityId: updated.code,
      details: { isEnabled: updated.isEnabled },
    });
    return c.json({ provider: updated });
  });

  app.put('/api/admin/payment-providers/:code/credentials', async (c) => {
    const admin = requireAdmin(c);
    const code = c.req.param('code');
    const provider = (await repo.listPaymentProviders()).find((p) => p.code === code);
    if (!provider || provider.providerType !== 'online_gateway') {
      return c.json({ error: 'Online payment gateway provider not found' }, 404);
    }

    const parsed = paymentGatewayCredentialsUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid gateway credentials payload' }, 400);
    }

    let safeUrl = '';
    try {
      safeUrl = validateGatewayUrl(parsed.data.gatewayUrl, config.nodeEnv);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid gateway URL' }, 400);
    }

    const credentials = await repo.saveGatewayCredentials(
      code,
      {
        gatewayMode: parsed.data.gatewayMode,
        gatewayUrl: safeUrl,
        merchantId: parsed.data.merchantId,
        apiVersion: parsed.data.apiVersion,
        apiKey: parsed.data.apiKey,
        webhookSecret: parsed.data.webhookSecret,
        clearSecrets: parsed.data.clearSecrets,
      },
      gatewayEnvFallback,
      admin.id
    );

    const adapter = paymentAdapters.get(code);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_payment_gateway_credentials',
      entityType: 'payment_provider_configs',
      entityId: code,
      details: {
        gatewayMode: credentials.gatewayMode,
        hasMerchantId: Boolean(credentials.merchantId),
        hasApiKey: credentials.hasApiKey,
        hasWebhookSecret: credentials.hasWebhookSecret,
        cleared: parsed.data.clearSecrets,
      },
    });

    return c.json({
      credentials,
      isConnected: adapter ? await adapter.isConnected() : false,
      missingRequirements: adapter ? await adapter.missingRequirements() : [],
    });
  });

  app.post('/api/admin/payment-providers/:code/test', async (c) => {
    requireAdmin(c);
    const code = c.req.param('code');
    const adapter = paymentAdapters.get(code);
    if (!adapter || !adapter.testConnection) {
      return c.json({ error: 'Gateway connection test not supported for this provider' }, 404);
    }
    const result = await adapter.testConnection();
    return c.json(result);
  });

  app.get('/api/admin/homepage-sections', async (c) => {
    requireAdmin(c);
    return c.json({ sections: await repo.listHomepageSections(true) });
  });

  app.put('/api/admin/homepage-sections/:id', async (c) => {
    const admin = requireAdmin(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      isEnabled: boolean;
      sortOrder: number;
      titleEn: string;
      titleSo: string;
      titleAr: string;
    };
    const id = c.req.param('id');
    await repo.updateHomepageSection(id, body);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_homepage_section',
      entityType: 'homepage_sections',
      entityId: id,
    });
    return c.json({ sections: await repo.listHomepageSections(true) });
  });

  // Contact Channels & Discount Codes Admin
  app.get('/api/admin/contacts', async (c) => {
    requireAdmin(c);
    return c.json({ channels: await repo.listContactChannels(true) });
  });

  app.put('/api/admin/contacts', async (c) => {
    const admin = requireAdmin(c);
    const parsed = contactChannelsUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid contact channel payload' }, 400);
    }
    const normalizedInput = parsed.data.channels.map((ch, idx) => ({
      id: ch.id,
      type: ch.type,
      label: ch.label,
      value: ch.value,
      url: ch.url ?? '',
      isPrimary: Boolean(ch.isPrimary),
      isEnabled: ch.isEnabled !== false,
      sortOrder: Number.isFinite(ch.sortOrder) ? ch.sortOrder : idx + 1,
    }));
    const saved = await repo.saveContactChannels(normalizedInput, admin.id);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_contact_channels',
      entityType: 'site_settings',
      entityId: 'contact_channels',
      details: { count: saved.length },
    });
    return c.json({ channels: saved });
  });

  app.get('/api/admin/discount-codes', async (c) => {
    requireAdmin(c);
    return c.json({ codes: await repo.listDiscountCodes() });
  });

  app.put('/api/admin/discount-codes', async (c) => {
    const admin = requireAdmin(c);
    const parsed = discountCodesUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid discount codes payload' }, 400);
    }
    const saved = await repo.saveDiscountCodes(parsed.data.codes, admin.id);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_discount_codes',
      entityType: 'site_settings',
      entityId: 'discount_codes',
      details: { count: saved.length },
    });
    return c.json({ codes: saved });
  });

  app.get('/api/admin/promotions', async (c) => {
    requireAdmin(c);
    return c.json({ promotions: await repo.listPromotions(false) });
  });

  app.post('/api/admin/promotions', async (c) => {
    const admin = requireAdmin(c);
    const parsed = promotionMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid promotion payload' }, 400);
    }
    const promotion = await repo.upsertPromotion(null, parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'create_promotion',
      entityType: 'promotions',
      entityId: promotion.id,
      details: { name: promotion.name, scope: promotion.scope },
    });
    return c.json({ promotion }, 201);
  });

  app.put('/api/admin/promotions/:id', async (c) => {
    const admin = requireAdmin(c);
    const parsed = promotionMutationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid promotion payload' }, 400);
    }
    const promotion = await repo.upsertPromotion(c.req.param('id'), parsed.data);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'update_promotion',
      entityType: 'promotions',
      entityId: promotion.id,
      details: { name: promotion.name, isActive: promotion.isActive },
    });
    return c.json({ promotion });
  });

  app.delete('/api/admin/promotions/:id', async (c) => {
    const admin = requireAdmin(c);
    const id = c.req.param('id');
    await repo.deletePromotion(id);
    await repo.logAdminAction({
      actorUserId: admin.id,
      action: 'delete_promotion',
      entityType: 'promotions',
      entityId: id,
    });
    return c.json({ ok: true });
  });

  app.get('/api/admin/customers', async (c) => {
    requireAdmin(c);
    const rawStatus = c.req.query('status');
    const statusFilter: 'all' | AccountStatus =
      rawStatus === 'active' || rawStatus === 'paused' || rawStatus === 'suspended' ? rawStatus : 'all';
    const { page, pageSize } = parsePaginationQuery({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      defaultPageSize: 25,
      maxPageSize: 100,
    });
    const result = await repo.listCustomersPaginated({
      search: c.req.query('q'),
      statusFilter,
      page,
      pageSize,
    });
    return c.json({
      customers: result.items,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  });

  app.get('/api/admin/customers/export', async (c) => {
    requireAdmin(c);
    const rawStatus = c.req.query('status');
    const statusFilter: 'all' | AccountStatus =
      rawStatus === 'active' || rawStatus === 'paused' || rawStatus === 'suspended' ? rawStatus : 'all';
    const customers = await repo.listAllCustomersForExport({
      search: c.req.query('q'),
      statusFilter,
    });
    const header = [
      'Customer ID',
      'Full Name',
      'Email',
      'Email Verified',
      'Status',
      'Roles',
      'Language',
      'Owned Books',
      'Orders Count',
      'Total Spent USD',
      'Created At',
    ];
    const rows = customers.map((cust) => [
      cust.id,
      cust.fullName,
      cust.email,
      cust.emailVerified ? 'Yes' : 'No',
      cust.accountStatus,
      cust.roles.join(' | '),
      cust.preferredLanguage,
      cust.activeBooksCount,
      cust.orderCount,
      (cust.totalSpentCents / 100).toFixed(2),
      cust.createdAt,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="customers-export.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.post('/api/admin/customers', async (c) => {
    const admin = requireAdmin(c);
    const parsed = adminCreateUserSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user payload' }, 400);
    }
    if (parsed.data.isAdmin && !admin.roles.includes('super_admin')) {
      return c.json({ error: 'Only a Super Admin can create administrator accounts' }, 403);
    }
    try {
      const customer = await repo.adminCreateUser({
        email: parsed.data.email,
        passwordHash: hashPassword(parsed.data.password),
        fullName: parsed.data.fullName,
        preferredLanguage: parsed.data.preferredLanguage,
        accountStatus: parsed.data.accountStatus,
        isAdmin: parsed.data.isAdmin,
        grantAll: parsed.data.grantAll,
        bookIds: parsed.data.bookIds,
        grantedByUserId: admin.id,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'create_customer',
        entityType: 'profiles',
        entityId: customer.id,
        details: {
          email: customer.email,
          accountStatus: customer.accountStatus,
          isAdmin: parsed.data.isAdmin,
          grantAll: parsed.data.grantAll,
          grantedBookCount: parsed.data.bookIds.length,
        },
      });
      return c.json({ customer }, 201);
    } catch (err) {
      if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
        return c.json({ error: 'An account with this email already exists' }, 409);
      }
      throw err;
    }
  });

  app.get('/api/admin/customers/:id', async (c) => {
    requireAdmin(c);
    const details = await repo.getAdminCustomerDetails(c.req.param('id'));
    if (!details) {
      return c.json({ error: 'Customer not found' }, 404);
    }
    return c.json(details);
  });

  app.patch('/api/admin/customers/:id', async (c) => {
    const admin = requireAdmin(c);
    const targetId = c.req.param('id');
    const parsed = adminUpdateCustomerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid customer update payload' }, 400);
    }
    if (targetId === admin.id && parsed.data.accountStatus !== 'active') {
      return c.json({ error: 'You cannot pause or suspend your own active admin account' }, 400);
    }
    const target = await repo.getUserProfileById(targetId);
    if (!target) {
      return c.json({ error: 'Customer not found' }, 404);
    }
    if (target.roles.includes('super_admin') && !admin.roles.includes('super_admin')) {
      return c.json({ error: 'Only a Super Admin can modify another Super Admin account' }, 403);
    }
    if (
      target.roles.includes('super_admin') &&
      target.accountStatus === 'active' &&
      parsed.data.accountStatus !== 'active' &&
      (await repo.countActiveSuperAdmins()) <= 1
    ) {
      return c.json({ error: 'Cannot pause or suspend the last active Super Admin account' }, 400);
    }
    try {
      const customer = await repo.adminUpdateCustomer(targetId, {
        fullName: parsed.data.fullName,
        preferredLanguage: parsed.data.preferredLanguage,
        accountStatus: parsed.data.accountStatus,
        newPasswordHash: parsed.data.newPassword ? hashPassword(parsed.data.newPassword) : undefined,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'update_customer',
        entityType: 'profiles',
        entityId: targetId,
        details: {
          accountStatus: customer.accountStatus,
          preferredLanguage: customer.preferredLanguage,
          passwordReset: Boolean(parsed.data.newPassword),
        },
      });
      return c.json({ customer });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to update customer' }, 404);
    }
  });

  app.post('/api/admin/customers/:id/books/grant', async (c) => {
    const admin = requireAdmin(c);
    const targetId = c.req.param('id');
    const parsed = adminGrantBooksSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid book grant payload' }, 400);
    }
    try {
      const entitlements = await repo.adminGrantBooksToUser({
        targetUserId: targetId,
        grantAll: parsed.data.grantAll,
        bookIds: parsed.data.bookIds,
        grantedByUserId: admin.id,
        reason: parsed.data.reason,
      });
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'grant_user_books',
        entityType: 'entitlements',
        entityId: targetId,
        details: { grantAll: parsed.data.grantAll, bookIds: parsed.data.bookIds },
      });
      return c.json({ entitlements });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to grant books' }, 404);
    }
  });

  app.delete('/api/admin/customers/:id/books/:bookId', async (c) => {
    const admin = requireAdmin(c);
    const targetId = c.req.param('id');
    const bookId = c.req.param('bookId');
    try {
      const entitlements = await repo.adminRevokeBookFromUser(targetId, bookId);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'revoke_user_book',
        entityType: 'entitlements',
        entityId: targetId,
        details: { bookId },
      });
      return c.json({ entitlements });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to revoke book access' }, 404);
    }
  });

  app.post('/api/admin/customers/:id/books/revoke-all', async (c) => {
    const admin = requireAdmin(c);
    const targetId = c.req.param('id');
    try {
      const entitlements = await repo.adminRevokeAllGrantedBooksFromUser(targetId);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'revoke_all_user_books',
        entityType: 'entitlements',
        entityId: targetId,
      });
      return c.json({ entitlements });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to revoke book access' }, 404);
    }
  });

  app.patch('/api/admin/customers/:id/status', async (c) => {
    const admin = requireAdmin(c);
    const targetId = c.req.param('id');
    const parsed = customerStatusUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid account status' }, 400);
    }
    if (targetId === admin.id && parsed.data.accountStatus !== 'active') {
      return c.json({ error: 'You cannot pause or suspend your own active admin account' }, 400);
    }
    const target = await repo.getUserProfileById(targetId);
    if (!target) {
      return c.json({ error: 'Customer not found' }, 404);
    }
    if (target.roles.includes('super_admin') && !admin.roles.includes('super_admin')) {
      return c.json({ error: 'Only a Super Admin can modify another Super Admin account' }, 403);
    }
    if (
      target.roles.includes('super_admin') &&
      target.accountStatus === 'active' &&
      parsed.data.accountStatus !== 'active' &&
      (await repo.countActiveSuperAdmins()) <= 1
    ) {
      return c.json({ error: 'Cannot pause or suspend the last active Super Admin account' }, 400);
    }
    try {
      const customer = await repo.updateCustomerStatus(targetId, parsed.data.accountStatus);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'update_customer_status',
        entityType: 'profiles',
        entityId: targetId,
        details: { accountStatus: customer.accountStatus },
      });
      return c.json({ customer });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to update customer' }, 404);
    }
  });

  app.patch('/api/admin/customers/:id/role', async (c) => {
    const admin = requireAdmin(c);
    if (!admin.roles.includes('super_admin')) {
      return c.json({ error: 'Only a Super Admin can grant or revoke administrator roles' }, 403);
    }
    const targetId = c.req.param('id');
    if (targetId === admin.id) {
      return c.json({ error: 'You cannot revoke your own admin role' }, 400);
    }
    const parsed = customerRoleUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid role update' }, 400);
    }
    const target = await repo.getUserProfileById(targetId);
    if (!target) {
      return c.json({ error: 'Customer not found' }, 404);
    }
    if (
      !parsed.data.isAdmin &&
      target.roles.includes('super_admin') &&
      target.accountStatus === 'active' &&
      (await repo.countActiveSuperAdmins()) <= 1
    ) {
      return c.json({ error: 'Cannot revoke the last active Super Admin role' }, 400);
    }
    try {
      const customer = await repo.setUserAdminRole(targetId, parsed.data.isAdmin, admin.id);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: parsed.data.isAdmin ? 'grant_admin_role' : 'revoke_admin_role',
        entityType: 'user_roles',
        entityId: targetId,
        details: { isAdmin: parsed.data.isAdmin },
      });
      return c.json({ customer });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unable to update role' }, 404);
    }
  });

  app.get('/api/admin/reviews', async (c) => {
    requireAdmin(c);
    return c.json({ reviews: await repo.listAllReviews() });
  });

  app.patch('/api/admin/reviews/:id', async (c) => {
    const admin = requireAdmin(c);
    const reviewId = c.req.param('id');
    const parsed = reviewModerationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid review moderation payload' }, 400);
    }
    try {
      await repo.setReviewPublished(reviewId, parsed.data.isPublished);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: parsed.data.isPublished ? 'publish_review' : 'hide_review',
        entityType: 'reviews',
        entityId: reviewId,
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Review not found' }, 404);
    }
  });

  app.delete('/api/admin/reviews/:id', async (c) => {
    const admin = requireAdmin(c);
    const reviewId = c.req.param('id');
    try {
      await repo.deleteReview(reviewId);
      await repo.logAdminAction({
        actorUserId: admin.id,
        action: 'delete_review',
        entityType: 'reviews',
        entityId: reviewId,
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Review not found' }, 404);
    }
  });

  app.get('/api/admin/logs', async (c) => {
    requireAdmin(c);
    return c.json({ logs: await repo.listAdminLogs() });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: err.message, ...(err.code ? { code: err.code } : {}) },
        err.status as 400 | 401 | 403 | 404 | 409 | 500
      );
    }
    console.error('[API Error]', err);
    return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
  });

  return { app, runtime: { config, supabase, storage, repo, databaseMode } };
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
  }
}
