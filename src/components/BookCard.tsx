import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Bookmark } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { formatMoney } from '../shared/commerce';
import type { Book } from '../shared/types';

export const BookCard: React.FC<{ book: Book; compact?: boolean }> = ({ book, compact = false }) => {
  const { user, language, wishlistIds, toggleWishlist, t } = useApp();
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const inWishlist = wishlistIds.has(book.id);

  const handleBookmarkClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/books/${book.slug}`)}`);
      return;
    }
    await toggleWishlist(book.id);
  };

  const effectiveCents = book.effectivePriceCents ?? book.priceCents;
  const hasDiscount = !book.isFree && effectiveCents < book.priceCents;

  const priceOrActionLabel = book.isFree
    ? t('readNowShort')
    : `${t('buyShort')} · ${formatMoney(effectiveCents, book.currency, language)}`;

  return (
    <article
      className={`group flex flex-col justify-between min-w-0 ${
        compact ? 'w-[144px] sm:w-44 shrink-0 snap-start' : 'w-full'
      }`}
    >
      <div>
        {/* Unboxed Book Cover with subtle shadow & ring matching khalidshariflibrary.pages.dev */}
        <div className="relative aspect-[2/3] rounded-xs overflow-hidden bg-stone-200 dark:bg-slate-800 shadow-md ring-1 ring-black/10">
          <Link to={`/books/${book.slug}`} className="block w-full h-full">
            {book.coverUrl && !imgError ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-[#0376B8] to-[#024A75] text-white">
                <BookOpen className="w-6 h-6 text-white/80 mb-2" />
                <span className="font-serif text-xs sm:text-sm font-semibold line-clamp-3 leading-snug">
                  {book.title}
                </span>
              </div>
            )}
          </Link>

          {hasDiscount && (
            <span className="absolute top-2 start-2 px-1.5 py-0.5 rounded-xs bg-slate-900/85 text-white text-[10px] font-mono tabular-nums font-semibold tracking-tight">
              {book.promotionLabel || t('saleLabel')}
            </span>
          )}

          <button
            type="button"
            onClick={handleBookmarkClick}
            aria-label={inWishlist ? t('removeFromWishlist') : t('addToWishlist')}
            title={inWishlist ? t('removeFromWishlist') : t('addToWishlist')}
            className="absolute top-2 end-2 w-8 h-8 rounded-full bg-white/95 dark:bg-slate-900/90 shadow-md flex items-center justify-center text-[#333333] dark:text-slate-200 hover:scale-105 transition-transform"
          >
            <Bookmark
              className={`w-4 h-4 ${
                inWishlist ? 'fill-[#0376B8] text-[#0376B8] dark:fill-sky-400 dark:text-sky-400' : ''
              }`}
            />
          </button>
        </div>

        {/* Clean Unboxed Title & Author */}
        <Link to={`/books/${book.slug}`} className="block mt-2.5">
          <h4 className="font-sans text-sm sm:text-base font-medium leading-snug text-[#222222] dark:text-stone-50 group-hover:text-[#0376B8] dark:group-hover:text-sky-400 transition-colors line-clamp-1">
            {book.title}
          </h4>
        </Link>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-[#666666] dark:text-slate-400">
          <p className="line-clamp-1 min-w-0">{book.author}</p>
          {hasDiscount && (
            <span className="font-mono tabular-nums line-through text-[11px] shrink-0">
              {formatMoney(book.priceCents, book.currency, language)}
            </span>
          )}
        </div>
      </div>

      {/* Full-Width #0376B8 CTA Button */}
      <div className="mt-2.5">
        <Link
          to={book.isFree ? `/reader/${book.id}` : `/books/${book.slug}`}
          className="inline-flex w-full min-h-[40px] sm:min-h-[38px] items-center justify-center px-3 py-2 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium bg-[#0376B8] hover:bg-[#025E94] text-white transition-colors whitespace-nowrap"
        >
          <span className="truncate">{priceOrActionLabel}</span>
        </Link>
      </div>
    </article>
  );
};
