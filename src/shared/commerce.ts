import type { Book, LanguageCode, OrderStatus, PaymentStatus } from './types.ts';

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['awaiting_payment', 'processing', 'paid', 'failed', 'cancelled'],
  awaiting_payment: ['processing', 'paid', 'failed', 'cancelled'],
  processing: ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: ['awaiting_payment', 'cancelled'],
  cancelled: [],
  refunded: [],
};

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  initiated: ['pending_verification', 'processing', 'verified', 'failed', 'cancelled'],
  pending_verification: ['verified', 'failed', 'cancelled'],
  processing: ['verified', 'failed', 'cancelled'],
  verified: ['refunded'],
  failed: ['initiated'],
  cancelled: [],
  refunded: [],
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface PriceSummary {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  appliedUnitPriceCents: number[];
  usedPromoCode: boolean;
}

export interface EffectiveBookPricing {
  originalPriceCents: number;
  effectivePriceCents: number;
  discountCents: number;
  discountLabel: string | null;
}

export function isPromotionCurrentlyActive(
  promo: Pick<import('./types.ts').Promotion, 'isActive' | 'startsAt' | 'endsAt'>,
  now: Date = new Date()
): boolean {
  if (!promo.isActive) return false;
  const nowMs = now.getTime();
  if (promo.startsAt) {
    const startMs = Date.parse(promo.startsAt);
    if (!Number.isNaN(startMs) && nowMs < startMs) return false;
  }
  if (promo.endsAt) {
    const endMs = Date.parse(promo.endsAt);
    if (!Number.isNaN(endMs) && nowMs > endMs) return false;
  }
  return true;
}

export function resolveBookEffectivePricing(
  book: Pick<Book, 'id' | 'categoryId' | 'isFree' | 'priceCents'> & { salePriceCents?: number | null },
  activePromotions: ReadonlyArray<import('./types.ts').Promotion> = [],
  now: Date = new Date()
): EffectiveBookPricing {
  if (book.isFree || book.priceCents <= 0) {
    return {
      originalPriceCents: 0,
      effectivePriceCents: 0,
      discountCents: 0,
      discountLabel: null,
    };
  }

  let bestPrice = book.priceCents;
  let bestLabel: string | null = null;

  if (
    typeof book.salePriceCents === 'number' &&
    book.salePriceCents >= 0 &&
    book.salePriceCents < bestPrice
  ) {
    bestPrice = book.salePriceCents;
    const pct = Math.round(((book.priceCents - bestPrice) / book.priceCents) * 100);
    bestLabel = pct > 0 ? `-${pct}%` : 'Sale';
  }

  for (const promo of activePromotions) {
    if (!isPromotionCurrentlyActive(promo, now)) continue;
    const applies =
      promo.scope === 'library' ||
      (promo.scope === 'category' && promo.targetId === book.categoryId) ||
      (promo.scope === 'book' && promo.targetId === book.id);
    if (!applies) continue;

    let candidate = book.priceCents;
    if (promo.discountType === 'percent') {
      const clamped = Math.max(0, Math.min(95, promo.discountValue));
      candidate = Math.max(0, book.priceCents - Math.round((book.priceCents * clamped) / 100));
    } else {
      candidate = Math.max(0, book.priceCents - promo.discountValue);
    }

    if (candidate < bestPrice) {
      bestPrice = candidate;
      bestLabel = promo.discountType === 'percent' ? `-${promo.discountValue}%` : promo.name;
    }
  }

  return {
    originalPriceCents: book.priceCents,
    effectivePriceCents: bestPrice,
    discountCents: Math.max(0, book.priceCents - bestPrice),
    discountLabel: bestLabel,
  };
}

export function calculateAuthoritativeOrderTotals(
  books: (Pick<Book, 'id' | 'isFree' | 'priceCents' | 'status' | 'currency'> & {
    categoryId?: string;
    salePriceCents?: number | null;
  })[],
  discountRatePercent = 0,
  activePromotions: ReadonlyArray<import('./types.ts').Promotion> = []
): PriceSummary {
  if (books.length === 0) {
    throw new Error('Cannot calculate order totals for empty item list');
  }

  for (const book of books) {
    if (book.status !== 'published') {
      throw new Error(`Book ${book.id} is not available for purchase`);
    }
    if (book.isFree || book.priceCents <= 0) {
      throw new Error(`Free book ${book.id} does not require paid checkout`);
    }
  }

  const baseSubtotalCents = books.reduce((sum, b) => sum + b.priceCents, 0);
  const autoUnitPrices = books.map((b) =>
    resolveBookEffectivePricing(
      {
        id: b.id,
        categoryId: b.categoryId || '',
        isFree: b.isFree,
        priceCents: b.priceCents,
        salePriceCents: b.salePriceCents ?? null,
      },
      activePromotions
    ).effectivePriceCents
  );
  const autoTotalCents = autoUnitPrices.reduce((sum, p) => sum + p, 0);

  const clampedRate = Math.max(0, Math.min(100, discountRatePercent));
  const codeDiscountCents = Math.round((baseSubtotalCents * clampedRate) / 100);
  const codeTotalCents = Math.max(0, baseSubtotalCents - codeDiscountCents);

  // Non-stacking rule: apply whichever gives the single lowest total (promo code vs automatic sale/promotion)
  const usePromoCode = clampedRate > 0 && codeTotalCents <= autoTotalCents;
  const totalCents = usePromoCode ? codeTotalCents : autoTotalCents;
  const discountCents = Math.max(0, baseSubtotalCents - totalCents);
  const appliedUnitPriceCents = usePromoCode ? books.map((b) => b.priceCents) : autoUnitPrices;

  return {
    subtotalCents: baseSubtotalCents,
    discountCents,
    totalCents,
    currency: books[0]?.currency || 'USD',
    appliedUnitPriceCents,
    usedPromoCode: usePromoCode,
  };
}

export function canUserAccessBookPdf(params: {
  book: Pick<Book, 'status' | 'isFree'>;
  hasActiveEntitlement: boolean;
  isAdmin: boolean;
}): boolean {
  const { book, hasActiveEntitlement, isAdmin } = params;
  if (isAdmin) return true;
  if (book.status !== 'published') return false;
  if (book.isFree) return true;
  return hasActiveEntitlement;
}

export function formatMoney(cents: number, currency = 'USD', lang: LanguageCode = 'en'): string {
  const locale = lang === 'ar' ? 'ar-SA' : lang === 'so' ? 'so-SO' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function formatLocalizedDate(isoDate: string, lang: LanguageCode = 'en'): string {
  const locale = lang === 'ar' ? 'ar-SA' : lang === 'so' ? 'so-SO' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(isoDate));
  } catch {
    return isoDate.slice(0, 10);
  }
}
