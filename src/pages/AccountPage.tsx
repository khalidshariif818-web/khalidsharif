import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Bell, Check, Download, Heart, History, LogOut, Receipt, Settings, Trash2 } from 'lucide-react';
import { apiFetch, downloadAuthenticatedFile, setAuthToken } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { SeoHead } from '../components/SeoHead';
import { formatLocalizedDate, formatMoney } from '../shared/commerce';
import type {
  Book,
  Entitlement,
  LanguageCode,
  NotificationItem,
  Order,
  OrderStatus,
  ReadingProgress,
  ThemeMode,
} from '../shared/types';

function formatAccountOrderStatus(status: OrderStatus, t: (k: string) => string): string {
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

type AccountTab = 'library' | 'history' | 'wishlist' | 'purchases' | 'notifications' | 'settings';

export const AccountPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const activeTab: AccountTab =
    tab === 'history' || tab === 'wishlist' || tab === 'purchases' || tab === 'notifications' || tab === 'settings'
      ? tab
      : 'library';

  const { user, authLoading, language, theme, setLanguage, setTheme, logout, refreshSession, toggleWishlist, addToCart, t } =
    useApp();
  const navigate = useNavigate();

  const [libraryItems, setLibraryItems] = useState<Array<{ book: Book; entitlement: Entitlement; progress: ReadingProgress | null }>>([]);
  const [historyItems, setHistoryItems] = useState<Array<{ book: Book; progress: ReadingProgress | null; lastOpenedAt: string }>>([]);
  const [wishlistItems, setWishlistItems] = useState<Book[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState('');
  const [prefLang, setPrefLang] = useState<LanguageCode>(language);
  const [prefTheme, setPrefTheme] = useState<ThemeMode>(theme);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPrefLang(user.preferredLanguage);
      setPrefTheme(user.preferredTheme);
      setEmailNotifs(user.emailNotifications);
    }
  }, [user]);

  const loadAccountData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [lib, hist, wish, ord, notif] = await Promise.all([
        apiFetch<{ items: typeof libraryItems }>('/api/account/library'),
        apiFetch<{ items: typeof historyItems }>('/api/account/history'),
        apiFetch<{ items: Book[] }>('/api/account/wishlist'),
        apiFetch<{ orders: Order[] }>('/api/account/orders'),
        apiFetch<{ items: NotificationItem[] }>('/api/account/notifications'),
      ]);
      setLibraryItems(lib.items);
      setHistoryItems(hist.items);
      setWishlistItems(wish.items);
      setOrders(ord.orders);
      setNotifications(notif.items);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadAccountData();
  }, [loadAccountData]);

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-2.5 sm:px-6 py-3 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-xl px-4 sm:px-8 py-12 text-sm text-slate-500">
          {t('loading')}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(`/account/${activeTab}`)}`} replace />;
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    await apiFetch('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName,
        preferredLanguage: prefLang,
        preferredTheme: prefTheme,
        emailNotifications: emailNotifs,
      }),
    });
    setLanguage(prefLang);
    setTheme(prefTheme);
    await refreshSession();
    setSaveMsg(t('savedMsg'));
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setPwError(null);
    setChangingPw(true);
    try {
      const res = await apiFetch<{ ok: boolean; sessionToken?: string }>('/api/account/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.sessionToken) {
        setAuthToken(res.sessionToken);
      }
      setCurrentPassword('');
      setNewPassword('');
      setPwMsg(t('passwordUpdatedMsg'));
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Unable to update password');
    } finally {
      setChangingPw(false);
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    await apiFetch(`/api/account/notifications/${id}/read`, { method: 'POST' });
    void loadAccountData();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const tabs: Array<{ key: AccountTab; label: string; icon: React.ReactNode }> = [
    { key: 'library', label: t('tabLibrary'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'history', label: t('tabHistory'), icon: <History className="w-4 h-4" /> },
    { key: 'wishlist', label: t('tabWishlist'), icon: <Heart className="w-4 h-4" /> },
    { key: 'purchases', label: t('tabPurchases'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'notifications', label: t('tabNotifications'), icon: <Bell className="w-4 h-4" /> },
    { key: 'settings', label: t('tabSettings'), icon: <Settings className="w-4 h-4" /> },
  ];

  const isAdmin = Boolean(user.roles.includes('admin') || user.roles.includes('super_admin'));

  return (
    <>
      <SeoHead title={`${t('accountTitle')} – ${t('brandName')}`} description={t('accountTitle')} noIndex />
      <div className="max-w-6xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border-y sm:border border-[#D8D1BE] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-sm px-4 py-5 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4 border-b border-[#E5E0CE] dark:border-slate-800 pb-5 mb-5 sm:pb-6 sm:mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-3xl font-semibold text-slate-900 dark:text-stone-50 break-words">
              {user.fullName || user.email}
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 break-all">{user.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && (
              <Link
                to="/admin"
                className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-xs font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
              >
                <span>{t('openAdminPanel')}</span>
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-xs font-medium rounded-md border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F3F0E6] dark:hover:bg-slate-800 w-fit"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('logoutBtn')}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8">
          {/* Sidebar Navigation (Horizontally scrollable on mobile) */}
          <aside className="lg:col-span-3 flex overflow-x-auto no-scrollbar gap-1.5 pb-1 lg:block lg:space-y-1 lg:pb-0">
            {tabs.map((item) => (
              <Link
                key={item.key}
                to={`/account/${item.key}`}
                className={`flex items-center gap-2 sm:gap-2.5 min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === item.key
                    ? 'bg-[#0376B8] text-white'
                    : 'text-slate-700 dark:text-slate-300 bg-[#FAF8F2] lg:bg-transparent dark:bg-slate-950/60 lg:dark:bg-transparent hover:bg-[#F3F0E6] dark:hover:bg-slate-800/70'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </aside>

          {/* Content Panel */}
          <div className="lg:col-span-9 min-w-0">
            {loading ? (
              <div className="h-48 rounded-md bg-slate-200/60 dark:bg-slate-800/50 animate-pulse" />
            ) : activeTab === 'library' ? (
              <div className="space-y-4">
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabLibrary')}</h2>
                {libraryItems.length === 0 ? (
                  <div className="p-5 sm:p-8 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 space-y-4">
                    <p>{t('emptyLibrary')}</p>
                    <Link to="/catalog" className="inline-flex items-center justify-center min-h-[40px] px-4 py-2 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950">
                      {t('navCatalog')}
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {libraryItems.map(({ book, entitlement, progress }) => (
                      <div
                        key={book.id}
                        className="p-3.5 sm:p-4 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 flex gap-3 sm:gap-4"
                      >
                        {book.coverUrl && (
                          <img
                            src={book.coverUrl}
                            alt={book.title}
                            referrerPolicy="no-referrer"
                            className="w-16 h-24 sm:w-20 sm:h-28 object-cover rounded border border-[#D4CEB8] dark:border-slate-700 shrink-0 shadow-xs"
                          />
                        )}
                        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                              {entitlement.sourceType === 'purchase' ? t('orderPaidUnlocked') : t('freeLabel')}
                            </div>
                            <h3 className="font-display text-base sm:text-lg font-semibold leading-snug line-clamp-2">{book.title}</h3>
                            <p className="text-xs text-slate-500 truncate">{book.author}</p>
                          </div>
                          {progress && (
                            <div className="space-y-1">
                              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full bg-[#0376B8] dark:bg-sky-400"
                                  style={{ width: `${progress.progressPercent}%` }}
                                />
                              </div>
                              <div className="text-[11px] font-mono-tabular text-slate-500">
                                {progress.progressPercent}% · {t('readerPage')} {progress.currentPage}/{progress.totalPages}
                              </div>
                            </div>
                          )}
                          <Link
                            to={`/reader/${book.id}`}
                            className="inline-flex items-center justify-center min-h-[38px] px-3 py-1.5 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950 w-full sm:w-fit"
                          >
                            {progress ? t('continueReading') : t('openInReader')}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === 'history' ? (
              <div className="space-y-4">
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabHistory')}</h2>
                {historyItems.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('emptyHistory')}</p>
                ) : (
                  <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800 bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 rounded-md">
                    {historyItems.map(({ book, progress, lastOpenedAt }) => (
                      <div key={book.id} className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-display text-base sm:text-lg font-semibold leading-snug">{book.title}</h3>
                          <p className="text-xs text-slate-500">
                            {book.author} · {formatLocalizedDate(lastOpenedAt, language)}
                            {progress ? ` · ${progress.progressPercent}%` : ''}
                          </p>
                        </div>
                        <Link
                          to={`/reader/${book.id}`}
                          className="inline-flex items-center justify-center min-h-[38px] px-3.5 py-2 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950 whitespace-nowrap w-full sm:w-auto"
                        >
                          {t('continueReading')}
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === 'wishlist' ? (
              <div className="space-y-4">
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabWishlist')}</h2>
                {wishlistItems.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('emptyWishlist')}</p>
                ) : (
                  <div className="space-y-3">
                    {wishlistItems.map((book) => (
                      <div
                        key={book.id}
                        className="p-3.5 sm:p-4 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                      >
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          {book.coverUrl && (
                            <img src={book.coverUrl} alt={book.title} className="w-12 h-16 object-cover rounded border border-[#D4CEB8] dark:border-slate-700 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <Link to={`/books/${book.slug}`} className="font-display text-base sm:text-lg font-semibold hover:text-[#0376B8] hover:underline block truncate">
                              {book.title}
                            </Link>
                            <p className="text-xs text-slate-500 truncate">
                              {book.author} ·{' '}
                              {book.isFree ? (
                                t('freeLabel')
                              ) : (book.effectivePriceCents ?? book.priceCents) < book.priceCents ? (
                                <>
                                  <span className="line-through me-1.5">
                                    {formatMoney(book.priceCents, book.currency, language)}
                                  </span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                                    {formatMoney(book.effectivePriceCents ?? book.priceCents, book.currency, language)}
                                  </span>
                                </>
                              ) : (
                                formatMoney(book.priceCents, book.currency, language)
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 shrink-0">
                          {!book.isFree && (
                            <button
                              type="button"
                              onClick={async () => {
                                await addToCart(book.id);
                                navigate('/cart');
                              }}
                              className="min-h-[38px] px-3 py-1.5 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950"
                            >
                              {t('addToCart')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await toggleWishlist(book.id);
                              void loadAccountData();
                            }}
                            aria-label={t('removeFromWishlist')}
                            className="w-9 h-9 flex items-center justify-center rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === 'purchases' ? (
              <div className="space-y-4">
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabPurchases')}</h2>
                {orders.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('emptyOrders')}</p>
                ) : (
                  <div className="space-y-4">
                    {orders.map((order) => (
                      <div
                        key={order.id}
                        className="p-3.5 sm:p-5 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-3">
                          <div className="min-w-0">
                            <div className="font-mono-tabular text-sm font-semibold break-all">{order.orderReference}</div>
                            <div className="text-xs text-slate-500">{formatLocalizedDate(order.createdAt, language)}</div>
                          </div>
                          <div className="text-end shrink-0">
                            <div className="font-mono-tabular font-semibold">
                              {formatMoney(order.totalCents, order.currency, language)}
                            </div>
                            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              {formatAccountOrderStatus(order.status, t)}
                            </div>
                          </div>
                        </div>
                        <ul className="text-sm space-y-1.5">
                          {order.items.map((item) => (
                            <li key={item.id} className="flex justify-between gap-3">
                              <span className="min-w-0 break-words">{item.bookTitleSnapshot}</span>
                              <span className="font-mono-tabular text-slate-500 shrink-0">
                                {formatMoney(item.unitPriceCents, order.currency, language)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {order.payment && (
                          <div className="text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-2">
                            <span className="font-mono-tabular break-all">{t('referenceShortLabel')}: {order.payment.transactionReference}</span>
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  void downloadAuthenticatedFile(
                                    `/api/orders/${order.id}/receipt`,
                                    `receipt-${order.orderReference}.pdf`
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[#0376B8] dark:text-sky-400 hover:underline font-medium"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>{t('downloadReceipt')}</span>
                              </button>
                              <Link
                                to={`/checkout/result?order=${encodeURIComponent(order.orderReference)}`}
                                className="text-[#0376B8] dark:text-sky-400 underline"
                              >
                                {order.status === 'paid' ? t('tabLibrary') : t('awaitingAdminVerification')}
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === 'notifications' ? (
              <div className="space-y-4">
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabNotifications')}</h2>
                {notifications.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('emptyNotifications')}</p>
                ) : (
                  <div className="space-y-3">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 sm:p-4 rounded-md border ${
                          n.isRead
                            ? 'bg-[#F3F0E6] dark:bg-slate-950/60 border-[#E5E0CE] dark:border-slate-800'
                            : 'bg-[#EFF6FC] dark:bg-sky-950/30 border-[#7BB3DF] dark:border-sky-500/40'
                        } flex items-start justify-between gap-3 sm:gap-4`}
                      >
                        <div className="space-y-1 min-w-0">
                          <h3 className="text-sm font-semibold">{n.title}</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
                          <p className="text-xs text-slate-400">{formatLocalizedDate(n.createdAt, language)}</p>
                        </div>
                        {!n.isRead && (
                          <button
                            type="button"
                            onClick={() => void handleMarkNotificationRead(n.id)}
                            className="w-9 h-9 flex items-center justify-center shrink-0 rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            aria-label="Mark as read"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <form
                onSubmit={handleSaveSettings}
                className="p-4 sm:p-6 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-5 max-w-xl"
              >
                <h2 className="text-lg sm:text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('tabSettings')}</h2>
                <div className="space-y-1.5">
                  <label htmlFor="set-name" className="block text-sm font-medium">
                    {t('fullNameLabel')}
                  </label>
                  <input
                    id="set-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="set-lang" className="block text-sm font-medium">
                      {t('languageLabel')}
                    </label>
                    <select
                      id="set-lang"
                      value={prefLang}
                      onChange={(e) => setPrefLang(e.target.value as LanguageCode)}
                      className="w-full min-h-[42px] px-3 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="so">{t('langSo')}</option>
                      <option value="en">{t('langEn')}</option>
                      <option value="ar">{t('langAr')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="set-theme" className="block text-sm font-medium">
                      {t('themeLabel')}
                    </label>
                    <select
                      id="set-theme"
                      value={prefTheme}
                      onChange={(e) => setPrefTheme(e.target.value as ThemeMode)}
                      className="w-full min-h-[42px] px-3 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="light">{t('themeLight')}</option>
                      <option value="dark">{t('themeDark')}</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emailNotifs}
                    onChange={(e) => setEmailNotifs(e.target.checked)}
                    className="rounded border-slate-300 mt-0.5 w-4 h-4"
                  />
                  <span>{t('emailNotifsLabel')}</span>
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="submit"
                    className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950"
                  >
                    {t('saveChanges')}
                  </button>
                  {saveMsg && <span className="text-sm text-emerald-700 dark:text-emerald-400">{saveMsg}</span>}
                </div>
              </form>
            )}

            {!loading && activeTab === 'settings' && (
              <form
                onSubmit={handleChangePassword}
                className="mt-6 p-4 sm:p-6 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-4 max-w-xl"
              >
                <h3 className="text-base sm:text-xl font-semibold text-[#02598B] dark:text-sky-400">
                  {t('changePasswordTitle')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="pw-current" className="block text-sm font-medium">
                      {t('currentPasswordLabel')}
                    </label>
                    <input
                      id="pw-current"
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="pw-new" className="block text-sm font-medium">
                      {t('newPasswordLabel')}
                    </label>
                    <input
                      id="pw-new"
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                {pwError && <p className="text-xs text-red-600 dark:text-red-400">{pwError}</p>}
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="submit"
                    disabled={changingPw}
                    className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950 disabled:opacity-50"
                  >
                    {changingPw ? t('loading') : t('updatePasswordBtn')}
                  </button>
                  {pwMsg && <span className="text-sm text-emerald-700 dark:text-emerald-400">{pwMsg}</span>}
                </div>
              </form>
            )}
          </div>
        </div>
        </div>
      </div>
    </>
  );
};
