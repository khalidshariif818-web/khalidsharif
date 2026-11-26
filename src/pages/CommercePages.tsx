import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Lock,
  ShieldCheck,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError, downloadAuthenticatedFile } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { SeoHead } from '../components/SeoHead';
import { calculateAuthoritativeOrderTotals, formatMoney } from '../shared/commerce';
import type { Book, Order, OrderStatus, PaymentProviderConfig, Promotion } from '../shared/types';

function formatOrderStatusLabel(status: OrderStatus, t: (k: string) => string): string {
  switch (status) {
    case 'paid':
      return t('statusPaid');
    case 'processing':
      return t('statusProcessing');
    case 'awaiting_payment':
      return t('statusAwaitingPayment');
    case 'failed':
      return t('statusFailed');
    case 'cancelled':
      return t('statusCancelled');
    case 'refunded':
      return t('statusRefunded');
    default:
      return status;
  }
}

const MastercardMark: React.FC<{ dimmed?: boolean }> = ({ dimmed }) => (
  <svg
    viewBox="0 0 38 24"
    aria-label="Mastercard"
    className={`h-5 w-auto transition-opacity duration-150 ${dimmed ? 'opacity-30' : 'opacity-100'}`}
  >
    <rect width="38" height="24" rx="4" fill="#181D24" />
    <circle cx="15" cy="12" r="6.5" fill="#EB001B" />
    <circle cx="23" cy="12" r="6.5" fill="#F79E1B" fillOpacity="0.9" />
  </svg>
);

const VisaMark: React.FC<{ dimmed?: boolean }> = ({ dimmed }) => (
  <svg
    viewBox="0 0 44 24"
    aria-label="Visa"
    className={`h-5 w-auto transition-opacity duration-150 ${dimmed ? 'opacity-30' : 'opacity-100'}`}
  >
    <rect width="44" height="24" rx="4" fill="#1A1F71" />
    <text
      x="22"
      y="15.5"
      textAnchor="middle"
      fill="#FFFFFF"
      fontSize="9.5"
      fontWeight="700"
      fontStyle="italic"
      fontFamily="system-ui, -apple-system, sans-serif"
      letterSpacing="0.8"
    >
      VISA
    </text>
  </svg>
);

export const CartPage: React.FC = () => {
  const { user, authLoading, cartItems, removeFromCart, language, t } = useApp();
  const navigate = useNavigate();

  if (authLoading) {
    return (
      <div className="max-w-[1160px] mx-auto px-3 sm:px-6">
        <div className="bg-white dark:bg-slate-900 border border-[#D4CEB8] dark:border-slate-800 rounded-md px-4 sm:px-8 py-12 text-sm text-slate-500">
          {t('loading')}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login?next=/cart" replace />;

  const subtotalCents = cartItems.reduce(
    (sum, item) => sum + (item.book.effectivePriceCents ?? item.book.priceCents),
    0
  );

  return (
    <>
      <SeoHead title={`${t('cartTitle')} – ${t('brandName')}`} description={t('cartTitle')} noIndex />
      <div className="max-w-6xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-sm px-4 py-5 sm:p-8 space-y-5 sm:space-y-7">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-stone-50 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
            {t('cartTitle')}
          </h1>

          {cartItems.length === 0 ? (
            <div className="p-6 sm:p-10 rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 text-center space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('emptyCart')}</p>
              <Link
                to="/catalog"
                className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-lg bg-[#0376B8] hover:bg-[#025E94] text-white dark:bg-sky-500 dark:text-slate-950"
              >
                {t('continueShopping')}
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
              <div className="lg:col-span-8 space-y-3">
                {cartItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 sm:p-4 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      {item.book.coverUrl && (
                        <img src={item.book.coverUrl} alt={item.book.title} className="w-12 h-17 sm:w-14 sm:h-20 object-cover rounded border border-[#D4CEB8] dark:border-slate-700 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link to={`/books/${item.book.slug}`} className="font-display text-base sm:text-lg font-semibold hover:text-[#0376B8] hover:underline block truncate">
                          {item.book.title}
                        </Link>
                        <p className="text-xs text-slate-500 truncate">{item.book.author}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#E5E0CE] dark:border-slate-800 shrink-0">
                      <div className="flex items-baseline gap-2">
                        {(item.book.effectivePriceCents ?? item.book.priceCents) < item.book.priceCents && (
                          <span className="font-mono-tabular text-xs line-through text-slate-400">
                            {formatMoney(item.book.priceCents, item.book.currency, language)}
                          </span>
                        )}
                        <span className="font-mono-tabular text-sm font-semibold">
                          {formatMoney(item.book.effectivePriceCents ?? item.book.priceCents, item.book.currency, language)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeFromCart(item.bookId)}
                        aria-label="Remove item"
                        className="min-w-10 min-h-10 flex items-center justify-center text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:col-span-4 p-4 sm:p-6 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-4">
                <h2 className="text-xl font-semibold text-[#025E94] dark:text-sky-400">{t('orderSummary')}</h2>
                <div className="flex justify-between text-sm pt-2 border-t border-[#E5E0CE] dark:border-slate-800">
                  <span>{t('subtotalLabel')}</span>
                  <span className="font-mono-tabular font-semibold">{formatMoney(subtotalCents, 'USD', language)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/checkout')}
                  className="w-full min-h-[44px] py-2.5 text-sm font-medium rounded-lg bg-[#0376B8] hover:bg-[#025E94] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950"
                >
                  {t('proceedCheckout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

interface CardFormErrors {
  billingEmail?: string;
  billingPhone?: string;
}

export const CheckoutPage: React.FC = () => {
  const { user, authLoading, cartItems, refreshCommerceState, language, t } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const directBookId = searchParams.get('bookId');

  const [checkoutBooks, setCheckoutBooks] = useState<Book[]>([]);
  const [activePromotions, setActivePromotions] = useState<Promotion[]>([]);
  const [methods, setMethods] = useState<PaymentProviderConfig[]>([]);
  const [selectedMethod, setSelectedMethod] = useState('');

  // Billing contact fields
  const [billingEmail, setBillingEmail] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CardFormErrors>({});

  // Discount preview state
  const [discountInput, setDiscountInput] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; percent: number } | null>(null);
  const [discountMsg, setDiscountMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [applyingDiscount, setApplyingDiscount] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setBillingEmail((prev) => prev || user.email || '');
    }
  }, [user]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [pmRes, promoRes] = await Promise.all([
          apiFetch<{ methods: PaymentProviderConfig[] }>('/api/payment-methods'),
          apiFetch<{ promotions: Promotion[] }>('/api/promotions/active').catch(() => ({ promotions: [] })),
        ]);
        setMethods(pmRes.methods);
        setActivePromotions(promoRes.promotions);
        const firstConnected = pmRes.methods.find((m) => m.isConnected) || pmRes.methods[0];
        if (firstConnected) setSelectedMethod(firstConnected.code);

        if (directBookId) {
          const bookRes = await apiFetch<{ book: Book }>(`/api/books/${directBookId}`);
          setCheckoutBooks([bookRes.book]);
        } else {
          setCheckoutBooks(cartItems.map((ci) => ci.book));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorLoading'));
      } finally {
        setLoading(false);
      }
    }
    if (user) void load();
  }, [user, directBookId, cartItems, t]);

  if (authLoading) {
    return (
      <div className="max-w-[1160px] mx-auto px-3 sm:px-6">
        <div className="bg-white dark:bg-slate-900 border border-[#D4CEB8] dark:border-slate-800 rounded-md px-4 sm:px-8 py-12 text-sm">
          {t('loading')}
        </div>
      </div>
    );
  }
  if (!user) {
    const returnTo = directBookId ? `/checkout?bookId=${encodeURIComponent(directBookId)}` : '/checkout';
    return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />;
  }

  let subtotalCents = checkoutBooks.reduce((s, b) => s + b.priceCents, 0);
  let discountCents = 0;
  let totalCents = subtotalCents;
  let usedPromoCode = false;
  if (checkoutBooks.length > 0) {
    try {
      const summary = calculateAuthoritativeOrderTotals(
        checkoutBooks,
        appliedDiscount?.percent ?? 0,
        activePromotions
      );
      subtotalCents = summary.subtotalCents;
      discountCents = summary.discountCents;
      totalCents = summary.totalCents;
      usedPromoCode = summary.usedPromoCode;
    } catch {
      const effectiveSubtotal = checkoutBooks.reduce((s, b) => s + (b.effectivePriceCents ?? b.priceCents), 0);
      const codeTotal = appliedDiscount
        ? Math.max(0, subtotalCents - Math.round((subtotalCents * appliedDiscount.percent) / 100))
        : subtotalCents;
      usedPromoCode = Boolean(appliedDiscount && codeTotal <= effectiveSubtotal);
      totalCents = usedPromoCode ? codeTotal : effectiveSubtotal;
      discountCents = Math.max(0, subtotalCents - totalCents);
    }
  }
  const selectedMethodObj = methods.find((m) => m.code === selectedMethod);
  const isCardGateway = selectedMethod === 'premier_bank_gateway';
  const isHostedRedirectReady = Boolean(isCardGateway && selectedMethodObj?.isConnected);

  const handleApplyDiscount = async () => {
    const trimmed = discountInput.trim().toUpperCase();
    if (!trimmed) return;
    setApplyingDiscount(true);
    setDiscountMsg(null);
    try {
      const res = await apiFetch<{ valid: boolean; code: string; discountPercent: number }>(
        '/api/checkout/validate-discount',
        { method: 'POST', body: JSON.stringify({ code: trimmed }) }
      );
      if (res.valid) {
        setAppliedDiscount({ code: res.code, percent: res.discountPercent });
        setDiscountMsg({ ok: true, text: `${t('discountAppliedMsg')} (${res.code} · -${res.discountPercent}%)` });
      } else {
        setAppliedDiscount(null);
        setDiscountMsg({ ok: false, text: t('discountInvalidMsg') });
      }
    } catch {
      setDiscountMsg({ ok: false, text: t('discountInvalidMsg') });
    } finally {
      setApplyingDiscount(false);
    }
  };

  const validateBillingContact = (): boolean => {
    const next: CardFormErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) {
      next.billingEmail = t('invalidBillingEmail');
    }
    if (billingPhone.replace(/\D/g, '').length < 7) {
      next.billingPhone = t('invalidBillingPhone');
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);

    if (isCardGateway) {
      if (selectedMethodObj && !selectedMethodObj.isConnected) {
        setInfoNotice(t('gatewaySubmitNotice'));
        return;
      }
      if (!validateBillingContact()) return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        order: Order;
        initiation: { redirectUrl?: string };
      }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          bookIds: checkoutBooks.map((b) => b.id),
          paymentMethodCode: selectedMethod,
          discountCode: appliedDiscount?.code || undefined,
          billingEmail: billingEmail.trim() || undefined,
          billingPhone: billingPhone.trim().length >= 5 ? billingPhone.trim() : undefined,
        }),
      });

      await refreshCommerceState();
      if (res.initiation.redirectUrl) {
        window.location.href = res.initiation.redirectUrl;
        return;
      }
      navigate(`/checkout/result?order=${encodeURIComponent(res.order.orderReference)}`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setError(err.message);
      } else if (err instanceof ApiError && err.status === 401) {
        const returnTo = directBookId ? `/checkout?bookId=${encodeURIComponent(directBookId)}` : '/checkout';
        navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true });
      } else {
        setError(err instanceof Error ? err.message : 'Checkout failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SeoHead title={`${t('checkoutTitle')} – ${t('brandName')}`} description={t('checkoutTitle')} noIndex />
      <div className="max-w-6xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-sm px-4 py-5 sm:p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
            <div className="space-y-1">
              <Link
                to="/cart"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t('checkoutBackLink')}</span>
              </Link>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-stone-50 text-balance">
                {t('checkoutTitle')}
              </h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Lock className="w-3.5 h-3.5 text-[#0376B8] dark:text-sky-400 shrink-0" />
              <span>{t('encryptedNote')}</span>
            </div>
          </div>

          {loading ? (
            <div className="h-56 rounded-lg bg-slate-200/60 dark:bg-slate-800/50 animate-pulse" />
          ) : checkoutBooks.length === 0 ? (
            <div className="p-6 sm:p-10 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 text-center space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('emptyCart')}</p>
              <Link to="/catalog" className="inline-block text-sm font-medium text-[#0376B8] dark:text-sky-400 underline">
                {t('continueShopping')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handlePlaceOrder} noValidate className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              {/* Left Column: Payment Method Selector & Fillable Card Form */}
              <div className="lg:col-span-7 space-y-6">
                {error && (
                  <div
                    role="alert"
                    className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {infoNotice && (
                  <div
                    role="status"
                    className="p-4 rounded-lg bg-[#EFF6FC] dark:bg-sky-950/40 border border-[#7BB3DF] dark:border-sky-500/40 text-sm text-[#025E94] dark:text-sky-200 flex items-start gap-2.5"
                  >
                    <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{infoNotice}</span>
                  </div>
                )}

                {/* Payment Method Selection */}
                <section className="space-y-3">
                  <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {t('paymentMethodLabel')}
                  </h2>

                  <div className="space-y-2.5">
                    {methods.map((method) => {
                      const isSelected = selectedMethod === method.code;
                      const instructions =
                        language === 'so'
                          ? method.instructionsSo
                          : language === 'ar'
                            ? method.instructionsAr
                            : method.instructionsEn;

                      return (
                        <label
                          key={method.code}
                          className={`block p-4 rounded-lg border cursor-pointer transition-colors duration-150 ${
                            isSelected
                              ? 'border-[#0376B8] dark:border-sky-400 bg-[#F4F9FD] dark:bg-sky-950/25'
                              : 'border-[#D4CEB8] dark:border-slate-700 bg-[#FAF9F5] dark:bg-slate-950/60 hover:border-[#B6AE96]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="radio"
                                name="paymentMethod"
                                value={method.code}
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedMethod(method.code);
                                  setError(null);
                                  setInfoNotice(null);
                                }}
                                className="w-4 h-4 accent-[#0376B8]"
                              />
                              <div className="flex items-center gap-2 min-w-0">
                                <CreditCard className="w-4 h-4 text-[#0376B8] dark:text-sky-400 shrink-0" />
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {method.displayName}
                                </span>
                              </div>
                            </div>

                                                        {Array.isArray(method.publicConfig?.cardNetworks) && method.publicConfig.cardNetworks.length > 0 && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {method.publicConfig.cardNetworks.includes('Mastercard') && <MastercardMark />}
                                {method.publicConfig.cardNetworks.includes('Visa') && <VisaMark />}
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 ps-7 leading-relaxed">
                            {instructions}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                </section>

                {/* Fillable Premier Bank Card Payment Form */}
                {isCardGateway && (
                  <section className="p-4 sm:p-6 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2DCCB] dark:border-slate-800">
                      <h2 className="text-base sm:text-lg font-semibold text-[#025E94] dark:text-sky-400">
                        {t('cardDetailsTitle')}
                      </h2>
                      <div className="flex items-center gap-1.5">
                        <MastercardMark />
                        <VisaMark />
                      </div>
                    </div>

                    <div className="space-y-4">
                      {isHostedRedirectReady ? (
                        <>
                          <div className="p-4 rounded-lg bg-[#EFF6FC] dark:bg-sky-950/30 border border-[#7BB3DF] dark:border-sky-500/40 flex items-start gap-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                            <ShieldCheck className="w-5 h-5 text-[#0376B8] dark:text-sky-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <div className="font-semibold text-slate-900 dark:text-stone-100">
                                {t('gatewayActiveNoticeTitle')}
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                {t('gatewayActiveNoticeDesc')}
                              </p>
                            </div>
                          </div>

                          {/* Billing Email & Phone */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1">
                            <div className="space-y-1.5">
                              <label htmlFor="billing-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                {t('billingEmailLabel')}
                              </label>
                              <input
                                id="billing-email"
                                type="email"
                                autoComplete="email"
                                value={billingEmail}
                                onChange={(e) => {
                                  setBillingEmail(e.target.value);
                                  if (fieldErrors.billingEmail) setFieldErrors((p) => ({ ...p, billingEmail: undefined }));
                                }}
                                className={`w-full min-h-[44px] px-3.5 py-2 text-sm rounded-lg border bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0376B8] ${
                                  fieldErrors.billingEmail
                                    ? 'border-red-500 dark:border-red-500'
                                    : 'border-[#D4CEB8] dark:border-slate-700'
                                }`}
                              />
                              {fieldErrors.billingEmail && (
                                <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.billingEmail}</p>
                              )}
                            </div>

                            <div className="space-y-1.5">
                              <label htmlFor="billing-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                {t('billingPhoneLabel')}
                              </label>
                              <input
                                id="billing-phone"
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                value={billingPhone}
                                onChange={(e) => {
                                  setBillingPhone(e.target.value);
                                  if (fieldErrors.billingPhone) setFieldErrors((p) => ({ ...p, billingPhone: undefined }));
                                }}
                                placeholder={t('billingPhonePlaceholder')}
                                className={`w-full min-h-[44px] px-3.5 py-2 text-sm rounded-lg border bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0376B8] ${
                                  fieldErrors.billingPhone
                                    ? 'border-red-500 dark:border-red-500'
                                    : 'border-[#D4CEB8] dark:border-slate-700'
                                }`}
                              />
                              {fieldErrors.billingPhone && (
                                <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.billingPhone}</p>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="p-4 rounded-lg bg-white/80 dark:bg-slate-900 border border-amber-300/80 dark:border-amber-700/60 flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                          <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{t('gatewayPendingTitle')}</div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t('gatewayPendingDesc')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>

              {/* Right Column: Order Summary, Discount Code & Pay CTA */}
              <aside className="lg:col-span-5 lg:sticky lg:top-6 p-4 sm:p-6 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-5">
                <h2 className="text-lg sm:text-xl font-semibold text-[#025E94] dark:text-sky-400">
                  {t('orderSummary')}
                </h2>

                <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800">
                  {checkoutBooks.map((b) => {
                    const eff = b.effectivePriceCents ?? b.priceCents;
                    const discounted = !b.isFree && eff < b.priceCents;
                    return (
                      <div key={b.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {b.coverUrl && (
                            <img
                              src={b.coverUrl}
                              alt={b.title}
                              referrerPolicy="no-referrer"
                              className="w-10 h-14 object-cover rounded border border-[#D4CEB8] dark:border-slate-700 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{b.title}</div>
                            <div className="text-xs text-slate-500 truncate">{b.author}</div>
                          </div>
                        </div>
                        <div className="text-end shrink-0">
                          {discounted && (
                            <div className="font-mono-tabular text-[11px] line-through text-slate-400">
                              {formatMoney(b.priceCents, b.currency, language)}
                            </div>
                          )}
                          <span className="font-mono-tabular text-sm font-medium">
                            {formatMoney(eff, b.currency, language)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Discount Code */}
                <div className="pt-3 border-t border-[#E2DCCB] dark:border-slate-800 space-y-2">
                  <label htmlFor="discount-input" className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <Tag className="w-3.5 h-3.5 text-[#0376B8] dark:text-sky-400" />
                    <span>{t('discountCodeLabel')}</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="discount-input"
                      type="text"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      placeholder={t('discountCodePlaceholder')}
                      className="flex-1 min-w-0 min-h-[42px] px-3 py-2 text-sm uppercase font-mono-tabular rounded-lg border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleApplyDiscount()}
                      disabled={applyingDiscount || !discountInput.trim()}
                      className="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-[#FAF8F2] dark:hover:bg-slate-800 disabled:opacity-50 shrink-0"
                    >
                      {t('applyCode')}
                    </button>
                  </div>
                  {discountMsg && (
                    <p className={`text-xs ${discountMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {discountMsg.text}
                    </p>
                  )}
                </div>

                {/* Totals */}
                <div className="pt-3 border-t border-[#D4CEB8] dark:border-slate-700 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>{t('subtotalLabel')}</span>
                    <span className="font-mono-tabular">{formatMoney(subtotalCents, 'USD', language)}</span>
                  </div>
                  {discountCents > 0 && (
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                      <span>
                        {t('discountLabel')}{' '}
                        {usedPromoCode && appliedDiscount
                          ? `(${appliedDiscount.code} -${appliedDiscount.percent}%)`
                          : `(${t('saleLabel')})`}
                      </span>
                      <span className="font-mono-tabular">-{formatMoney(discountCents, 'USD', language)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-[#E2DCCB] dark:border-slate-800 flex justify-between text-base font-semibold text-slate-900 dark:text-stone-50">
                    <span>{t('totalLabel')}</span>
                    <span className="font-mono-tabular text-lg">{formatMoney(totalCents, 'USD', language)}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !selectedMethod || (isCardGateway && !isHostedRedirectReady)}
                  className="w-full min-h-[48px] py-3 px-4 text-sm font-semibold rounded-lg bg-[#0376B8] hover:bg-[#025E94] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>
                    {submitting
                      ? t('loading')
                      : `${t('placeOrderBtn')} · ${formatMoney(totalCents, 'USD', language)}`}
                  </span>
                </button>

                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#0376B8] dark:text-sky-400 shrink-0" />
                  <span>{t('checkoutSecureNote')}</span>
                </p>
              </aside>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export const CheckoutResultPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderRef = searchParams.get('order') || '';
  const resultIndicator = searchParams.get('resultIndicator') || '';
  const { user, authLoading, language, refreshCommerceState, t } = useApp();

  const [order, setOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentProviderConfig | null>(null);
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = async () => {
    if (!orderRef) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ order: Order; paymentMethod: PaymentProviderConfig | null }>(`/api/orders/${encodeURIComponent(orderRef)}`);
      let resolvedOrder = res.order;
      setPaymentMethod(res.paymentMethod);

      if (resolvedOrder.status !== 'paid' && (resultIndicator || resolvedOrder.payment?.providerCode === 'premier_bank_gateway')) {
        try {
          const verifyRes = await apiFetch<{ verified: boolean; order: Order }>(
            `/api/orders/${encodeURIComponent(orderRef)}/verify-return`,
            {
              method: 'POST',
              body: JSON.stringify({ resultIndicator: resultIndicator || undefined }),
            }
          );
          if (verifyRes.order) {
            resolvedOrder = verifyRes.order;
          }
          if (verifyRes.verified) {
            await refreshCommerceState();
          }
        } catch {
          // Non-fatal: webhook or manual verification may confirm shortly
        }
      }

      setOrder(resolvedOrder);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const query = searchParams.toString();
        const nextUrl = `/checkout/result${query ? `?${query}` : ''}`;
        navigate(`/login?next=${encodeURIComponent(nextUrl)}`, { replace: true });
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load order');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;
    if (!orderRef) {
      setLoading(false);
      setError('Order reference not found');
      return;
    }
    void loadOrder();
  }, [authLoading, user, orderRef, resultIndicator]);

  if (!authLoading && !user) {
    const query = searchParams.toString();
    const nextUrl = `/checkout/result${query ? `?${query}` : ''}`;
    return <Navigate to={`/login?next=${encodeURIComponent(nextUrl)}`} replace />;
  }

  const handleSubmitReference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/orders/${order.id}/manual-reference`, {
        method: 'POST',
        body: JSON.stringify({ customerReference: reference }),
      });
      setOrder(res.order);
      setReference('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const query = searchParams.toString();
        const nextUrl = `/checkout/result${query ? `?${query}` : ''}`;
        navigate(`/login?next=${encodeURIComponent(nextUrl)}`, { replace: true });
      } else {
        setError(err instanceof Error ? err.message : 'Submission failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const rawPaymentAccount = typeof paymentMethod?.publicConfig?.accountNumber === 'string'
    ? paymentMethod.publicConfig.accountNumber
    : '';
  const ussdTemplate = typeof paymentMethod?.publicConfig?.ussdTemplate === 'string'
    ? paymentMethod.publicConfig.ussdTemplate
    : rawPaymentAccount.includes('{{amount}}') ? rawPaymentAccount : '';
  const accountNumberFromUssd = rawPaymentAccount.match(/^\*[^*]+\*([^*]+)\*\{\{amount\}\}#$/i)?.[1];
  const paymentAccountNumber = accountNumberFromUssd || rawPaymentAccount;
  // Orders store cents; EVC uses '*' as the decimal separator (e.g. $18.50 => 18*5).
  const orderTotalUssdAmount = order
    ? (Math.round(order.totalCents) / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', '*')
    : '';
  const ussdCode = order && ussdTemplate.includes('{{amount}}')
    ? ussdTemplate.replace(/\{\{amount\}\}/gi, orderTotalUssdAmount)
    : '';
  const ussdHref = ussdCode && /^[0-9*#+.]+$/.test(ussdCode) ? `tel:${encodeURIComponent(ussdCode)}` : '';

  return (
    <>
      <SeoHead title={`${t('orderSummary')} – ${t('brandName')}`} description={t('orderSummary')} noIndex />
      <div className="max-w-2xl mx-auto px-0 sm:px-6 py-0 sm:py-8">
        {loading ? (
          <div className="h-48 rounded-none sm:rounded-xl bg-white/80 dark:bg-slate-800/50 border-y sm:border border-[#D4CEB8] animate-pulse" />
        ) : !order ? (
          <div className="px-4 py-6 sm:p-8 rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 text-center space-y-4">
            <p className="text-sm text-red-600">{error || 'Order not found'}</p>
            <Link
              to="/account/purchases"
              className="inline-flex items-center justify-center min-h-[42px] px-4 py-2 text-sm font-medium rounded-lg border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800"
            >
              {t('tabPurchases')}
            </Link>
          </div>
        ) : (
          <div className="px-4 py-5 sm:p-8 rounded-none sm:rounded-xl shadow-none sm:shadow-sm bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">{t('orderReferenceLabel')}</div>
                <h1 className="font-mono-tabular text-xl sm:text-2xl font-semibold text-[#025E94] dark:text-sky-400 break-all">{order.orderReference}</h1>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {order.status === 'paid' ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-5 h-5" />
                    {t('orderPaidUnlocked')}
                  </span>
                ) : order.status === 'failed' || order.status === 'cancelled' || order.status === 'refunded' ? (
                  <span className="inline-flex items-center gap-1.5 text-red-600">
                    <XCircle className="w-5 h-5" />
                    {formatOrderStatusLabel(order.status, t)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <Clock className="w-5 h-5" />
                    {t('awaitingAdminVerification')}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between">
                  <span>{item.bookTitleSnapshot}</span>
                  <span className="font-mono-tabular">{formatMoney(item.unitPriceCents, order.currency, language)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-[#E5E0CE] dark:border-slate-800 flex justify-between font-semibold">
                <span>{t('totalLabel')}</span>
                <span className="font-mono-tabular">{formatMoney(order.totalCents, order.currency, language)}</span>
              </div>
            </div>

            {paymentMethod?.providerType === 'manual' && order.status !== 'paid' && (
              <div className="p-4 rounded bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-4">
                <div>
                  <h2 className="font-semibold text-sm">{paymentMethod.displayName}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {language === 'so'
                      ? paymentMethod.instructionsSo || paymentMethod.instructionsEn
                      : language === 'ar'
                        ? paymentMethod.instructionsAr || paymentMethod.instructionsEn
                        : paymentMethod.instructionsEn || paymentMethod.instructionsSo}
                  </p>
                  {paymentAccountNumber && (
                    <p className="mt-2 text-sm font-semibold">{language === 'so' ? 'Lambarka:' : 'Account number:'} <span className="font-mono">{paymentAccountNumber}</span></p>
                  )}
                  {ussdHref && (
                    <a href={ussdHref} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded bg-[#0376B8] px-4 py-2 text-sm font-medium text-white hover:bg-[#025E94]">
                      {language === 'so' ? `Ku bixi ${paymentMethod.displayName} · ${formatMoney(order.totalCents, order.currency, language)}` : `Pay by ${paymentMethod.displayName} · ${formatMoney(order.totalCents, order.currency, language)}`}
                    </a>
                  )}
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{t('awaitingAdminVerification')}</p>
                </div>
                {order.payment?.customerSubmittedReference ? (
                  <div className="text-sm space-y-1">
                    <p className="font-medium">{t('awaitingAdminVerification')}</p>
                    <p className="text-xs text-slate-500 font-mono-tabular">
                      {t('referenceShortLabel')}: {order.payment?.customerSubmittedReference}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReference} className="space-y-3">
                    <label htmlFor="manual-ref" className="block text-sm font-medium">
                      {t('manualRefLabel')}
                    </label>
                    <input
                      id="manual-ref"
                      type="text"
                      required
                      minLength={3}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={t('manualRefPlaceholder')}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#025E94] text-white dark:bg-sky-500 dark:text-slate-950"
                    >
                      {t('submitReferenceBtn')}
                    </button>
                  </form>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:gap-3 pt-2">
              {order.status === 'paid' && order.items[0] && (
                <Link
                  to={`/reader/${order.items[0].bookId}`}
                  className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-lg bg-[#0376B8] hover:bg-[#025E94] text-white dark:bg-sky-500 dark:text-slate-950"
                >
                  {t('openInReader')}
                </Link>
              )}
              {order.status === 'paid' && (
                <button
                  type="button"
                  onClick={() =>
                    void downloadAuthenticatedFile(
                      `/api/orders/${order.id}/receipt`,
                      `receipt-${order.orderReference}.pdf`
                    )
                  }
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-lg border border-[#0376B8] text-[#0376B8] dark:border-sky-400 dark:text-sky-400 hover:bg-[#F4F9FD] dark:hover:bg-sky-950/30"
                >
                  <Download className="w-4 h-4" />
                  <span>{t('downloadReceipt')}</span>
                </button>
              )}
              <Link
                to="/account/library"
                className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-lg border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800"
              >
                {t('tabLibrary')}
              </Link>
              <Link
                to="/account/purchases"
                className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-lg border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800"
              >
                {t('tabPurchases')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
