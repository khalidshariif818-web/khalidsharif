import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { BookCard } from '../components/BookCard';
import { SeoHead } from '../components/SeoHead';
import { localizedCategoryName } from '../i18n/translations';
import type { Book, Category } from '../shared/types';

export const CategoriesPage: React.FC = () => {
  const { language, t } = useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [booksByCategory, setBooksByCategory] = useState<Record<string, Book[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [catRes, booksRes] = await Promise.all([
          apiFetch<{ categories: Category[] }>('/api/categories'),
          apiFetch<{ items: Book[] }>('/api/books?pageSize=50'),
        ]);
        setCategories(catRes.categories);
        const grouped: Record<string, Book[]> = {};
        for (const b of booksRes.items) {
          if (!grouped[b.categoryId]) grouped[b.categoryId] = [];
          grouped[b.categoryId].push(b);
        }
        setBooksByCategory(grouped);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <>
      <SeoHead title={`${t('navCategories')} – ${t('brandName')}`} description={t('categoriesSubtitle')} />
      <div className="max-w-7xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-8 space-y-5 sm:space-y-7">
          <div className="border-b border-[#E5E0CE] dark:border-slate-800 pb-4 sm:pb-5 space-y-2">
            <p className="text-xs font-medium text-[#0376B8] dark:text-sky-400">
              {t('editorialCollection')}
            </p>
            <h1 className="font-serif text-2xl sm:text-4xl font-semibold text-[#222222] dark:text-stone-50 text-balance">
              {t('categoriesTitle')}
            </h1>
            <p className="text-sm sm:text-base text-[#555555] dark:text-slate-400 max-w-2xl">
              {t('categoriesSubtitle')}
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 sm:h-56 rounded-xl bg-stone-200/70 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
            {categories.map((cat, idx) => {
              const name = localizedCategoryName(cat, language);
              const desc =
                language === 'so'
                  ? cat.descriptionSo
                  : language === 'ar'
                    ? cat.descriptionAr
                    : cat.descriptionEn;
              const sampleBooks = (booksByCategory[cat.id] || []).slice(0, 3);

              return (
                <div
                  key={cat.id}
                  className="rounded-xl bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#DFDAC6] dark:border-slate-800 overflow-hidden flex flex-col justify-between min-w-0"
                >
                  <div className="p-4 sm:p-7 flex flex-row gap-4 sm:gap-6 items-start">
                    <Link
                      to={`/categories/${cat.slug}`}
                      className="w-20 sm:w-32 aspect-[2/3] rounded-xs overflow-hidden shadow-md ring-1 ring-black/10 bg-stone-200 dark:bg-slate-800 shrink-0 block"
                    >
                      {cat.imageUrl ? (
                        <img
                          src={cat.imageUrl}
                          alt={name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="w-7 h-7 text-stone-400" />
                        </div>
                      )}
                    </Link>

                    <div className="flex-1 min-w-0 space-y-2 sm:space-y-3">
                      <div className="flex items-center justify-between text-xs text-[#666666] dark:text-slate-400 font-mono tabular-nums">
                        <span>0{idx + 1}</span>
                        <span>
                          {cat.bookCount ?? 0} {t('booksCountLabel')}
                        </span>
                      </div>
                      <Link to={`/categories/${cat.slug}`} className="block group">
                        <h2 className="font-serif text-xl sm:text-3xl font-semibold text-[#222222] dark:text-stone-100 group-hover:text-[#0376B8] dark:group-hover:text-sky-400 transition-colors leading-snug">
                          {name}
                        </h2>
                      </Link>
                      <p className="text-xs sm:text-sm text-[#555555] dark:text-slate-400 leading-relaxed line-clamp-3">
                        {desc}
                      </p>
                      <Link
                        to={`/categories/${cat.slug}`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline underline-offset-4 pt-0.5"
                      >
                        <span>{t('exploreCategory')}</span>
                        <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                      </Link>
                    </div>
                  </div>

                  {/* Preview Titles inside this Category */}
                  {sampleBooks.length > 0 && (
                    <div className="px-4 sm:px-7 py-3 sm:py-4 border-t border-[#E5E0CE] dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                      {sampleBooks.map((b) => (
                        <Link
                          key={b.id}
                          to={`/books/${b.slug}`}
                          className="flex items-center justify-between gap-3 py-1 text-xs hover:text-[#0376B8] dark:hover:text-sky-400 transition-colors min-w-0"
                        >
                          <span className="font-medium text-[#333333] dark:text-slate-200 truncate">
                            {b.title}
                          </span>
                          <span className="text-[#666666] dark:text-slate-400 shrink-0 truncate max-w-[110px] sm:max-w-[140px]">
                            {b.author}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export const CategoryDetailPage: React.FC = () => {
  const { slug } = useParams();
  const { language, t } = useApp();
  const [category, setCategory] = useState<Category | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [priceFilter, setPriceFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void apiFetch<{ category: Category; books: Book[] }>(`/api/categories/${slug}`)
      .then((res) => {
        setCategory(res.category);
        setBooks(res.books);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('errorLoading')))
      .finally(() => setLoading(false));
  }, [slug, t]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="h-56 rounded-lg bg-slate-200/60 dark:bg-slate-800/50 animate-pulse" />
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-slate-600 dark:text-slate-400">{error || 'Category not found'}</p>
        <Link to="/categories" className="text-[#0376B8] dark:text-sky-400 underline">
          {t('navCategories')}
        </Link>
      </div>
    );
  }

  const name = localizedCategoryName(category, language);
  const desc = language === 'so' ? category.descriptionSo : language === 'ar' ? category.descriptionAr : category.descriptionEn;
  const filteredBooks = books.filter((b) =>
    priceFilter === 'free' ? b.isFree : priceFilter === 'paid' ? !b.isFree : true
  );

  return (
    <>
      <SeoHead
        title={category.seoTitle || `${name} – ${t('brandName')}`}
        description={category.seoDescription || desc}
      />

      <div className="max-w-7xl w-full mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        <div className="rounded-none sm:rounded-xl bg-white dark:bg-slate-900 border-y sm:border border-[#D4CEB8] dark:border-slate-800 shadow-none sm:shadow-xs px-4 py-5 sm:p-8 space-y-5 sm:space-y-7">
          {/* Editorial Category Banner */}
          <div className="border-b border-[#E5E0CE] dark:border-slate-800 pb-5 sm:pb-6 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center">
            {category.imageUrl && (
              <div className="w-24 sm:w-36 aspect-[2/3] rounded-xs overflow-hidden shadow-md ring-1 ring-black/10 shrink-0">
                <img
                  src={category.imageUrl}
                  alt={name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2.5 sm:space-y-3 w-full">
              <Link to="/categories" className="text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline">
                {t('navCategories')}
              </Link>
              <h1 className="font-serif text-2xl sm:text-4xl font-semibold text-[#222222] dark:text-stone-50 text-balance">
                {name}
              </h1>
              <p className="text-sm sm:text-base text-[#555555] dark:text-slate-300 max-w-2xl leading-relaxed">{desc}</p>
              <div className="pt-1 sm:pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
                <div className="grid grid-cols-3 sm:inline-flex items-center p-1 rounded-md bg-[#F7F6F0] dark:bg-slate-950 border border-[#DFDAC6] dark:border-slate-800 w-full sm:w-auto">
                  {(['all', 'free', 'paid'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPriceFilter(mode)}
                      className={`min-h-[36px] px-2 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded transition-colors text-center truncate ${
                        priceFilter === mode
                          ? 'bg-[#0376B8] text-white shadow-xs'
                          : 'text-[#444444] dark:text-slate-300 hover:text-[#222222] dark:hover:text-white'
                      }`}
                    >
                      {mode === 'all' ? t('filterAll') : mode === 'free' ? t('filterFree') : t('filterPaid')}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-mono tabular-nums text-[#666666] dark:text-slate-400">
                  {filteredBooks.length} {t('booksCountLabel')}
                </span>
              </div>
            </div>
          </div>

          {filteredBooks.length === 0 ? (
            <p className="text-sm text-[#666666] dark:text-slate-400 py-8 text-center">{t('noResults')}</p>
          ) : (
            <div className="-mx-4 sm:mx-0 rounded-none sm:rounded-xl border-t border-b-0 sm:border border-[#DFDAC6] dark:border-slate-800 bg-[#F7F6F0] dark:bg-slate-950/60 px-4 py-5 sm:p-7">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-6">
                {filteredBooks.map((b) => (
                  <BookCard key={b.id} book={b} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
