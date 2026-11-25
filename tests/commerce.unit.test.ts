import { describe, expect, it } from 'vitest';
import {
  calculateAuthoritativeOrderTotals,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  canUserAccessBookPdf,
  resolveBookEffectivePricing,
} from '../src/shared/commerce.ts';

import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  maskSecretValue,
  validateGatewayUrl,
} from '../src/server/services/secrets.ts';
import type { Promotion } from '../src/shared/types.ts';

describe('Commerce & Entitlement Domain Rules', () => {
  it('calculates authoritative totals and rejects free/unpublished books in paid checkout', () => {
    const totals = calculateAuthoritativeOrderTotals(
      [
        { id: 'b1', isFree: false, priceCents: 1850, status: 'published', currency: 'USD' },
        { id: 'b2', isFree: false, priceCents: 1150, status: 'published', currency: 'USD' },
      ],
      10
    );
    expect(totals.subtotalCents).toBe(3000);
    expect(totals.discountCents).toBe(300);
    expect(totals.totalCents).toBe(2700);

    expect(() =>
      calculateAuthoritativeOrderTotals([{ id: 'b3', isFree: true, priceCents: 0, status: 'published', currency: 'USD' }])
    ).toThrow();

    expect(() =>
      calculateAuthoritativeOrderTotals([{ id: 'b4', isFree: false, priceCents: 1000, status: 'draft', currency: 'USD' }])
    ).toThrow();
  });

  it('resolves salePriceCents and scoped promotions and enforces non-stacking checkout totals', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const promotions: Promotion[] = [
      {
        id: 'p-lib',
        name: 'Summer Library Sale',
        scope: 'library',
        targetId: null,
        discountType: 'percent',
        discountValue: 20,
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-06-30T23:59:59.000Z',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'p-cat',
        name: 'History Fixed Off',
        scope: 'category',
        targetId: 'cat-history',
        discountType: 'fixed_cents',
        discountValue: 600,
        startsAt: null,
        endsAt: null,
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'p-expired',
        name: 'Expired Flash',
        scope: 'book',
        targetId: 'b1',
        discountType: 'percent',
        discountValue: 90,
        startsAt: '2025-01-01T00:00:00.000Z',
        endsAt: '2025-01-02T00:00:00.000Z',
        isActive: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ];

    // 2000 regular, salePriceCents 1500, library 20% -> 1600, category -600 -> 1400 (wins)
    const pricing = resolveBookEffectivePricing(
      { id: 'b1', categoryId: 'cat-history', isFree: false, priceCents: 2000, salePriceCents: 1500 },
      promotions,
      now
    );
    expect(pricing.effectivePriceCents).toBe(1400);
    expect(pricing.discountCents).toBe(600);
    expect(pricing.discountLabel).toBe('History Fixed Off');

    // Non-stacking: 10% promo code (1800) loses to active category promo (1400)
    const autoWins = calculateAuthoritativeOrderTotals(
      [{ id: 'b1', categoryId: 'cat-history', isFree: false, priceCents: 2000, salePriceCents: 1500, status: 'published', currency: 'USD' }],
      10,
      promotions.filter((p) => p.id !== 'p-expired')
    );
    expect(autoWins.usedPromoCode).toBe(false);
    expect(autoWins.totalCents).toBe(1400);
    expect(autoWins.discountCents).toBe(600);

    // Non-stacking: 50% promo code (1000) beats active category promo (1400) without stacking
    const codeWins = calculateAuthoritativeOrderTotals(
      [{ id: 'b1', categoryId: 'cat-history', isFree: false, priceCents: 2000, salePriceCents: 1500, status: 'published', currency: 'USD' }],
      50,
      promotions.filter((p) => p.id !== 'p-expired')
    );
    expect(codeWins.usedPromoCode).toBe(true);
    expect(codeWins.totalCents).toBe(1000);
    expect(codeWins.discountCents).toBe(1000);
  });

  it('enforces valid order and payment state transitions', () => {
    expect(canTransitionOrderStatus('awaiting_payment', 'paid')).toBe(true);
    expect(canTransitionOrderStatus('cancelled', 'paid')).toBe(false);
    expect(canTransitionOrderStatus('paid', 'refunded')).toBe(true);
    expect(canTransitionOrderStatus('refunded', 'paid')).toBe(false);

    expect(canTransitionPaymentStatus('pending_verification', 'verified')).toBe(true);
    expect(canTransitionPaymentStatus('failed', 'verified')).toBe(false);
  });

  it('enforces PDF access entitlement rules strictly', () => {
    expect(canUserAccessBookPdf({ book: { status: 'published', isFree: true }, hasActiveEntitlement: false, isAdmin: false })).toBe(true);
    expect(canUserAccessBookPdf({ book: { status: 'published', isFree: false }, hasActiveEntitlement: false, isAdmin: false })).toBe(false);
    expect(canUserAccessBookPdf({ book: { status: 'published', isFree: false }, hasActiveEntitlement: true, isAdmin: false })).toBe(true);
    expect(canUserAccessBookPdf({ book: { status: 'draft', isFree: false }, hasActiveEntitlement: true, isAdmin: false })).toBe(false);
    expect(canUserAccessBookPdf({ book: { status: 'draft', isFree: false }, hasActiveEntitlement: false, isAdmin: true })).toBe(true);
  });

  it('encrypts/masks gateway secrets cleanly, supports dual-key rotation, and enforces HTTPS + SSRF protection in production', () => {
    const oldSecret = 'unit-test-old-secret-32-chars-min!';
    const newSecret = 'unit-test-new-secret-32-chars-min!';
    const raw = JSON.stringify({ apiKey: 'pb-live-key-9988', webhookSecret: 'whsec-11223344' });
    const encryptedWithOld = encryptGatewayPayload(raw, oldSecret);
    expect(encryptedWithOld).not.toContain('pb-live-key-9988');
    expect(decryptGatewayPayload<{ apiKey: string }>(encryptedWithOld, oldSecret)?.apiKey).toBe('pb-live-key-9988');
    expect(decryptGatewayPayload<{ apiKey: string }>(encryptedWithOld, newSecret, oldSecret)?.apiKey).toBe('pb-live-key-9988');
    expect(decryptGatewayPayload(encryptedWithOld, 'wrong-secret', 'also-wrong')).toBeNull();
    expect(maskSecretValue('pb-live-key-9988')).toBe('••••••••9988');

    expect(validateGatewayUrl('https://ap-gateway.mastercard.com/', 'production')).toBe('https://ap-gateway.mastercard.com');
    expect(() => validateGatewayUrl('http://ap-gateway.mastercard.com', 'production')).toThrow();
    expect(() => validateGatewayUrl('https://127.0.0.1/api', 'production')).toThrow();
    expect(() => validateGatewayUrl('https://169.254.169.254/latest/meta-data', 'production')).toThrow();
    expect(() => validateGatewayUrl('https://10.0.0.5/session', 'production')).toThrow();
  });
});
