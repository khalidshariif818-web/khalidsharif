import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Bookmark,
  ChevronDown,
  Globe,
  Landmark,
  Menu,
  Moon,
  Phone,
  Search,
  ShoppingBag,
  Sun,
  User,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { localizedCategoryName } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import { resolveContactHref } from '../lib/contacts';
import type { Category, ContactChannel, LanguageCode } from '../shared/types';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, language, setLanguage, theme, toggleTheme, cartItems, t } = useApp();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contactChannels, setContactChannels] = useState<ContactChannel[]>([]);
  const [localSearch, setLocalSearch] = useState('');
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = Boolean(user?.roles.includes('admin') || user?.roles.includes('super_admin'));
  const isReaderRoute = location.pathname.startsWith('/reader');
  const isHome = location.pathname === '/';
  const urlQuery = searchParams.get('q') || '';

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;
    setHoldProgress(0);
  }, []);

  const startHold = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearHold();
      const startedAt = Date.now();
      holdStartRef.current = startedAt;
      holdTimerRef.current = window.setInterval(() => {
        if (holdStartRef.current === null) return;
        const elapsed = Date.now() - holdStartRef.current;
        if (elapsed >= 5000) {
          clearHold();
          navigate(isAdmin ? '/admin' : '/admin-login');
          return;
        }
        if (elapsed >= 450) {
          const pct = Math.min(100, Math.round(((elapsed - 450) / (5000 - 450)) * 100));
          setHoldProgress(pct);
        }
      }, 50);
    },
    [clearHold, isAdmin, navigate]
  );

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearInterval(holdTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setLocalSearch(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    let active = true;
    void apiFetch<{ categories: Category[] }>('/api/categories')
      .then((res) => {
        if (active && Array.isArray(res.categories)) {
          setCategories(res.categories);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void apiFetch<{ channels: ContactChannel[] }>('/api/contact-channels')
      .then((res) => {
        if (active && Array.isArray(res.channels)) {
          setContactChannels(res.channels);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  // Close menus on route change
  useEffect(() => {
    setBrowseOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  const handleSearchInput = (value: string) => {
    setLocalSearch(value);
    if (isHome) {
      const next = new URLSearchParams(searchParams);
      if (value.trim()) {
        next.set('q', value);
      } else {
        next.delete('q');
      }
      setSearchParams(next, { replace: true });
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = localSearch.trim();
    if (isHome) {
      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    } else {
      navigate(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/catalog');
    }
  };

  if (isReaderRoute) {
    return (
      <div className="min-h-screen bg-[#E1DCC5] dark:bg-slate-950 text-[#333333] dark:text-slate-100">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-clip bg-[#E1DCC5] dark:bg-slate-950 text-[#333333] dark:text-slate-100 transition-colors duration-200">
      {/* 1. Top Dark Archive Strip (scrolls away cleanly on mobile to keep sticky bar compact) */}
      <div className="bg-[#333333] dark:bg-slate-950 text-stone-100 border-b border-black/20 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-8 sm:h-9 flex items-center justify-between gap-2 text-xs">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 sm:gap-2 min-w-0 font-serif tracking-wider uppercase text-[10px] sm:text-xs text-stone-100 hover:text-white truncate"
          >
            <Landmark className="w-3.5 h-3.5 text-stone-300 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('archiveTopLabel')}</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <span className="hidden lg:inline text-stone-300 text-[11px]">
              {t('freeReadOnlyTag')}
            </span>

            <div className="inline-flex items-center bg-white/15 rounded px-1.5 sm:px-2 py-0.5">
              <label htmlFor="top-lang-select" className="sr-only">
                {t('languageLabel')}
              </label>
              <select
                id="top-lang-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                className="bg-transparent text-[11px] font-medium text-white focus:outline-none cursor-pointer"
              >
                <option value="so" className="bg-slate-900 text-white">
                  {t('langSo')}
                </option>
                <option value="en" className="bg-slate-900 text-white">
                  {t('langEn')}
                </option>
                <option value="ar" className="bg-slate-900 text-white">
                  {t('langAr')}
                </option>
              </select>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('themeLight') : t('themeDark')}
              className="inline-flex items-center gap-1.5 text-[11px] text-stone-200 hover:text-white transition-colors whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden min-[380px]:inline">{t('themeLight')}</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5" />
                  <span className="hidden min-[380px]:inline">{t('themeDark')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-40 shadow-xs">
        {/* 2. Warm Parchment Brand Header */}
        <div className="bg-[#E9E4D3] dark:bg-slate-900 border-b border-[#D5CEB8] dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-5">
            <Link to="/" className="group flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 sm:flex-initial">
              <span className="inline-flex items-center justify-center px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-[#0376B8] text-white text-[10px] sm:text-[11px] font-bold tracking-wide -rotate-3 shadow-xs group-hover:rotate-0 transition-transform shrink-0">
                {t('openBadge')}
              </span>
              <span className="font-serif text-[15px] sm:text-xl lg:text-2xl font-semibold tracking-wide text-[#2C2C2C] dark:text-stone-100 uppercase truncate">
                {t('brandHeader')}
              </span>
            </Link>

            {/* Desktop Inline Search Bar */}
            <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md hidden sm:block">
              <div className="relative">
                <input
                  type="search"
                  value={localSearch}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                  className="w-full ps-3.5 pe-9 py-2 rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-[#333333] dark:text-slate-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#0376B8]/40"
                />
                <Search className="w-4 h-4 text-stone-500 dark:text-slate-400 absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </form>

            {/* Right Controls */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                aria-label={t('searchAction')}
                className={`sm:hidden w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
                  mobileSearchOpen || Boolean(localSearch)
                    ? 'bg-[#0376B8]/10 text-[#0376B8] dark:text-sky-400'
                    : 'text-[#333333] dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <Search className="w-[18px] h-[18px]" />
              </button>

              <a
                href={isHome ? '#stacks' : '/#stacks'}
                className="hidden lg:inline-flex items-center justify-center px-3.5 py-2 rounded-md text-xs font-semibold bg-[#0376B8] hover:bg-[#025E94] text-white transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                {t('exploreCollections')}
              </a>

              <Link
                to="/cart"
                aria-label={t('cartTitle')}
                className="relative w-9 h-9 flex items-center justify-center rounded-md text-[#333333] dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <ShoppingBag className="w-[18px] h-[18px]" />
                {cartItems.length > 0 && (
                  <span className="absolute top-0.5 end-0.5 min-w-4 h-4 px-1 rounded-full bg-[#0376B8] text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                    {cartItems.length}
                  </span>
                )}
              </Link>

              {isAdmin && (
                <Link
                  to="/admin"
                  className="hidden md:inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md border border-[#0376B8] text-[#0376B8] dark:text-sky-400 dark:border-sky-400 hover:bg-[#0376B8]/10 transition-colors whitespace-nowrap shrink-0"
                >
                  {t('navAdmin')}
                </Link>
              )}

              <Link
                to={user ? '/account' : '/login'}
                className="inline-flex items-center justify-center gap-1.5 min-h-[36px] sm:min-h-9 px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                <User className="w-3.5 h-3.5 sm:hidden" />
                <span>{user ? t('navAccount') : t('navSignIn')}</span>
              </Link>

              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-label="Toggle navigation"
                aria-expanded={mobileMenuOpen}
                className="md:hidden w-9 h-9 flex items-center justify-center rounded-md text-[#333333] dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Expandable Search Input */}
          {(mobileSearchOpen || (isHome && Boolean(localSearch))) && (
            <form onSubmit={handleSearchSubmit} className="sm:hidden px-3 pb-2.5">
              <div className="relative">
                <input
                  type="search"
                  value={localSearch}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                  className="w-full ps-3.5 pe-9 py-2 rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-[#333333] dark:text-slate-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#0376B8]/40"
                />
                <Search className="w-4 h-4 text-stone-500 absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </form>
          )}
        </div>

        {/* 3. Split Sub-Navigation Bar (My Library | Browse) */}
        <div className="bg-[#EFEAD8] dark:bg-slate-900/90 border-b border-[#D5CEB8] dark:border-slate-800 text-xs sm:text-sm text-[#444444] dark:text-slate-300 relative z-30">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-9 sm:h-10 grid grid-cols-2 divide-x divide-[#D5CEB8] dark:divide-slate-800">
            <Link
              to="/account/library"
              className={`flex items-center justify-center gap-2 font-medium transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/account/library')
                  ? 'text-[#0376B8] dark:text-sky-400 bg-white/60 dark:bg-slate-800/70'
                  : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
              }`}
            >
              <Bookmark className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('navLibrary')}</span>
            </Link>

            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={() => setBrowseOpen((v) => !v)}
                aria-expanded={browseOpen}
                className="w-full h-full flex items-center justify-center gap-2 font-medium hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors whitespace-nowrap"
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>{t('browseMenu')}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${browseOpen ? 'rotate-180' : ''}`} />
              </button>

              {browseOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden="true"
                    onClick={() => setBrowseOpen(false)}
                  />
                  <div
                    onMouseLeave={() => setBrowseOpen(false)}
                    className="absolute top-full end-2 sm:end-auto mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-[#D5CEB8] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1.5 z-50 text-xs max-h-80 overflow-y-auto"
                  >
                    <Link
                      to="/"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 font-medium text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('featuredTitle')}
                    </Link>
                    {categories.map((cat) => (
                      <Link
                        key={cat.id}
                        to={`/?category=${encodeURIComponent(cat.slug)}`}
                        onClick={() => setBrowseOpen(false)}
                        className="block px-4 py-2 text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800 truncate"
                      >
                        {localizedCategoryName(cat, language)}
                      </Link>
                    ))}
                    <div className="my-1 border-t border-[#E5E0CE] dark:border-slate-800" />
                    <Link
                      to="/catalog"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 font-medium text-[#0376B8] dark:text-sky-400 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('navCatalog')}
                    </Link>
                    <Link
                      to="/categories"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('navCategories')}
                    </Link>
                    <Link
                      to="/account/wishlist"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('tabWishlist')}
                    </Link>
                    <Link
                      to="/account/purchases"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('tabPurchases')}
                    </Link>
                    <Link
                      to="/contact"
                      onClick={() => setBrowseOpen(false)}
                      className="block px-4 py-2 text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      {t('navContact')}
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setBrowseOpen(false)}
                        className="block px-4 py-2 font-semibold text-[#0376B8] dark:text-sky-400 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                      >
                        {t('navAdmin')}
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Hamburger Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-[#D5CEB8] dark:border-slate-800 bg-[#F7F4EA] dark:bg-slate-900 px-4 py-3.5 space-y-1.5 text-sm max-h-[70vh] overflow-y-auto">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1.5 font-medium text-[#333333] dark:text-slate-100"
            >
              {t('featuredTitle')}
            </Link>
            <Link
              to="/catalog"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1.5 font-medium text-[#333333] dark:text-slate-100"
            >
              {t('navCatalog')}
            </Link>
            <Link
              to="/categories"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1.5 font-medium text-[#333333] dark:text-slate-100"
            >
              {t('navCategories')}
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                to={`/?category=${encodeURIComponent(cat.slug)}`}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-1 ps-3 text-xs text-[#555555] dark:text-slate-300"
              >
                {localizedCategoryName(cat, language)}
              </Link>
            ))}
            <div className="pt-2 border-t border-[#D5CEB8] dark:border-slate-800 flex flex-wrap gap-3">
              <Link
                to="/account/wishlist"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xs font-medium text-[#0376B8] dark:text-sky-400"
              >
                {t('tabWishlist')}
              </Link>
              <Link
                to="/cart"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xs font-medium text-[#0376B8] dark:text-sky-400"
              >
                {t('cartTitle')} ({cartItems.length})
              </Link>
              <Link
                to="/contact"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xs font-medium text-[#0376B8] dark:text-sky-400"
              >
                {t('navContact')}
              </Link>
              {isAdmin && (
                <Link
                  to="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-xs font-semibold text-[#0376B8] dark:text-sky-400"
                >
                  {t('navAdmin')}
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 min-w-0">{children}</main>

      {/* Organized Editorial Warm Parchment Footer */}
      <footer className="border-t border-[#D5CEB8] dark:border-slate-800 bg-[#E9E4D3] dark:bg-slate-950 text-[#4B473D] dark:text-slate-400 mt-0 sm:mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-7">
            {/* Brand & Primary Contact Column */}
            <div className="md:col-span-5 space-y-2.5">
              <p className="font-serif text-lg sm:text-xl font-semibold text-[#2C2C2C] dark:text-stone-100">
                {t('brandName')}
              </p>
              <p className="text-xs sm:text-sm text-[#666155] dark:text-slate-400 max-w-md leading-relaxed">
                {t('footerTagline')}
              </p>
              {contactChannels.length > 0 && (() => {
                const primary = contactChannels.find((c) => c.isPrimary) || contactChannels[0];
                const primaryHref = resolveContactHref(primary);
                return (
                  <div className="pt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                    {primaryHref ? (
                      <a
                        href={primaryHref}
                        dir="ltr"
                        className="inline-flex items-center gap-1.5 min-h-[32px] font-mono-tabular font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{primary.value}</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 min-h-[32px] font-medium text-[#2C2C2C] dark:text-stone-200">
                        <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{primary.value}</span>
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Structured 2-Column Footer Links (clean 2-up on mobile as well) */}
            <div className="md:col-span-7 grid grid-cols-2 gap-6 sm:gap-8">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#666155] dark:text-slate-400 mb-3">
                  {t('footerExploreHeading')}
                </h3>
                <ul className="space-y-1 text-xs sm:text-sm">
                  <li>
                    <Link
                      to="/categories"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('exploreCollections')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/catalog"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navCatalog')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/account/library"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navLibrary')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/about"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navAbout')}
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#666155] dark:text-slate-400 mb-3">
                  {t('footerSupportHeading')}
                </h3>
                <ul className="space-y-1 text-xs sm:text-sm">
                  <li>
                    <Link
                      to="/contact"
                      className="inline-flex items-center min-h-[32px] font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
                    >
                      {t('navContact')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/privacy"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navPrivacy')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/terms"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navTerms')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/refund-policy"
                      className="inline-flex items-center min-h-[32px] text-[#333333] dark:text-slate-300 hover:text-[#0376B8] dark:hover:text-sky-400 hover:underline"
                    >
                      {t('navRefund')}
                    </Link>
                  </li>
                  {isAdmin && (
                    <li>
                      <Link
                        to="/admin"
                        className="inline-flex items-center min-h-[32px] font-semibold text-[#0376B8] dark:text-sky-400 hover:underline"
                      >
                        {t('navAdmin')}
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          {/* Separated Bottom Utility Bar */}
          <div className="border-t border-[#D5CEB8] dark:border-slate-800 pt-5 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <span
              onPointerDown={startHold}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onPointerCancel={clearHold}
              onContextMenu={(e) => e.preventDefault()}
              className="relative inline-block self-start sm:self-auto text-[#666155] dark:text-slate-400 whitespace-nowrap select-none touch-manipulation cursor-default py-1"
            >
              © {new Date().getFullYear()} {t('brandName')}
              {holdProgress > 0 && (
                <span
                  aria-hidden="true"
                  className="block absolute bottom-0 start-0 h-[2px] bg-[#0376B8] dark:bg-sky-400 rounded-full transition-[width] duration-75"
                  style={{ width: `${holdProgress}%` }}
                />
              )}
            </span>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white/80 dark:bg-slate-900">
                <Globe className="w-3.5 h-3.5 text-[#555555] dark:text-slate-400 shrink-0" aria-hidden="true" />
                <select
                  aria-label={t('languageLabel')}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                  className="bg-transparent text-xs font-medium text-[#333333] dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="so" className="bg-white dark:bg-slate-900">{t('langSo')}</option>
                  <option value="en" className="bg-white dark:bg-slate-900">{t('langEn')}</option>
                  <option value="ar" className="bg-white dark:bg-slate-900">{t('langAr')}</option>
                </select>
              </div>

              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-md border border-[#C9C1AA] dark:border-slate-700 bg-white/80 dark:bg-slate-900 text-xs font-medium text-[#333333] dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{t('themeLight')}</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('themeDark')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
