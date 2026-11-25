import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export interface SignedTokenPayload {
  sub: string;
  typ: 'session' | 'pdf_access' | 'password_reset' | 'email_verify';
  exp: number;
  bookId?: string;
  jti?: string;
  sv?: number;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signToken(payload: Omit<SignedTokenPayload, 'exp'>, secret: string, ttlSeconds: number): string {
  const fullPayload: SignedTokenPayload = {
    ...payload,
    jti: payload.jti || crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = base64UrlEncode(JSON.stringify(fullPayload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

export function verifyToken(token: string, secret: string, expectedType?: SignedTokenPayload['typ']): SignedTokenPayload | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sigPart = token.slice(dotIdx + 1);
  if (!encoded || !sigPart) return null;

  const expectedSig = base64UrlEncode(crypto.createHmac('sha256', secret).update(encoded).digest());
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as SignedTokenPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (expectedType && parsed.typ !== expectedType) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function validatePdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  );
}

export function validateImageMagicBytes(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Neutralize CSV formula injection (=, +, -, @, tab, CR) and quote per RFC 4180.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly maxRequests: number, private readonly windowMs: number) {}

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) || []).filter((ts) => ts > cutoff);
    if (recent.length >= this.maxRequests) {
      const oldest = recent[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }
}
