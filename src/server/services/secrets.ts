import crypto from 'node:crypto';
import net from 'node:net';

function deriveEncryptionKey(sessionSecret: string): Buffer {
  return crypto.scryptSync(sessionSecret, 'ksdl-gateway-secrets-v1', 32);
}

export function encryptGatewayPayload(plaintextJson: string, sessionSecret: string): string {
  const key = deriveEncryptionKey(sessionSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function tryDecryptWithSecret<T>(
  parsed: { v: number; iv: string; tag: string; data: string },
  secret: string
): T | null {
  try {
    const key = deriveEncryptionKey(secret);
    const iv = Buffer.from(parsed.iv, 'base64');
    const tag = Buffer.from(parsed.tag, 'base64');
    const data = Buffer.from(parsed.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

export function decryptGatewayPayload<T>(
  storedJson: string,
  primarySecret: string,
  fallbackSecret?: string
): T | null {
  try {
    const parsed = JSON.parse(storedJson) as { v?: number; iv?: string; tag?: string; data?: string };
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
      return null;
    }
    const valid = parsed as { v: number; iv: string; tag: string; data: string };
    if (primarySecret) {
      const result = tryDecryptWithSecret<T>(valid, primarySecret);
      if (result !== null) return result;
    }
    if (fallbackSecret && fallbackSecret !== primarySecret) {
      return tryDecryptWithSecret<T>(valid, fallbackSecret);
    }
    return null;
  } catch {
    return null;
  }
}

export function maskSecretValue(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••••••${trimmed.slice(-4)}`;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean === '0.0.0.0' ||
    clean === '::1' ||
    clean === 'metadata.google.internal' ||
    clean.endsWith('.internal') ||
    clean.endsWith('.local')
  ) {
    return true;
  }

  const ipType = net.isIP(clean);
  if (ipType === 4) {
    const parts = clean.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
  } else if (ipType === 6) {
    if (clean === '::1' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
      return true;
    }
  }

  return false;
}

export function validateGatewayUrl(rawUrl: string, nodeEnv: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Gateway URL must be a valid URL (e.g. https://ap-gateway.mastercard.com)');
  }

  if (parsed.protocol !== 'https:' && (nodeEnv === 'production' || parsed.protocol !== 'http:')) {
    throw new Error('Gateway URL must use HTTPS');
  }

  if (nodeEnv !== 'test' && isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error('Gateway URL cannot point to a private, loopback, or internal network host');
  }

  return parsed.toString().replace(/\/+$/, '');
}
