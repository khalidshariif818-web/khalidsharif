import crypto from 'node:crypto';

export interface ServerConfig {
  appUrl: string;
  nodeEnv: string;
  sessionSecret: string;
  gatewayEncryptionKey?: string;
  trustProxy?: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  adminBootstrapToken: string;
  premierBankGatewayUrl: string;
  premierBankMerchantId: string;
  premierBankApiKey: string;
  premierBankWebhookSecret: string;
  resendApiKey: string;
  emailFrom: string;
  requireEmailVerification?: boolean;
}

function resolveSessionSecret(nodeEnv: string, envSecretRaw?: string): string {
  const envSecret = envSecretRaw?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (nodeEnv === 'test') {
    return 'test-only-ephemeral-hmac-signing-key-32bytes';
  }
  if (nodeEnv === 'production') {
    throw new Error('SESSION_SECRET must be configured in production.');
  }
  return crypto.randomBytes(32).toString('hex');
}

export function loadServerConfig(envOverride?: Record<string, string | undefined>): ServerConfig {
  const readEnv = (key: string): string | undefined => {
    if (envOverride && typeof envOverride[key] === 'string') {
      return envOverride[key];
    }
    return typeof process !== 'undefined' ? process.env[key] : undefined;
  };

  const nodeEnv = readEnv('NODE_ENV') || 'development';
  const resendApiKey = readEnv('RESEND_API_KEY')?.trim() || '';
  const reqEmailRaw = readEnv('REQUIRE_EMAIL_VERIFICATION')?.trim().toLowerCase();
  // Production accounts must verify email before receiving a session.
  // Keep the override available for development environments only.
  const requireEmailVerification =
    nodeEnv === 'production'
      ? true
      : reqEmailRaw === 'true'
        ? true
        : reqEmailRaw === 'false'
          ? false
          : Boolean(resendApiKey);

  return {
    appUrl: readEnv('APP_URL') || 'http://localhost:3000',
    nodeEnv,
    sessionSecret: resolveSessionSecret(nodeEnv, readEnv('SESSION_SECRET')),
    gatewayEncryptionKey: readEnv('GATEWAY_ENCRYPTION_KEY')?.trim() || '',
    trustProxy: readEnv('TRUST_PROXY')?.trim().toLowerCase() === 'true',
    supabaseUrl: readEnv('SUPABASE_URL')?.trim() || '',
    supabaseAnonKey: readEnv('SUPABASE_ANON_KEY')?.trim() || '',
    supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '',
    adminBootstrapToken: readEnv('ADMIN_BOOTSTRAP_TOKEN')?.trim() || '',
    premierBankGatewayUrl: readEnv('PREMIER_BANK_GATEWAY_URL')?.trim() || '',
    premierBankMerchantId: readEnv('PREMIER_BANK_MERCHANT_ID')?.trim() || '',
    premierBankApiKey: readEnv('PREMIER_BANK_API_KEY')?.trim() || '',
    premierBankWebhookSecret: readEnv('PREMIER_BANK_WEBHOOK_SECRET')?.trim() || '',
    resendApiKey,
    emailFrom: readEnv('EMAIL_FROM')?.trim() || 'Khalid Sharif Digital Library <noreply@example.com>',
    requireEmailVerification,
  };
}
