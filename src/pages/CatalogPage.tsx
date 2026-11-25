import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { BookCard } from '../components/BookCard';
import { SeoHead } from '../components/SeoHead';
import { localizedCategoryName } from '../i18n/translations';
import type { Book, Category } from '../shared/types';

export const CatalogPage: React.FC = () => {
  const { language, t } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const [q, setQ] = useState(searchParams.get('q') || '');
  const category = searchParams.get('category') || 'all';
  const price = (searchParams.get('price') || 'all') as 'all' | 'free' | 'paid';
  const bookLang = searchParams.get('lang') || 'all';
  const sort = searchParams.get('sort') || 'newest';
  const page = Number(searchParams.get('page') || 1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 12;

  useEffect(() => {
    void apiFetch<{ categories: Category[] }>('/api/categories')
      .then((res) => setCategories(res.categories))
      .catch(() => {});
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        q: searchParams.get('q') || '',
        category,
        price,
        lang: bookLang,
        sort,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await apiFetch<{ items: Book[]; total: number }>(`/api/books?${qs.toString()}`);
      setBooks(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [searchParams, category, price, bookLang, sort, page, t]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateParam('q', q.trim());
  };

  const resetAll = () => {
    setQ('');
    setSearchParams({});
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <SeoHead
        title={`${t('catalogTitle')} – ${t('brandName')}`}
        description={t('catalogSubtitle')}
      />

      <div className="max-w-7xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-8 space-y-5 sm:space-y-7">
        <div className="space-y-1.5 sm:space-y-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-4 sm:pb-5">
          <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#222222] dark:text-stone-50">
            {t('catalogTitle')}
          </h1>
          <p className="text-sm sm:text-base text-[#555555] dark:text-slate-400">
            {t('catalogSubtitle')}
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="space-y-3.5 sm:space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <form onSubmit={handleSearchSubmit} className="lg:col-span-5 flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-stone-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full min-h-[42px] ps-9 pe-3 py-2 text-sm rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-[#333333] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0376B8]/40"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] px-4 py-2 text-sm font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white whitespace-nowrap shrink-0 transition-colors"
              >
                {t('searchAction')}
              </button>
            </form>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select
                aria-label={t('filterCategory')}
                value={category}
                onChange={(e) => updateParam('category', e.target.value)}
                className="col-span-2 sm:col-span-1 w-full min-w-0 min-h-[42px] px-3 py-2 text-sm rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-[#333333] dark:text-slate-100"
              >
                <option value="all">{t('filterCategory')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {localizedCategoryName(c, language)}
                  </option>
                ))}
              </select>

              <select
                aria-label={t('filterLanguage')}
                value={bookLang}
                onChange={(e) => updateParam('lang', e.target.value)}
                className="w-full min-w-0 min-h-[42px] px-3 py-2 text-sm rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-[#333333] dark:text-slate-100"
              >
                <option value="all">{t('filterLanguage')}</option>
                <option value="so">{t('langSo')}</option>
                <option value="en">{t('langEn')}</option>
                <option value="ar">{t('langAr')}</option>
              </select>

              <select
                aria-label="Sort books"
                value={sort}
                onChange={(e) => updateParam('sort', e.target.value)}
                className="w-full min-w-0 min-h-[42px] px-3 py-2 text-sm rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-[#333333] dark:text-slate-100"
              >
                <option value="newest">{t('sortNewest')}</option>
                <option value="popular">{t('sortPopular')}</option>
                <option value="price_asc">{t('sortPriceAsc')}</option>
                <option value="price_desc">{t('sortPriceDesc')}</option>
                <option value="alpha">{t('sortAlpha')}</option>
              </select>
            </div>
          </div>

          {/* Segmented Free/Paid Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
            <div className="grid grid-cols-3 sm:inline-flex items-center p-1 rounded-md bg-[#F7F6F0] dark:bg-slate-950 border border-[#DFDAC6] dark:border-slate-800 w-full sm:w-auto">
              {(['all', 'free', 'paid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateParam('price', mode)}
                  className={`min-h-[36px] px-2 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded transition-colors text-center truncate ${
                    price === mode
                      ? 'bg-[#0376B8] text-white shadow-xs'
                      : 'text-[#444444] dark:text-slate-300 hover:text-[#222222] dark:hover:text-white'
                  }`}
                >
                  {mode === 'all' ? t('filterAll') : mode === 'free' ? t('filterFree') : t('filterPaid')}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono tabular-nums text-[#666666] dark:text-slate-400">
              {total} {t('navCatalog')}
            </span>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <div key={n} className="h-64 sm:h-72 rounded-md bg-stone-200/70 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="py-12 text-center space-y-3 border border-[#DFDAC6] dark:border-slate-800 rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              className="px-4 py-2 text-sm rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
            >
              {t('retry')}
            </button>
          </div>
        ) : books.length === 0 ? (
          <div className="py-16 text-center space-y-4 border border-[#DFDAC6] dark:border-slate-800 rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60">
            <p className="text-sm text-[#555555] dark:text-slate-400">{t('noResults')}</p>
            <button
              type="button"
              onClick={resetAll}
              className="px-4 py-2 text-sm font-medium rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-50 dark:hover:bg-slate-800"
            >
              {t('clearFilters')}
            </button>
          </div>
        ) : (
          <div className="-mx-4 sm:mx-0 bg-[#F7F6F0] dark:bg-slate-950/60 border-t border-b-0 sm:border border-[#DFDAC6] dark:border-slate-800 rounded-none sm:rounded-xl px-4 py-5 sm:p-7 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-6">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => updateParam('page', String(p))}
                    className={`min-w-10 min-h-10 text-sm font-mono tabular-nums rounded-md border ${
                      p === page
                        ? 'bg-[#0376B8] text-white border-[#0376B8]'
                        : 'border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </>
  );
};
