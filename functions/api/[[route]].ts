import { handle } from 'hono/cloudflare-pages';
import { createApp } from '../../src/server/app';
import { loadServerConfig } from '../../src/server/config';

const ENV_KEYS = [
  'APP_URL',
  'NODE_ENV',
  'SESSION_SECRET',
  'GATEWAY_ENCRYPTION_KEY',
  'TRUST_PROXY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_BOOTSTRAP_TOKEN',
  'PREMIER_BANK_GATEWAY_URL',
  'PREMIER_BANK_MERCHANT_ID',
  'PREMIER_BANK_API_KEY',
  'PREMIER_BANK_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'REQUIRE_EMAIL_VERIFICATION',
] as const;

let cachedHandler: ReturnType<typeof handle> | null = null;
let cachedSignature: string | null = null;

export const onRequest = async (context: Parameters<ReturnType<typeof handle>>[0]) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const envRecord: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    const val = env[key];
    if (typeof val === 'string') {
      envRecord[key] = val;
    }
  }
  const signature = ENV_KEYS.map((k) => `${k}=${envRecord[k] || ''}`).join('|');

  if (!cachedHandler || cachedSignature !== signature) {
    const config = loadServerConfig(envRecord);
    const { app } = await createApp({ config });
    cachedHandler = handle(app);
    cachedSignature = signature;
  }
  return cachedHandler(context);
};
