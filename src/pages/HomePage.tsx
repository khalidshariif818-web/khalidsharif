import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { BookCard } from '../components/BookCard';
import { SeoHead } from '../components/SeoHead';
import { localizedCategoryName, localizedSectionTitle } from '../i18n/translations';
import type { Book, Category, HomepageSection } from '../shared/types';

interface HomepagePayload {
  sections: HomepageSection[];
  categories: Category[];
  collections: {
    featured: Book[];
    latest: Book[];
    popular: Book[];
    recommended: Book[];
    free: Book[];
    paid: Book[];
  };
}

type SlideIllustrationKind = 'monitor' | 'bookmark' | 'themes';

const SlideIllustration: React.FC<{ kind: SlideIllustrationKind }> = ({ kind }) => {
  if (kind === 'monitor') {
    return (
      <svg
        viewBox="0 0 120 96"
        fill="none"
        className="w-16 h-14 sm:w-28 sm:h-24 shrink-0 text-[#444444] dark:text-slate-300"
        aria-hidden="true"
      >
        <rect x="14" y="18" width="92" height="58" rx="4" stroke="currentColor" strokeWidth="2.5" />
        <path d="M46 76v10M74 76v10M36 86h48" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <rect
          x="28"
          y="8"
          width="38"
          height="28"
          rx="2"
          fill="#FAF9F5"
          stroke="currentColor"
          strokeWidth="2.2"
          className="dark:fill-slate-800"
        />
        <path
          d="M47 8v28M33 15h9M33 21h9M33 27h9M52 15h9M52 21h9M52 27h9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <rect x="76" y="34" width="14" height="22" rx="7" stroke="currentColor" strokeWidth="2.2" />
        <path
          d="M83 34v8M47 36c0 12 18 14 29 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === 'bookmark') {
    return (
      <svg
        viewBox="0 0 120 96"
        fill="none"
        className="w-16 h-14 sm:w-28 sm:h-24 shrink-0 text-[#444444] dark:text-slate-300"
        aria-hidden="true"
      >
        <rect x="22" y="14" width="54" height="68" rx="3" stroke="currentColor" strokeWidth="2.5" />
        <path d="M32 28h34M32 39h34M32 50h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M78 14h20v64l-10-8-10 8V14z"
          fill="#E8F3FB"
          stroke="#0376B8"
          strokeWidth="2.4"
          className="dark:fill-sky-950"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      className="w-16 h-14 sm:w-28 sm:h-24 shrink-0 text-[#444444] dark:text-slate-300"
      aria-hidden="true"
    >
      <rect
        x="18"
        y="18"
        width="44"
        height="60"
        rx="3"
        fill="#FAF9F5"
        stroke="currentColor"
        strokeWidth="2.4"
        className="dark:fill-slate-800"
      />
      <rect
        x="58"
        y="18"
        width="44"
        height="60"
        rx="3"
        fill="#F2E9D8"
        stroke="currentColor"
        strokeWidth="2.4"
        className="dark:fill-slate-900"
      />
      <path
        d="M27 32h26M27 42h26M27 52h18M67 32h26M67 42h26M67 52h18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="92" cy="64" r="10" fill="#0376B8" />
      <path d="M88 64l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const FannedBookStack: React.FC<{ books: Book[]; label: string }> = ({ books, label }) => {
  const sample = books.slice(0, 3);
  const leftBook = sample[1];
  const centerBook = sample[0];
  const rightBook = sample[2];

  const renderSlot = (book: Book | undefined, fallbackGradient: string, transformClass: string) =>
    book && book.coverUrl ? (
      <div
        className={`w-12 h-16 sm:w-14 sm:h-20 rounded-xs overflow-hidden shadow-md ring-1 ring-black/15 bg-white dark:bg-slate-800 ${transformClass}`}
      >
        <img
          src={book.coverUrl}
          alt={book.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </div>
    ) : (
      <div
        className={`w-12 h-16 sm:w-14 sm:h-20 rounded-xs shadow-sm ring-1 ring-black/10 flex flex-col justify-between p-1.5 ${fallbackGradient} ${transformClass}`}
      >
        <div className="h-1 w-6 rounded-full bg-white/40" />
        <div className="text-[7px] font-serif leading-tight text-white/85 line-clamp-2 text-start">
          {book?.title || label}
        </div>
      </div>
    );

  return (
    <div className="relative h-20 sm:h-24 flex items-center justify-center pt-1">
      {renderSlot(leftBook, 'bg-gradient-to-br from-slate-700 to-slate-900', 'transform -rotate-12 -me-4 translate-y-1')}
      {renderSlot(centerBook, 'bg-gradient-to-br from-[#0376B8] to-[#024A75]', 'relative z-10 scale-105 shadow-lg')}
      {renderSlot(rightBook, 'bg-gradient-to-br from-amber-800 to-stone-900', 'transform rotate-12 -ms-4 translate-y-1')}
    </div>
  );
};

export const HomePage: React.FC = () => {
  const { language, t } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogRef = useRef<HTMLElement>(null);

  const selectedCategory = searchParams.get('category') || 'all';
  const searchQuery = searchParams.get('q') || '';

  const [data, setData] = useState<HomepagePayload | null>(null);
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [sortMode, setSortMode] = useState<'popular' | 'newest' | 'alpha' | 'price_asc'>('popular');
  const [expandedShelf, setExpandedShelf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLibrary = async () => {
    setLoading(true);
    setError(null);
    try {
      const [homeRes, booksRes] = await Promise.all([
        apiFetch<HomepagePayload>('/api/homepage'),
        apiFetch<{ items: Book[] }>('/api/books?pageSize=100'),
      ]);
      setData(homeRes);
      setAllBooks(booksRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  const categories = data?.categories ?? [];

  const booksByCategorySlug = useMemo(() => {
    const map = new Map<string, Book[]>();
    for (const book of allBooks) {
      const slug = (book.categorySlug || 'general').toLowerCase();
      const list = map.get(slug) || [];
      list.push(book);
      map.set(slug, list);
    }
    return map;
  }, [allBooks]);

  const sortBooks = useMemo(
    () => (list: Book[], mode: typeof sortMode) =>
      [...list].sort((a, b) => {
        if (mode === 'popular') return (b.popularityScore || 0) - (a.popularityScore || 0);
        if (mode === 'alpha') return a.title.localeCompare(b.title);
        if (mode === 'price_asc') return a.priceCents - b.priceCents;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    []
  );

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = allBooks.filter((book) => {
      const matchesCat =
        selectedCategory === 'all' ||
        (book.categorySlug || '').toLowerCase() === selectedCategory.toLowerCase();
      const catLabel = localizedCategoryName(
        { nameEn: book.categoryNameEn, nameSo: book.categoryNameSo, nameAr: book.categoryNameAr },
        language
      ).toLowerCase();
      const matchesQ =
        !q ||
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        catLabel.includes(q);
      return matchesCat && matchesQ;
    });
    return sortBooks(list, sortMode);
  }, [allBooks, selectedCategory, searchQuery, sortMode, sortBooks, language]);

  const latestBooks = useMemo(() => sortBooks(filteredBooks, 'newest'), [filteredBooks, sortBooks]);
  const popularBooks = useMemo(() => sortBooks(filteredBooks, 'popular'), [filteredBooks, sortBooks]);
  const featuredBooks = useMemo(() => filteredBooks.filter((b) => b.isFeatured), [filteredBooks]);
  const recommendedBooks = useMemo(() => filteredBooks.filter((b) => b.isRecommended), [filteredBooks]);
  const freeBooks = useMemo(() => filteredBooks.filter((b) => b.isFree), [filteredBooks]);
  const paidBooks = useMemo(() => filteredBooks.filter((b) => !b.isFree), [filteredBooks]);

  const dynamicShelves = useMemo(() => {
    const resolveItems = (sectionKey: string): Book[] => {
      switch (sectionKey) {
        case 'featured':
          return featuredBooks;
        case 'latest':
          return latestBooks;
        case 'popular':
          return popularBooks;
        case 'recommended':
          return recommendedBooks;
        case 'free':
          return freeBooks;
        case 'paid':
          return paidBooks;
        default:
          return [];
      }
    };

    if (data?.sections && data.sections.length > 0) {
      return [...data.sections]
        .filter((s) => s.isEnabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((section) => ({
          key: section.sectionKey,
          title: localizedSectionTitle(section, language),
          items: resolveItems(section.sectionKey),
        }))
        .filter((entry) => entry.items.length > 0);
    }

    return [
      { key: 'latest', title: t('recentlyAdded'), items: latestBooks },
      { key: 'free', title: t('freeSectionTitle'), items: freeBooks },
      { key: 'paid', title: t('paidSectionTitle'), items: paidBooks },
    ].filter((entry) => entry.items.length > 0);
  }, [data?.sections, language, featuredBooks, latestBooks, popularBooks, recommendedBooks, freeBooks, paidBooks, t]);

  const visibleDynamicShelves = useMemo(() => {
    return dynamicShelves.filter((shelf) => {
      if (sortMode === 'popular' && shelf.key === 'popular') return false;
      if (sortMode === 'newest' && shelf.key === 'latest') return false;
      return true;
    });
  }, [dynamicShelves, sortMode]);

  const categoryShelves = useMemo(() => {
    if (selectedCategory !== 'all' || searchQuery.trim()) return [];
    return categories
      .map((cat) => ({
        category: cat,
        items: sortBooks(booksByCategorySlug.get(cat.slug.toLowerCase()) || [], sortMode),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [selectedCategory, searchQuery, categories, booksByCategorySlug, sortBooks, sortMode]);

  const handleSelectCategory = (slug: string, shouldScroll = false) => {
    setExpandedShelf(null);
    const next = new URLSearchParams(searchParams);
    if (slug === 'all') {
      next.delete('category');
    } else {
      next.set('category', slug);
    }
    setSearchParams(next);
    if (shouldScroll && catalogRef.current) {
      catalogRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const clearSearch = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    setSearchParams(next);
  };

  const activeCategoryObj = categories.find(
    (c) => c.slug.toLowerCase() === selectedCategory.toLowerCase()
  );
  const collectionHeading =
    selectedCategory === 'all'
      ? t('featuredCollectionName')
      : localizedCategoryName(activeCategoryObj, language) || t('featuredCollectionName');

  const isExpandedMode = Boolean(searchQuery.trim() || expandedShelf);

  const expandedItems = useMemo(() => {
    if (!expandedShelf) return filteredBooks;
    if (expandedShelf === 'primary') return filteredBooks;
    const dynamicMatch = dynamicShelves.find((s) => s.key === expandedShelf);
    if (dynamicMatch) return dynamicMatch.items;
    if (expandedShelf === 'latest') return latestBooks;
    if (expandedShelf === 'free') return freeBooks;
    if (expandedShelf === 'paid') return paidBooks;
    const found = categoryShelves.find((s) => s.category.slug === expandedShelf);
    return found ? found.items : filteredBooks;
  }, [expandedShelf, filteredBooks, dynamicShelves, latestBooks, freeBooks, paidBooks, categoryShelves]);

  const expandedHeading = useMemo(() => {
    if (searchQuery.trim()) return `${t('searchResultsTitle')}: "${searchQuery.trim()}"`;
    const dynamicMatch = dynamicShelves.find((s) => s.key === expandedShelf);
    if (dynamicMatch) return dynamicMatch.title;
    if (expandedShelf === 'latest') return t('recentlyAdded');
    if (expandedShelf === 'free') return t('freeSectionTitle');
    if (expandedShelf === 'paid') return t('paidSectionTitle');
    if (expandedShelf && expandedShelf !== 'primary') {
      const cat = categories.find((c) => c.slug === expandedShelf);
      return `${t('allInCollection')} ${localizedCategoryName(cat, language) || collectionHeading}`;
    }
    return `${t('allInCollection')} ${collectionHeading}`;
  }, [searchQuery, expandedShelf, dynamicShelves, categories, language, collectionHeading, t]);

  const slides: {
    title: string;
    desc: string;
    to: string;
    illustration: SlideIllustrationKind;
  }[] = [
    {
      title: t('slide1Title'),
      desc: t('slide1Desc'),
      to: '/catalog?price=free',
      illustration: 'monitor',
    },
    {
      title: t('slide2Title'),
      desc: t('slide2Desc'),
      to: '/categories',
      illustration: 'themes',
    },
    {
      title: t('slide3Title'),
      desc: t('slide3Desc'),
      to: '/account/library',
      illustration: 'bookmark',
    },
  ];
  const activeSlide = slides[slideIdx];

  return (
    <>
      <SeoHead title={`${t('brandName')} – ${t('welcomeHeadline')}`} description={t('heroSubtitle')} />

      <div className="max-w-7xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 sm:px-8 py-5 sm:py-8">
          {/* Welcome Headline & Feature Carousel */}
          <section aria-label={t('welcomeHeadline')}>
            <h1 className="text-xl sm:text-3xl font-normal tracking-tight text-[#333333] dark:text-stone-100">
              {t('welcomeHeadline')}
            </h1>

            <div className="mt-3 sm:mt-5 relative flex items-center justify-center gap-2 sm:gap-4">
              <button
                type="button"
                aria-label="Previous slide"
                onClick={() => setSlideIdx((i) => (i - 1 + slides.length) % slides.length)}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#B9D9EE] hover:bg-[#0376B8] text-white flex items-center justify-center transition-colors shrink-0 shadow-xs"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
              </button>

              <Link
                to={activeSlide.to}
                className="flex-1 min-w-0 max-w-2xl rounded-lg border border-[#E3DFCE] dark:border-slate-700 bg-[#FCFBF7] dark:bg-slate-950/60 px-3 sm:px-8 py-3 sm:py-5 flex flex-row items-center gap-3 sm:gap-6 shadow-2xs hover:border-[#6EAEE0] dark:hover:border-sky-500/60 transition-colors"
              >
                <SlideIllustration kind={activeSlide.illustration} />
                <div className="text-start min-w-0 flex-1">
                  <h2 className="font-sans text-sm sm:text-xl font-medium text-[#333333] dark:text-stone-100 leading-snug">
                    {activeSlide.title}
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-[#555555] dark:text-slate-300 leading-snug line-clamp-2 sm:line-clamp-none">
                    {activeSlide.desc}
                  </p>
                </div>
              </Link>

              <button
                type="button"
                aria-label="Next slide"
                onClick={() => setSlideIdx((i) => (i + 1) % slides.length)}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#0376B8] hover:bg-[#025E94] text-white flex items-center justify-center transition-colors shrink-0 shadow-xs"
              >
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
              </button>
            </div>
          </section>

          {/* Explore Collections ("#stacks") with Fanned 3-Book Covers */}
          <section id="stacks" className="mt-5 sm:mt-9 scroll-mt-36">
            <div className="flex items-center justify-between gap-4 mb-3 sm:mb-4">
              <h2 className="font-sans text-lg sm:text-2xl font-normal text-[#333333] dark:text-stone-100">
                {t('exploreCollections')}
              </h2>
              {searchQuery.trim() ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex items-center gap-1 text-xs text-[#0376B8] dark:text-sky-400 hover:underline"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t('clearFilters')}</span>
                </button>
              ) : (
                <Link
                  to="/categories"
                  className="text-xs sm:text-sm font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
                >
                  {t('seeAllShort')}
                </Link>
              )}
            </div>

            {loading ? (
              <div className="flex items-stretch gap-3 overflow-hidden pb-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="w-[130px] sm:w-36 h-36 sm:h-40 shrink-0 rounded-lg bg-stone-200/70 dark:bg-slate-800 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex items-stretch gap-2.5 sm:gap-3 overflow-x-auto no-scrollbar pb-1 snap-x snap-mandatory scroll-px-4 sm:scroll-px-1">
                <button
                  type="button"
                  onClick={() => handleSelectCategory('all', true)}
                  className={`group w-[130px] sm:w-36 shrink-0 snap-start rounded-lg border-2 p-2.5 sm:p-3 text-center transition-all ${
                    selectedCategory === 'all'
                      ? 'border-[#6EAEE0] bg-[#EEF6FC] dark:border-sky-500 dark:bg-sky-950/30 shadow-xs'
                      : 'border-[#E2DEC9] bg-white hover:border-[#B6C9DA] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  <FannedBookStack books={allBooks} label={t('featuredCollectionName')} />
                  <p className="mt-2.5 text-sm font-medium text-[#333333] dark:text-stone-100 truncate">
                    {t('featuredCollectionName')}
                  </p>
                  <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[#666666] dark:text-slate-400">
                    {allBooks.length} {allBooks.length === 1 ? t('itemSingular') : t('booksCountLabel')}
                  </p>
                </button>

                {categories.map((cat) => {
                  const isSelected = selectedCategory.toLowerCase() === cat.slug.toLowerCase();
                  const catBooks = booksByCategorySlug.get(cat.slug.toLowerCase()) || [];
                  const label = localizedCategoryName(cat, language);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleSelectCategory(cat.slug, true)}
                      className={`group w-[130px] sm:w-36 shrink-0 snap-start rounded-lg border-2 p-2.5 sm:p-3 text-center transition-all ${
                        isSelected
                          ? 'border-[#6EAEE0] bg-[#EEF6FC] dark:border-sky-500 dark:bg-sky-950/30 shadow-xs'
                          : 'border-[#E2DEC9] bg-white hover:border-[#B6C9DA] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                      }`}
                    >
                      <FannedBookStack books={catBooks} label={label} />
                      <p className="mt-2.5 text-sm font-medium text-[#333333] dark:text-stone-100 truncate">
                        {label}
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[#666666] dark:text-slate-400">
                        {catBooks.length} {catBooks.length === 1 ? t('itemSingular') : t('booksCountLabel')}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Expanded Catalog Box ("#catalog") */}
          <section
            id="catalog"
            ref={catalogRef}
            className="scroll-mt-24 sm:scroll-mt-32 relative mt-5 sm:mt-6 -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-t border-b-0 sm:border border-[#DFDAC6] dark:border-slate-800 bg-[#F7F6F0] dark:bg-slate-950/60 px-4 py-5 sm:p-7"
          >
            <div
              aria-hidden="true"
              className="hidden sm:block absolute -top-2 start-14 w-4 h-4 rotate-45 border-s border-t border-[#DFDAC6] dark:border-slate-800 bg-[#F7F6F0] dark:bg-slate-950"
            />

            <div className="pb-4 sm:pb-5 border-b border-[#E5E0CE] dark:border-slate-800">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-sans text-xl sm:text-3xl font-normal text-[#333333] dark:text-stone-50 truncate min-w-0">
                  {collectionHeading}
                </h2>

                <div className="relative shrink-0">
                  <select
                    aria-label="Sort collection"
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                    className="appearance-none ps-3 sm:ps-3.5 pe-8 sm:pe-9 py-1.5 min-h-[36px] rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm font-medium text-[#333333] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0376B8]/40 cursor-pointer"
                  >
                    <option value="popular">{t('sortPopular')}</option>
                    <option value="newest">{t('sortNewest')}</option>
                    <option value="alpha">{t('titleAZ')}</option>
                    <option value="price_asc">{t('sortPriceAsc')}</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#555555] dark:text-slate-400 pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {!isExpandedMode && filteredBooks.length > 0 && (
                <div className="mt-3 flex items-center gap-x-3 gap-y-1.5 overflow-x-auto no-scrollbar whitespace-nowrap sm:flex-wrap text-xs sm:text-sm pb-0.5">
                  <span className="text-[#666666] dark:text-slate-400 shrink-0">{t('jumpTo')}:</span>
                  <a
                    href="#shelf-primary"
                    className="text-[#0376B8] dark:text-sky-400 font-medium hover:underline underline-offset-4 shrink-0"
                  >
                    {sortMode === 'popular'
                      ? t('sortPopular')
                      : sortMode === 'newest'
                        ? t('sortNewest')
                        : sortMode === 'alpha'
                          ? t('titleAZ')
                          : t('sortPriceAsc')}
                  </a>
                  {visibleDynamicShelves.map((shelf) => (
                    <a
                      key={shelf.key}
                      href={`#shelf-${shelf.key}`}
                      className="text-[#0376B8] dark:text-sky-400 hover:underline underline-offset-4 shrink-0"
                    >
                      {shelf.title}
                    </a>
                  ))}
                  {selectedCategory === 'all' && categoryShelves.length > 0 && (
                    <a
                      href="#browse-subjects"
                      className="text-[#0376B8] dark:text-sky-400 hover:underline underline-offset-4 shrink-0"
                    >
                      {t('categoriesTitle')}
                    </a>
                  )}
                </div>
              )}
            </div>

            {loading ? (
              <div className="mt-6 flex gap-4 overflow-hidden">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className="w-40 shrink-0 animate-pulse">
                    <div className="aspect-[2/3] rounded bg-stone-200 dark:bg-slate-800" />
                    <div className="mt-2.5 h-4 w-3/4 bg-stone-200 dark:bg-slate-800 rounded" />
                    <div className="mt-1.5 h-3 w-1/2 bg-stone-200 dark:bg-slate-800 rounded" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="py-12 text-center space-y-3">
                <p className="font-serif text-xl font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadLibrary()}
                  className="px-4 py-2 rounded-md text-xs font-semibold bg-[#0376B8] text-white hover:bg-[#025E94]"
                >
                  {t('retry')}
                </button>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="mt-6 py-14 text-center max-w-md mx-auto rounded-lg border border-[#E2DEC9] dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
                {searchQuery.trim() ? (
                  <>
                    <Search className="w-8 h-8 mx-auto text-stone-400" />
                    <h3 className="mt-3 font-sans text-lg font-medium">{t('noResults')}</h3>
                    <button
                      type="button"
                      onClick={() => {
                        clearSearch();
                        handleSelectCategory('all');
                      }}
                      className="mt-4 px-4 py-2 rounded-md text-xs font-semibold bg-[#0376B8] text-white hover:bg-[#025E94]"
                    >
                      {t('clearFilters')}
                    </button>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-8 h-8 mx-auto text-stone-400" />
                    <h3 className="mt-3 font-sans text-lg font-medium">{t('noResults')}</h3>
                    <button
                      type="button"
                      onClick={() => handleSelectCategory('all')}
                      className="mt-4 px-4 py-2 rounded-md text-xs font-semibold bg-[#0376B8] text-white hover:bg-[#025E94]"
                    >
                      {t('featuredCollectionName')}
                    </button>
                  </>
                )}
              </div>
            ) : isExpandedMode ? (
              <div className="mt-5 sm:mt-6">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="font-sans text-base sm:text-lg font-medium text-[#333333] dark:text-stone-100">
                    {expandedHeading}
                  </h3>
                  {expandedShelf && (
                    <button
                      type="button"
                      onClick={() => setExpandedShelf(null)}
                      className="text-xs sm:text-sm font-medium text-[#0376B8] dark:text-sky-400 hover:underline whitespace-nowrap"
                    >
                      {t('backToShelves')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-6">
                  {expandedItems.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 sm:mt-6 space-y-7 sm:space-y-8">
                {/* Primary Sorted Shelf */}
                <div id="shelf-primary" className="scroll-mt-28">
                  <div className="flex items-center justify-between gap-4 mb-3.5 sm:mb-4">
                    <h3 className="font-sans text-base sm:text-lg font-medium text-[#333333] dark:text-stone-100">
                      {sortMode === 'popular'
                        ? t('popularTitle')
                        : sortMode === 'newest'
                          ? t('latestTitle')
                          : sortMode === 'alpha'
                            ? t('titleAZ')
                            : t('sortPriceAsc')}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setExpandedShelf('primary')}
                      className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-medium text-[#0376B8] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      <span>{t('seeAllShort')}</span>
                      <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                    </button>
                  </div>
                  <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3.5 sm:gap-5 overflow-x-auto no-scrollbar pb-1 snap-x snap-mandatory scroll-px-4 sm:scroll-px-1">
                    {filteredBooks.slice(0, 12).map((book) => (
                      <BookCard key={book.id} book={book} compact />
                    ))}
                  </div>
                </div>

                {/* Dynamic Curated Shelves driven by homepage_sections (deduped against primary shelf) */}
                {visibleDynamicShelves.map((shelf) => (
                  <div
                    key={shelf.key}
                    id={`shelf-${shelf.key}`}
                    className="scroll-mt-28 pt-6 sm:pt-7 border-t border-[#E5E0CE] dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between gap-4 mb-3.5 sm:mb-4">
                      <h3 className="font-sans text-base sm:text-lg font-medium text-[#333333] dark:text-stone-100">
                        {shelf.title}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setExpandedShelf(shelf.key)}
                        className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-medium text-[#0376B8] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        <span>{t('seeAllShort')}</span>
                        <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                      </button>
                    </div>
                    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3.5 sm:gap-5 overflow-x-auto no-scrollbar pb-1 snap-x snap-mandatory scroll-px-4 sm:scroll-px-1">
                      {shelf.items.slice(0, 12).map((book) => (
                        <BookCard key={`${shelf.key}-${book.id}`} book={book} compact />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Clean Subject Directory Grid replacing repetitive bottom carousels */}
                {categoryShelves.length > 0 && (
                  <div
                    id="browse-subjects"
                    className="scroll-mt-28 pt-6 sm:pt-7 border-t border-[#E5E0CE] dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between gap-4 mb-3.5 sm:mb-4">
                      <h3 className="font-sans text-base sm:text-lg font-medium text-[#333333] dark:text-stone-100">
                        {t('categoriesTitle')}
                      </h3>
                      <Link
                        to="/categories"
                        className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-medium text-[#0376B8] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        <span>{t('seeAllShort')}</span>
                        <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3.5">
                      {categoryShelves.map(({ category, items }) => {
                        const catLabel = localizedCategoryName(category, language);
                        const thumbUrl = category.imageUrl || items[0]?.coverUrl;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => handleSelectCategory(category.slug, true)}
                            className="group flex items-center justify-between gap-3 rounded-lg border border-[#E2DEC9] dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:border-[#6EAEE0] dark:hover:border-sky-500 transition-colors text-start min-h-[68px]"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-14 rounded-xs overflow-hidden bg-stone-200 dark:bg-slate-800 ring-1 ring-black/10 shrink-0 flex items-center justify-center">
                                {thumbUrl ? (
                                  <img
                                    src={thumbUrl}
                                    alt={catLabel}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <BookOpen className="w-4 h-4 text-stone-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-[#222222] dark:text-stone-100 group-hover:text-[#0376B8] dark:group-hover:text-sky-400 transition-colors truncate">
                                  {catLabel}
                                </div>
                                <div className="text-xs font-mono tabular-nums text-[#666666] dark:text-slate-400 mt-0.5">
                                  {items.length} {items.length === 1 ? t('itemSingular') : t('booksCountLabel')}
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#666666] dark:text-slate-400 group-hover:text-[#0376B8] dark:group-hover:text-sky-400 shrink-0 rtl:rotate-180" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
};
