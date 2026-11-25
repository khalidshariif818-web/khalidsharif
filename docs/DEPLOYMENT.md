# Khalid Sharif Digital Library — Deployment & Operations Guide

## 1. Architecture Overview
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, PDF.js (`pdfjs-dist` legacy build for full Safari/iOS compatibility).
- **Authoritative Unified API**: Built with Hono (`src/server/app.ts`) using Web-standard Request/Response handlers.
  - **Node.js / Cloud Run**: `server.ts` mounts the Hono API alongside Vite middlewares (dev) or static `dist/` assets (prod) on port `3000`.
  - **Cloudflare Pages Functions**: `functions/api/[[route]].ts` delegates directly to the same `createApp()` Hono handler.
- **Database & Storage**: Supabase PostgreSQL + Storage only. Apply the normalized SQL schema and RLS policies from `supabase/migrations/0001_initial_schema.sql` through `0009_one_pending_order_per_book.sql`; configure the private `book-pdfs` bucket and public `book-covers` bucket. The server fails to start when Supabase credentials are missing and has no local database or file-storage fallback.

## 2. Environment Variables
Copy `.env.example` to `.env` and configure secrets strictly on the server (never commit `.env` or expose private keys in `VITE_*` variables):
- `APP_URL`: Canonical origin (e.g. `https://library.example.com`).
- `SESSION_SECRET`: Required strong 32+ byte random string used to sign HTTP-only session cookies and 5-minute PDF access tokens.
- `GATEWAY_ENCRYPTION_KEY`: Optional dedicated encryption key for payment gateway credentials in DB (falls back to `SESSION_SECRET`).
- `TRUST_PROXY`: Set to `"true"` only behind a trusted reverse proxy setting `X-Forwarded-For` (required for accurate persistent rate limiting).
- `REQUIRE_EMAIL_VERIFICATION`: Set to `"true"` to require verified email addresses before checkout (`POST /api/auth/resend-verification` & `GET /api/auth/verify-email`).
- `ADMIN_BOOTSTRAP_TOKEN`: Secret token for one-time authenticated admin bootstrap (`/admin` activation form or `POST /api/admin/bootstrap`).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Required for every server start. `SUPABASE_ANON_KEY` is needed only by any separately configured Supabase client.
- `PREMIER_BANK_GATEWAY_URL`, `PREMIER_BANK_MERCHANT_ID`, `PREMIER_BANK_API_KEY`, `PREMIER_BANK_WEBHOOK_SECRET`: Required to enable live Mastercard / Visa card payments via Premier Bank Online Payment Gateway.
- `RESEND_API_KEY`, `EMAIL_FROM`: Required for transactional email delivery (verification, password reset, purchase receipts).

## 3. Database & Storage Setup (Supabase Production)
1. Apply migrations in order from `supabase/migrations/0001_initial_schema.sql` through `supabase/migrations/0009_one_pending_order_per_book.sql`.
2. Verify Row Level Security (RLS) is active on all tables (`0002_rls_policies.sql`). Admin verification uses `public.is_admin()` reading `public.user_roles`, never `auth.role() = 'authenticated'`.
3. Verify `book-pdfs` bucket is **private** (`public = false`) and `book-covers` is **public** (`public = true`).

## 4. Admin Account Provisioning
No default hardcoded administrator credentials exist. Provision an administrator securely via server CLI:
```bash
npm run provision-admin -- --email admin@yourdomain.com --password "YourStrongPassword123!" --name "Library Director"
```
Or configure `ADMIN_BOOTSTRAP_TOKEN` in server secrets, sign in, visit `/admin`, and submit the bootstrap token to activate administrator privileges.

## 5. Payment Provider & Security Features
- **Mastercard / Visa Only (`premier_bank_gateway`)**: Checkout and Admin Payment Settings expose Mastercard / Visa card payments exclusively via Premier Bank Online Payment Gateway with HMAC `X-Premier-Signature` / `X-Webhook-Signature` webhook verification (`/api/webhooks/payments/premier_bank_gateway`). Marked **Not Connected** until `PREMIER_BANK_GATEWAY_URL`, `PREMIER_BANK_MERCHANT_ID`, `PREMIER_BANK_API_KEY`, and `PREMIER_BANK_WEBHOOK_SECRET` are configured on the server.
- **PDF Streaming & Receipts**: Authenticated HTTP Range (`206 Partial Content` / `416`) & `HEAD` streaming for authorized full books (`/api/books/:id/pdf`), plus downloadable PDF order receipts (`/api/orders/:orderId/receipt`).
- **Admin Operations & Security Hardening**: Server-side pagination and search (`/api/admin/books`, `/api/admin/orders`, `/api/admin/customers`), RFC 4180 CSV exports with formula-injection neutralization, persistent DB-backed sliding-window rate limiting (`429` + `Retry-After`), CSRF `Origin` verification, CSP/HSTS headers, and Supabase Auth session exchange (`/api/auth/supabase-session`).

## 6. Testing & Verification
Run unit, integration, and security authorization tests:
```bash
npm test
npm run lint
npm run build
```

## 7. Deployment & Rollback
- **Build**: `npm run build` produces the static frontend in `dist/`.
- **Start (Node/Cloud Run)**: `npm start` runs `server.ts` on port `3000`.
- **Cloudflare Pages**: `wrangler pages deploy dist` using `wrangler.toml` and `functions/api/[[route]].ts`.
- **Health Check**: `GET /api/health` returns JSON status (`ok: true`, database mode, email status).
- **Backup & Rollback**: Snapshot PostgreSQL (`pg_dump` or Supabase Point-in-Time Recovery) and Supabase Storage before running migrations; redeploy previous container/Pages revision if a release fails health checks.
