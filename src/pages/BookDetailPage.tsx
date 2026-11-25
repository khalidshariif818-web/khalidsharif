import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, BookmarkPlus, Check, Heart, ShoppingBag, Star } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { BookCard } from '../components/BookCard';
import { SeoHead } from '../components/SeoHead';
import { localizedCategoryName } from '../i18n/translations';
import { formatLocalizedDate, formatMoney } from '../shared/commerce';
import type { Book, BookReview, ReadingProgress } from '../shared/types';

interface BookDetailResponse {
  book: Book;
  access: {
    canRead: boolean;
    hasEntitlement: boolean;
    inWishlist: boolean;
    inCart: boolean;
  };
  related: Book[];
  reviews: BookReview[];
  readerState: { progress: ReadingProgress | null } | null;
}

export const BookDetailPage: React.FC = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, language, addToCart, toggleWishlist, t } = useApp();

  const [detail, setDetail] = useState<BookDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadBook = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<BookDetailResponse>(`/api/books/${slug}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    void loadBook();
  }, [loadBook]);

  if (loading) {
    return (
      <div className="max-w-6xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-10">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-10">
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-12 animate-pulse">
            <div className="lg:col-span-5 aspect-[3/4] rounded-xl bg-stone-200 dark:bg-slate-800" />
            <div className="lg:col-span-7 space-y-4">
              <div className="h-4 w-32 bg-stone-200 dark:bg-slate-800 rounded" />
              <div className="h-10 w-3/4 bg-stone-200 dark:bg-slate-800 rounded" />
              <div className="h-24 w-full bg-stone-200 dark:bg-slate-800 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-6xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-10">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-10">
          <div className="mt-6 max-w-md mx-auto text-center p-8 rounded-xl border border-[#E2DEC9] dark:border-slate-800 bg-[#F7F6F0] dark:bg-slate-950/60 space-y-4">
            <p className="text-sm text-[#555555] dark:text-slate-400">{error || 'Book not found'}</p>
            <Link
              to="/"
              className="inline-flex px-4 py-2 text-xs font-semibold rounded-md bg-[#0376B8] text-white hover:bg-[#025E94]"
            >
              {t('backToCatalog')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { book, access, related, reviews, readerState } = detail;
  const catName = localizedCategoryName(
    { nameEn: book.categoryNameEn, nameSo: book.categoryNameSo, nameAr: book.categoryNameAr },
    language
  );

  const handleAddToCart = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    try {
      await addToCart(book.id);
      setActionMsg(t('inCart'));
      void loadBook();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to add to cart');
    }
  };

  const handleBuyNow = () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/checkout?bookId=${book.id}`)}`);
      return;
    }
    navigate(`/checkout?bookId=${encodeURIComponent(book.id)}`);
  };

  const handleClaimFree = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    try {
      await apiFetch(`/api/account/library/claim-free/${book.id}`, { method: 'POST' });
      setActionMsg(t('tabLibrary'));
      void loadBook();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Could not add');
    }
  };

  const handleWishlist = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    await toggleWishlist(book.id);
    void loadBook();
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    setSubmittingReview(true);
    try {
      await apiFetch(`/api/books/${book.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      setComment('');
      void loadBook();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setSubmittingReview(false);
    }
  };

  const effectivePriceCents = book.effectivePriceCents ?? book.priceCents;
  const hasDiscount = !book.isFree && effectivePriceCents < book.priceCents;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: { '@type': 'Person', name: book.author },
    inLanguage: book.language,
    isbn: book.isbn || undefined,
    numberOfPages: book.pageCount || undefined,
    offers: {
      '@type': 'Offer',
      price: (book.isFree ? 0 : effectivePriceCents / 100).toFixed(2),
      priceCurrency: book.currency,
      availability: 'https://schema.org/InStock',
    },
  };

  return (
    <>
      <SeoHead
        title={`${book.title} – ${t('brandName')}`}
        description={book.description.slice(0, 155)}
        jsonLd={jsonLd}
      />

      <div className="max-w-6xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-10">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-10 space-y-8 sm:space-y-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline transition-colors"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            <span>{t('backToCatalog')}</span>
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-start">
            {/* Framed Parchment Cover Stage matching khalidshariflibrary.pages.dev */}
            <div className="lg:col-span-5 rounded-xl bg-[#F7F6F0] dark:bg-slate-800/60 border border-[#E2DEC9] dark:border-slate-800 p-6 sm:p-10 flex items-center justify-center">
              <div className="w-full max-w-[230px] sm:max-w-[300px] aspect-[3/4] rounded-md overflow-hidden shadow-2xl ring-1 ring-black/10 bg-stone-200 dark:bg-slate-900">
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#0376B8] to-[#024A75] text-white">
                    <BookOpen className="w-10 h-10 text-white/80 mb-3" />
                    <span className="font-serif text-xl font-semibold">{book.title}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata & Primary Actions */}
            <div className="lg:col-span-7 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {catName && (
                  <Link
                    to={`/?category=${encodeURIComponent(book.categorySlug || '')}`}
                    className="font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
                  >
                    {catName}
                  </Link>
                )}
                {catName && <span aria-hidden="true">·</span>}
                <span>{book.isFree ? t('freeLabel') : t('paidLabel')}</span>
                <span aria-hidden="true">·</span>
                <span>{book.language.toUpperCase()}</span>
                {book.pageCount && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {book.pageCount} {t('pagesLabel')}
                    </span>
                  </>
                )}
                {book.averageRating && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums text-[#333333] dark:text-slate-200">
                      <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                      {book.averageRating} ({book.reviewCount})
                    </span>
                  </>
                )}
              </div>

              <h1 className="mt-3 font-serif text-3xl sm:text-5xl font-semibold tracking-tight text-[#222222] dark:text-stone-50 text-balance leading-[1.1]">
                {book.title}
              </h1>
              {book.subtitle && (
                <p className="mt-2 text-base sm:text-lg text-[#555555] dark:text-slate-300">{book.subtitle}</p>
              )}
              <p className="mt-3 text-base font-medium text-[#444444] dark:text-slate-300">
                {t('byLabel')} {book.author}
              </p>

              {/* Price & Availability */}
              <div className="mt-5 flex flex-wrap items-baseline gap-3 sm:gap-4">
                <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-[#222222] dark:text-stone-50">
                  {book.isFree ? t('freeLabel') : formatMoney(effectivePriceCents, book.currency, language)}
                </div>
                {hasDiscount && (
                  <>
                    <div className="font-mono tabular-nums text-base sm:text-lg line-through text-[#666666] dark:text-slate-400">
                      {formatMoney(book.priceCents, book.currency, language)}
                    </div>
                    <span className="px-2 py-0.5 rounded-xs bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-mono tabular-nums font-semibold">
                      {book.promotionLabel || t('saleLabel')}
                    </span>
                  </>
                )}
                <div className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                  {t('availabilityLabel')}: {t('availableStatus')}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                {access.canRead ? (
                  <>
                    <Link
                      to={`/reader/${book.id}`}
                      className="inline-flex items-center justify-center gap-2.5 min-h-[44px] px-6 py-3 rounded-md text-sm font-semibold bg-[#0376B8] text-white hover:bg-[#025E94] transition-colors shadow-xs"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>
                        {readerState?.progress
                          ? `${t('continueReading')} (${readerState.progress.progressPercent}%)`
                          : book.isFree
                            ? t('readNow')
                            : t('openInReader')}
                      </span>
                    </Link>
                    {book.isFree && user && !access.hasEntitlement && (
                      <button
                        type="button"
                        onClick={handleClaimFree}
                        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-md border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800 transition-colors"
                      >
                        <BookmarkPlus className="w-4 h-4" />
                        <span>{t('addToLibrary')}</span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleBuyNow}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-3 text-sm font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white transition-colors shadow-xs"
                    >
                      <span>{t('buyNow')}</span>
                    </button>
                    {access.inCart ? (
                      <Link
                        to="/cart"
                        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-md border border-[#0376B8] text-[#0376B8] dark:border-sky-400 dark:text-sky-400"
                      >
                        <Check className="w-4 h-4" />
                        <span>{t('inCart')}</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={handleAddToCart}
                        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-medium rounded-md border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800 transition-colors"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>{t('addToCart')}</span>
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={handleWishlist}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-md border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F7F6F0] dark:hover:bg-slate-800 transition-colors"
                >
                  <Heart className={`w-4 h-4 ${access.inWishlist ? 'fill-red-600 text-red-600' : ''}`} />
                  <span>{access.inWishlist ? t('removeFromWishlist') : t('addToWishlist')}</span>
                </button>
              </div>

              {actionMsg && (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{actionMsg}</p>
              )}

              {/* Synopsis */}
              <div className="mt-8 pt-6 border-t border-[#E5E0CE] dark:border-slate-800">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-slate-400 mb-2.5">
                  {t('synopsisTitle')}
                </h2>
                <p className="text-sm sm:text-base leading-relaxed text-[#444444] dark:text-slate-300">
                  {book.description}
                </p>
              </div>

              {/* Bibliographic Metadata */}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#E5E0CE] dark:border-slate-800 text-sm">
                <div>
                  <dt className="text-xs text-[#666666] dark:text-slate-400">{t('publishedLabel')}</dt>
                  <dd className="font-mono tabular-nums font-medium mt-0.5">{book.publicationYear || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#666666] dark:text-slate-400">{t('pagesLabel')}</dt>
                  <dd className="font-mono tabular-nums font-medium mt-0.5">{book.pageCount || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#666666] dark:text-slate-400">{t('formatLabel')}</dt>
                  <dd className="font-medium mt-0.5">{book.fileFormat}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#666666] dark:text-slate-400">ISBN</dt>
                  <dd className="font-mono tabular-nums text-xs mt-1">{book.isbn || '—'}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Reader Reviews */}
          <section className="border-t border-[#E5E0CE] dark:border-slate-800 pt-8 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10">
            <div className="lg:col-span-5 space-y-4">
              <h2 className="text-lg sm:text-2xl font-normal text-[#333333] dark:text-stone-100">
                {t('reviewsTitle')}
              </h2>
              {user ? (
                <form
                  onSubmit={handleReviewSubmit}
                  className="space-y-3 p-4 sm:p-5 rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#DFDAC6] dark:border-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="rating-select" className="text-sm font-medium">
                      {t('ratingLabel')}
                    </label>
                    <select
                      id="rating-select"
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                      className="px-2.5 py-1.5 text-sm rounded border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n} className="bg-white dark:bg-slate-900">
                          {n} / 5
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    required
                    placeholder={t('reviewPlaceholder')}
                    className="w-full p-3 text-sm rounded border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0376B8]/40"
                  />
                  <button
                    type="submit"
                    disabled={submittingReview}
                    className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-50"
                  >
                    {t('submitReview')}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-[#555555] dark:text-slate-400">
                  <Link to="/login" className="text-[#0376B8] dark:text-sky-400 underline">
                    {t('signInBtn')}
                  </Link>{' '}
                  — {t('writeReview')}
                </p>
              )}
            </div>

            <div className="lg:col-span-7 space-y-4">
              {reviews.length === 0 ? (
                <p className="text-sm text-[#666666] dark:text-slate-400 py-4">—</p>
              ) : (
                reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#DFDAC6] dark:border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-[#666666] dark:text-slate-400">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium text-[#222222] dark:text-stone-100">{rev.reviewerName}</span>
                        {rev.verifiedPurchase && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                              <Check className="w-3.5 h-3.5" />
                              {t('verifiedReaderBadge')}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="font-mono tabular-nums shrink-0">
                        {rev.rating}/5 · {formatLocalizedDate(rev.createdAt, language)}
                      </span>
                    </div>
                    <p className="text-sm text-[#444444] dark:text-slate-300">{rev.comment}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Related Books */}
          {related.length > 0 && (
            <section className="-mx-4 sm:mx-0 rounded-none sm:rounded-xl border-t border-b-0 sm:border border-[#DFDAC6] dark:border-slate-800 bg-[#F7F6F0] dark:bg-slate-950/60 px-4 py-5 sm:p-7 space-y-4 sm:space-y-5">
              <h2 className="text-lg sm:text-2xl font-normal text-[#333333] dark:text-stone-100">
                {t('relatedBooks')}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 sm:gap-6">
                {related.map((rb) => (
                  <BookCard key={rb.id} book={rb} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
};
