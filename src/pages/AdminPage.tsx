import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookCheck,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  Layers,
  Lock,
  MessageSquareText,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  Receipt,
  ScrollText,
  ShieldBan,
  ShieldCheck,
  Tag,
  Trash2,
  Unlock,
  Upload,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, downloadAuthenticatedFile } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { contactTypeTranslationKey } from '../lib/contacts';
import { SeoHead } from '../components/SeoHead';
import { formatLocalizedDate, formatMoney } from '../shared/commerce';
import type {
  AccountStatus,
  AdminActivityLog,
  AdminCustomerDetails,
  AdminCustomerListItem,
  AdminReviewItem,
  Book,
  BookStatus,
  Category,
  ContactChannel,
  ContactChannelType,
  DiscountCodeEntry,
  GatewayMode,
  HomepageSection,
  LanguageCode,
  Order,
  PaymentProviderConfig,
  Promotion,
  PromotionDiscountType,
  PromotionScope,
} from '../shared/types';

type AdminTab =
  | 'overview'
  | 'books'
  | 'categories'
  | 'orders'
  | 'customers'
  | 'reviews'
  | 'payments'
  | 'promotions'
  | 'contacts'
  | 'sections'
  | 'reports'
  | 'logs';

const CONTACT_TYPES: ContactChannelType[] = [
  'phone',
  'whatsapp',
  'email',
  'address',
  'telegram',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'website',
  'hours',
  'other',
];

interface OverviewPayload {
  metrics: {
    totalBooks: number;
    publishedBooks: number;
    draftBooks: number;
    registeredCustomers: number;
    totalOrders: number;
    paidOrders: number;
    pendingPayments: number;
    failedPayments: number;
    verifiedRevenueCents: number;
  };
  recentOrders: Order[];
  recentLogs: AdminActivityLog[];
  reports: {
    popularBooks: Array<{ bookId: string; title: string; author: string; salesCount: number; revenueCents: number }>;
    dailyRevenue: Array<{ day: string; orderCount: number; revenueCents: number }>;
  };
}

export const AdminPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const activeTab: AdminTab =
    tab === 'books' ||
    tab === 'categories' ||
    tab === 'orders' ||
    tab === 'customers' ||
    tab === 'reviews' ||
    tab === 'payments' ||
    tab === 'promotions' ||
    tab === 'contacts' ||
    tab === 'sections' ||
    tab === 'reports' ||
    tab === 'logs'
      ? tab
      : 'overview';

  const { user, authLoading, language, t } = useApp();
  const isAdmin = Boolean(user?.roles.includes('admin') || user?.roles.includes('super_admin'));
  const isSuperAdmin = Boolean(user?.roles.includes('super_admin'));

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<AdminCustomerListItem[]>([]);
  const [reviews, setReviews] = useState<AdminReviewItem[]>([]);
  const [providers, setProviders] = useState<PaymentProviderConfig[]>([]);
  const [discountCodes, setDiscountCodes] = useState<DiscountCodeEntry[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [contactChannels, setContactChannels] = useState<ContactChannel[]>([]);
  const [sections, setSections] = useState<HomepageSection[]>([]);
  const [logs, setLogs] = useState<AdminActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savingContacts, setSavingContacts] = useState(false);
  const [savingDiscounts, setSavingDiscounts] = useState(false);
  const [customerActionId, setCustomerActionId] = useState<string | null>(null);

  // Full User Management state
  const [customerStatusFilter, setCustomerStatusFilter] = useState<'all' | AccountStatus>('all');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserLang, setNewUserLang] = useState<LanguageCode>('so');
  const [newUserStatus, setNewUserStatus] = useState<AccountStatus>('active');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [newUserGrantMode, setNewUserGrantMode] = useState<'none' | 'selected' | 'all'>('none');
  const [newUserBookIds, setNewUserBookIds] = useState<string[]>([]);
  const [creatingUser, setCreatingUser] = useState(false);

  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<AdminCustomerDetails | null>(null);
  const [loadingCustomerDetails, setLoadingCustomerDetails] = useState(false);
  const [editCustName, setEditCustName] = useState('');
  const [editCustLang, setEditCustLang] = useState<LanguageCode>('so');
  const [editCustStatus, setEditCustStatus] = useState<AccountStatus>('active');
  const [editCustPassword, setEditCustPassword] = useState('');
  const [savingCustEdit, setSavingCustEdit] = useState(false);
  const [grantPickBookIds, setGrantPickBookIds] = useState<string[]>([]);
  const [grantBusy, setGrantBusy] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  const bookFormRef = React.useRef<HTMLFormElement | null>(null);

  // Payment instructions edit buffer
  const [editingProviderCode, setEditingProviderCode] = useState<string | null>(null);
  const [pInstSo, setPInstSo] = useState('');
  const [pInstEn, setPInstEn] = useState('');
  const [pInstAr, setPInstAr] = useState('');
  const [newManualMethodName, setNewManualMethodName] = useState('');
  const [newManualAccountNumber, setNewManualAccountNumber] = useState('');
  const [pAccountNumber, setPAccountNumber] = useState('');
  const [savingManualMethod, setSavingManualMethod] = useState(false);

  // Live Payment Gateway credentials form buffer (for client turnkey setup)
  const [gwMode, setGwMode] = useState<GatewayMode>('mpgs_hosted');
  const [gwUrl, setGwUrl] = useState('');
  const [gwMerchantId, setGwMerchantId] = useState('');
  const [gwApiVersion, setGwApiVersion] = useState('73');
  const [gwApiKey, setGwApiKey] = useState('');
  const [gwWebhookSecret, setGwWebhookSecret] = useState('');
  const [showGwSecrets, setShowGwSecrets] = useState(false);
  const [savingGw, setSavingGw] = useState(false);
  const [testingGw, setTestingGw] = useState(false);
  const [expandedGatewayProviderCode, setExpandedGatewayProviderCode] = useState<string | null>(null);
  const [gwTestResult, setGwTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Filters & Pagination
  const [booksSearch, setBooksSearch] = useState('');
  const [booksPage, setBooksPage] = useState(1);
  const [booksTotal, setBooksTotal] = useState(0);
  const [orderFilter, setOrderFilter] = useState('all');
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customersPage, setCustomersPage] = useState(1);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Book editor state
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookFormOpen, setBookFormOpen] = useState(false);
  const [bookPdfFile, setBookPdfFile] = useState<File | null>(null);
  const [bTitle, setBTitle] = useState('');
  const [bSubtitle, setBSubtitle] = useState('');
  const [bSlug, setBSlug] = useState('');
  const [bAuthor, setBAuthor] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [bCategoryId, setBCategoryId] = useState('');
  const [bLang, setBLang] = useState<LanguageCode>('en');
  const [bYear, setBYear] = useState('2026');
  const [bPublisher, setBPublisher] = useState('Khalid Sharif Press');
  const [bIsbn, setBIsbn] = useState('');
  const [bPageCount, setBPageCount] = useState('');
  const [bIsFree, setBIsFree] = useState(false);
  const [bPriceDollars, setBPriceDollars] = useState('15.00');
  const [bSalePriceDollars, setBSalePriceDollars] = useState('');
  const [bStatus, setBStatus] = useState<BookStatus>('published');
  const [bFeatured, setBFeatured] = useState(false);
  const [bRecommended, setBRecommended] = useState(false);
  const [bWatermarkEnabled, setBWatermarkEnabled] = useState(true);
  const [bCoverUrl, setBCoverUrl] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const [coverUploadStatus, setCoverUploadStatus] = useState<string | null>(null);

  // Category editor state
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [cSlug, setCSlug] = useState('');
  const [cNameEn, setCNameEn] = useState('');
  const [cNameSo, setCNameSo] = useState('');
  const [cNameAr, setCNameAr] = useState('');
  const [cDescEn, setCDescEn] = useState('');
  const [cDescSo, setCDescSo] = useState('');
  const [cDescAr, setCDescAr] = useState('');
  const [cSortOrder, setCSortOrder] = useState('1');
  const [cPublished, setCPublished] = useState(true);

  // Promotions editor state
  const [promoFormOpen, setPromoFormOpen] = useState(false);
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [prName, setPrName] = useState('');
  const [prScope, setPrScope] = useState<PromotionScope>('library');
  const [prTargetId, setPrTargetId] = useState('');
  const [prDiscountType, setPrDiscountType] = useState<PromotionDiscountType>('percent');
  const [prDiscountValue, setPrDiscountValue] = useState('15');
  const [prStartsAt, setPrStartsAt] = useState('');
  const [prEndsAt, setPrEndsAt] = useState('');
  const [prIsActive, setPrIsActive] = useState(true);

  const loadTabData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const qs = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : '';
      const [ov, bk, ct] = await Promise.all([
        apiFetch<OverviewPayload>(`/api/admin/overview${qs}`),
        apiFetch<{ items: Book[]; total: number }>(
          `/api/admin/books?q=${encodeURIComponent(booksSearch)}&page=${booksPage}&pageSize=25`
        ),
        apiFetch<{ categories: Category[] }>('/api/admin/categories'),
      ]);
      setOverview(ov);
      setBooks(bk.items);
      setBooksTotal(bk.total ?? bk.items.length);
      setCategories(ct.categories);
      if (!bCategoryId && ct.categories[0]) {
        setBCategoryId(ct.categories[0].id);
      }

      if (activeTab === 'orders') {
        const res = await apiFetch<{ orders: Order[]; total?: number }>(
          `/api/admin/orders?status=${orderFilter}&q=${encodeURIComponent(ordersSearch)}&page=${ordersPage}&pageSize=20`
        );
        setOrders(res.orders);
        setOrdersTotal(res.total ?? res.orders.length);
      } else if (activeTab === 'customers') {
        const res = await apiFetch<{ customers: AdminCustomerListItem[]; total?: number }>(
          `/api/admin/customers?q=${encodeURIComponent(customerSearch)}&status=${customerStatusFilter}&page=${customersPage}&pageSize=20`
        );
        setCustomers(res.customers);
        setCustomersTotal(res.total ?? res.customers.length);
      } else if (activeTab === 'reviews') {
        const res = await apiFetch<{ reviews: AdminReviewItem[] }>('/api/admin/reviews');
        setReviews(res.reviews);
      } else if (activeTab === 'payments') {
        const [provRes, discRes] = await Promise.all([
          apiFetch<{ providers: PaymentProviderConfig[] }>('/api/admin/payment-providers'),
          apiFetch<{ codes: DiscountCodeEntry[] }>('/api/admin/discount-codes'),
        ]);
        setProviders(provRes.providers);
        setDiscountCodes(discRes.codes);
        const onlineGw = provRes.providers.find((p) => p.providerType === 'online_gateway');
        if (onlineGw?.credentials) {
          setGwMode(onlineGw.credentials.gatewayMode || 'mpgs_hosted');
          setGwUrl(onlineGw.credentials.gatewayUrl || '');
          setGwMerchantId(onlineGw.credentials.merchantId || '');
          setGwApiVersion(onlineGw.credentials.apiVersion || '73');
        }
      } else if (activeTab === 'promotions') {
        const res = await apiFetch<{ promotions: Promotion[] }>('/api/admin/promotions');
        setPromotions(res.promotions);
      } else if (activeTab === 'contacts') {
        const res = await apiFetch<{ channels: ContactChannel[] }>('/api/admin/contacts');
        setContactChannels(res.channels);
      } else if (activeTab === 'sections') {
        const res = await apiFetch<{ sections: HomepageSection[] }>('/api/admin/homepage-sections');
        setSections(res.sections);
      } else if (activeTab === 'logs') {
        const res = await apiFetch<{ logs: AdminActivityLog[] }>('/api/admin/logs');
        setLogs(res.logs);
      }
    } finally {
      setLoading(false);
    }
  }, [
    isAdmin,
    activeTab,
    booksSearch,
    booksPage,
    orderFilter,
    ordersSearch,
    ordersPage,
    customerSearch,
    customerStatusFilter,
    customersPage,
    startDate,
    endDate,
    bCategoryId,
  ]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData]);

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-2.5 sm:px-6 py-4 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-xl p-6 sm:p-10 text-sm">
          {t('loading')}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto px-3 sm:px-6 py-8 sm:py-12">
        <div className="bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-xl shadow-xs p-6 sm:p-8 space-y-5">
          <div className="space-y-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-stone-100">
              {t('adminTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Akoonkaaga (<span className="font-medium text-slate-900 dark:text-stone-100">{user.email}</span>) ma laha oggolaansho maamul.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/"
              className="inline-flex items-center justify-center min-h-[42px] px-4 py-2 text-xs sm:text-sm font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
            >
              {t('continueShopping')}
            </Link>
            <Link
              to="/account"
              className="inline-flex items-center justify-center min-h-[42px] px-4 py-2 text-xs sm:text-sm font-medium rounded-md border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
            >
              {t('navAccount')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const openBookEditor = (book?: Book) => {
    setBookPdfFile(null);
    if (book) {
      setEditingBookId(book.id);
      setBTitle(book.title);
      setBSubtitle(book.subtitle || '');
      setBSlug(book.slug);
      setBAuthor(book.author);
      setBDesc(book.description);
      setBCategoryId(book.categoryId);
      setBLang(book.language);
      setBYear(book.publicationYear ? String(book.publicationYear) : '2026');
      setBPublisher(book.publisher || 'Khalid Sharif Press');
      setBIsbn(book.isbn || '');
      setBPageCount(book.pageCount ? String(book.pageCount) : '');
      setBIsFree(book.isFree);
      setBPriceDollars((book.priceCents / 100).toFixed(2));
      setBSalePriceDollars(
        !book.isFree && typeof book.salePriceCents === 'number' && book.salePriceCents >= 0
          ? (book.salePriceCents / 100).toFixed(2)
          : ''
      );
      setBStatus(book.status);
      setBFeatured(book.isFeatured);
      setBRecommended(book.isRecommended);
      setBWatermarkEnabled(book.watermarkEnabled !== false);
      setBCoverUrl(book.coverUrl || '');
    } else {
      setEditingBookId(null);
      setBTitle('');
      setBSubtitle('');
      setBSlug('');
      setBAuthor('');
      setBDesc('');
      setBCategoryId(categories[0]?.id || '');
      setBLang('en');
      setBYear('2026');
      setBPublisher('Khalid Sharif Press');
      setBIsbn('');
      setBPageCount('');
      setBIsFree(false);
      setBPriceDollars('15.00');
      setBSalePriceDollars('');
      setBStatus('draft');
      setBFeatured(false);
      setBRecommended(false);
      setBWatermarkEnabled(true);
      setBCoverUrl('');
    }
    setCoverUploadError(null);
    setCoverUploadStatus(null);
    setBookFormOpen(true);
    setTimeout(() => {
      bookFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const priceCents = bIsFree ? 0 : Math.round(Number(bPriceDollars) * 100);
    if (!bIsFree && (!Number.isFinite(priceCents) || priceCents <= 0)) {
      setFeedback('Enter a valid price above $0.00 or choose Make Free.');
      return;
    }

    const rawSaleTrimmed = bSalePriceDollars.trim();
    const salePriceCents = !bIsFree && rawSaleTrimmed ? Math.round(Number(rawSaleTrimmed) * 100) : null;
    if (
      !bIsFree &&
      salePriceCents !== null &&
      (!Number.isFinite(salePriceCents) || salePriceCents < 0 || salePriceCents >= priceCents)
    ) {
      setFeedback('Sale price must be $0.00 or higher and strictly below the regular price.');
      return;
    }

    const parsedYear = bYear.trim() ? Number(bYear) : null;
    const parsedPageCount = bPageCount.trim() ? Number(bPageCount) : null;

    const payload = {
      title: bTitle,
      subtitle: bSubtitle.trim(),
      slug: bSlug || bTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      author: bAuthor,
      description: bDesc,
      categoryId: bCategoryId,
      language: bLang,
      publicationYear: parsedYear && Number.isFinite(parsedYear) ? Math.round(parsedYear) : null,
      publisher: bPublisher.trim() || 'Khalid Sharif Press',
      isbn: bIsbn.trim() ? bIsbn.trim() : null,
      pageCount: parsedPageCount && Number.isFinite(parsedPageCount) ? Math.round(parsedPageCount) : null,
      samplePageCount: 0,
      isFree: bIsFree,
      priceCents,
      salePriceCents,
      status: bStatus,
      isFeatured: bFeatured,
      isRecommended: bRecommended,
      watermarkEnabled: bWatermarkEnabled,
      coverUrl: bCoverUrl || null,
    };

    try {
      if (editingBookId) {
        await apiFetch(`/api/admin/books/${editingBookId}`, { method: 'PUT', body: JSON.stringify(payload) });
        if (bookPdfFile) await uploadBookPdfFile(editingBookId, bookPdfFile);
      } else {
        const result = await apiFetch<{ book: Book }>('/api/admin/books', { method: 'POST', body: JSON.stringify(payload) });
        if (bookPdfFile) await uploadBookPdfFile(result.book.id, bookPdfFile);
      }
      setBookFormOpen(false);
      setBookPdfFile(null);
      setFeedback('Book saved.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleArchiveBook = async (bookId: string, title: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/books/${bookId}`, { method: 'DELETE' });
      setFeedback(`Book "${title}" archived.`);
      if (editingBookId === bookId) {
        setBookFormOpen(false);
      }
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to archive book');
    }
  };

  const handleUploadCover = async (file: File) => {
    setCoverUploadError(null);
    setCoverUploadStatus(null);
    setFeedback(null);

    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      const msg = 'Cover image must be under 10 MB.';
      setCoverUploadError(msg);
      setFeedback(msg);
      return;
    }

    setUploadingCover(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{ coverUrl: string }>('/api/admin/upload-cover', { method: 'POST', body: fd });
      setBCoverUrl(res.coverUrl);

      if (editingBookId) {
        try {
          const updatedRes = await apiFetch<{ book: Book }>(`/api/admin/books/${editingBookId}/quick`, {
            method: 'PATCH',
            body: JSON.stringify({ coverUrl: res.coverUrl }),
          });
          setBooks((prev) => prev.map((item) => (item.id === editingBookId ? updatedRes.book : item)));
          setCoverUploadStatus('Cover uploaded and saved to this book.');
          setFeedback('Cover image uploaded and saved.');
        } catch {
          setCoverUploadStatus('Cover uploaded. Click "Save Changes" to apply.');
          setFeedback('Cover image uploaded. Click "Save Changes" to apply.');
        }
      } else {
        setCoverUploadStatus('Cover uploaded. Click "Save Changes" to create this book.');
        setFeedback('Cover image uploaded.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to upload cover image.';
      setCoverUploadError(msg);
      setFeedback(msg);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleClearCover = async () => {
    setCoverUploadError(null);
    setCoverUploadStatus(null);
    setBCoverUrl('');
    if (editingBookId) {
      try {
        const updatedRes = await apiFetch<{ book: Book }>(`/api/admin/books/${editingBookId}/quick`, {
          method: 'PATCH',
          body: JSON.stringify({ coverUrl: null }),
        });
        setBooks((prev) => prev.map((item) => (item.id === editingBookId ? updatedRes.book : item)));
        setCoverUploadStatus('Cover removed.');
      } catch (err) {
        setCoverUploadError(err instanceof Error ? err.message : 'Unable to remove cover image.');
      }
    }
  };

  const uploadBookPdfFile = async (bookId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiFetch(`/api/admin/books/${bookId}/upload-pdf`, { method: 'POST', body: fd });
  };

  const handleUploadBookPdf = async (bookId: string, file: File) => {
    setFeedback(null);
    try {
      await uploadBookPdfFile(bookId, file);
      setFeedback('PDF file uploaded to private storage.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to upload PDF file.');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const payload = {
      slug: cSlug,
      nameEn: cNameEn,
      nameSo: cNameSo,
      nameAr: cNameAr,
      descriptionEn: cDescEn,
      descriptionSo: cDescSo,
      descriptionAr: cDescAr,
      sortOrder: Number(cSortOrder) || 0,
      isPublished: cPublished,
    };
    try {
      if (editingCatId) {
        await apiFetch(`/api/admin/categories/${editingCatId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
      }
      setCatFormOpen(false);
      setFeedback('Category saved.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save category');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/categories/${catId}`, { method: 'DELETE' });
      if (editingCatId === catId) {
        setCatFormOpen(false);
      }
      setFeedback('Category deleted.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to delete category');
    }
  };

  const toLocalDateTimeInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openPromoEditor = (promo?: Promotion) => {
    if (promo) {
      setEditingPromoId(promo.id);
      setPrName(promo.name);
      setPrScope(promo.scope);
      setPrTargetId(promo.targetId || '');
      setPrDiscountType(promo.discountType);
      setPrDiscountValue(
        promo.discountType === 'fixed_cents'
          ? (promo.discountValue / 100).toFixed(2)
          : String(promo.discountValue)
      );
      setPrStartsAt(toLocalDateTimeInput(promo.startsAt));
      setPrEndsAt(toLocalDateTimeInput(promo.endsAt));
      setPrIsActive(promo.isActive);
    } else {
      setEditingPromoId(null);
      setPrName('');
      setPrScope('library');
      setPrTargetId('');
      setPrDiscountType('percent');
      setPrDiscountValue('15');
      setPrStartsAt('');
      setPrEndsAt('');
      setPrIsActive(true);
    }
    setPromoFormOpen(true);
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const numericVal = Number(prDiscountValue);
    const discountValue =
      prDiscountType === 'fixed_cents' ? Math.round(numericVal * 100) : Math.round(numericVal);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setFeedback('Enter a valid positive discount value.');
      return;
    }

    const payload = {
      name: prName.trim(),
      scope: prScope,
      targetId: prScope === 'library' ? null : prTargetId || null,
      discountType: prDiscountType,
      discountValue,
      startsAt: prStartsAt ? new Date(prStartsAt).toISOString() : null,
      endsAt: prEndsAt ? new Date(prEndsAt).toISOString() : null,
      isActive: prIsActive,
    };

    try {
      if (editingPromoId) {
        await apiFetch(`/api/admin/promotions/${editingPromoId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/admin/promotions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setPromoFormOpen(false);
      setFeedback('Promotion saved.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save promotion');
    }
  };

  const handleTogglePromotionActive = async (promo: Promotion) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/promotions/${promo.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: promo.name,
          scope: promo.scope,
          targetId: promo.scope === 'library' ? null : promo.targetId,
          discountType: promo.discountType,
          discountValue: promo.discountValue,
          startsAt: promo.startsAt,
          endsAt: promo.endsAt,
          isActive: !promo.isActive,
        }),
      });
      setFeedback(`Promotion "${promo.name}" ${!promo.isActive ? 'activated' : 'paused'}.`);
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to update promotion');
    }
  };

  const handleDeletePromotion = async (promoId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/promotions/${promoId}`, { method: 'DELETE' });
      if (editingPromoId === promoId) {
        setPromoFormOpen(false);
      }
      setFeedback('Promotion deleted.');
      void loadTabData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to delete promotion');
    }
  };

  const exportSalesCsv = () => {
    if (!overview) return;
    const rows = [
      ['Date', 'Verified Orders', 'Verified Revenue (USD)'],
      ...overview.reports.dailyRevenue.map((r) => [r.day, String(r.orderCount), (r.revenueCents / 100).toFixed(2)]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ksdl-verified-sales-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddContactChannel = () => {
    setContactChannels((prev) => [
      ...prev,
      {
        id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'phone',
        label: t('contactTypePhone'),
        value: '',
        url: '',
        isPrimary: prev.length === 0,
        isEnabled: true,
        sortOrder: prev.length + 1,
      },
    ]);
  };

  const handleSaveContacts = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingContacts(true);
    try {
      const payload = contactChannels.map((ch, idx) => ({
        ...ch,
        sortOrder: idx + 1,
      }));
      const res = await apiFetch<{ channels: ContactChannel[] }>('/api/admin/contacts', {
        method: 'PUT',
        body: JSON.stringify({ channels: payload }),
      });
      setContactChannels(res.channels);
      setFeedback(t('contactSavedMsg'));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save contact channels');
    } finally {
      setSavingContacts(false);
    }
  };

  const handleSaveDiscounts = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingDiscounts(true);
    try {
      const res = await apiFetch<{ codes: DiscountCodeEntry[] }>('/api/admin/discount-codes', {
        method: 'PUT',
        body: JSON.stringify({
          codes: discountCodes.map((d) => ({
            code: d.code.trim().toUpperCase(),
            percent: Number(d.percent),
          })),
        }),
      });
      setDiscountCodes(res.codes);
      setFeedback(t('discountSavedMsg'));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save discount codes');
    } finally {
      setSavingDiscounts(false);
    }
  };

  const openCustomerDetails = async (targetUserId: string) => {
    setLoadingCustomerDetails(true);
    setConfirmRevokeAll(false);
    setGrantPickBookIds([]);
    try {
      const details = await apiFetch<AdminCustomerDetails>(`/api/admin/customers/${targetUserId}`);
      setSelectedCustomerDetails(details);
      setEditCustName(details.customer.fullName);
      setEditCustLang(details.customer.preferredLanguage);
      setEditCustStatus(details.customer.accountStatus);
      setEditCustPassword('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to load user details');
    } finally {
      setLoadingCustomerDetails(false);
    }
  };

  const handleUpdateCustomerStatus = async (cId: string, email: string, nextStatus: AccountStatus) => {
    setCustomerActionId(cId);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/customers/${cId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ accountStatus: nextStatus }),
      });
      setFeedback(`${email}: ${nextStatus}.`);
      void loadTabData();
      if (selectedCustomerDetails?.customer.id === cId) {
        void openCustomerDetails(cId);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setCustomerActionId(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ customer: AdminCustomerListItem }>('/api/admin/customers', {
        method: 'POST',
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          fullName: newUserName,
          preferredLanguage: newUserLang,
          accountStatus: newUserStatus,
          isAdmin: newUserIsAdmin,
          grantAll: newUserGrantMode === 'all',
          bookIds: newUserGrantMode === 'selected' ? newUserBookIds : [],
        }),
      });
      setCreateUserOpen(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setNewUserIsAdmin(false);
      setNewUserGrantMode('none');
      setNewUserBookIds([]);
      setFeedback(`User ${res.customer.email} created.`);
      await loadTabData();
      await openCustomerDetails(res.customer.id);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to create user');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleSaveCustomerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerDetails) return;
    setSavingCustEdit(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/customers/${selectedCustomerDetails.customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editCustName,
          preferredLanguage: editCustLang,
          accountStatus: editCustStatus,
          newPassword: editCustPassword.trim() ? editCustPassword : undefined,
        }),
      });
      setEditCustPassword('');
      setFeedback('User account updated.');
      await Promise.all([loadTabData(), openCustomerDetails(selectedCustomerDetails.customer.id)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingCustEdit(false);
    }
  };

  const handleGrantBooksToSelectedUser = async (grantAll: boolean, bookIds: string[]) => {
    if (!selectedCustomerDetails) return;
    setGrantBusy(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/customers/${selectedCustomerDetails.customer.id}/books/grant`, {
        method: 'POST',
        body: JSON.stringify({ grantAll, bookIds }),
      });
      setGrantPickBookIds([]);
      setFeedback(grantAll ? 'All active books unlocked for this user.' : 'Selected books unlocked for free.');
      await Promise.all([loadTabData(), openCustomerDetails(selectedCustomerDetails.customer.id)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to grant book access');
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevokeBookFromSelectedUser = async (bookId: string) => {
    if (!selectedCustomerDetails) return;
    setGrantBusy(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/customers/${selectedCustomerDetails.customer.id}/books/${bookId}`, {
        method: 'DELETE',
      });
      setFeedback('Book access revoked for this user.');
      await Promise.all([loadTabData(), openCustomerDetails(selectedCustomerDetails.customer.id)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to revoke book');
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevokeAllFromSelectedUser = async () => {
    if (!selectedCustomerDetails) return;
    setGrantBusy(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/customers/${selectedCustomerDetails.customer.id}/books/revoke-all`, {
        method: 'POST',
      });
      setConfirmRevokeAll(false);
      setFeedback('All book entitlements revoked for this user.');
      await Promise.all([loadTabData(), openCustomerDetails(selectedCustomerDetails.customer.id)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to revoke books');
    } finally {
      setGrantBusy(false);
    }
  };



  const navItems: Array<{ key: AdminTab; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: t('adminOverview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'books', label: t('adminBooks'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'categories', label: t('adminCategories'), icon: <FolderTree className="w-4 h-4" /> },
    { key: 'orders', label: t('adminOrders'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'customers', label: t('adminCustomers'), icon: <Users className="w-4 h-4" /> },
    { key: 'reviews', label: t('adminReviews'), icon: <MessageSquareText className="w-4 h-4" /> },
    { key: 'payments', label: t('adminPayments'), icon: <CreditCard className="w-4 h-4" /> },
    { key: 'promotions', label: t('adminPromotions'), icon: <Tag className="w-4 h-4" /> },
    { key: 'contacts', label: t('adminContacts'), icon: <Phone className="w-4 h-4" /> },
    { key: 'sections', label: t('adminSections'), icon: <Layers className="w-4 h-4" /> },
    { key: 'reports', label: t('adminReports'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'logs', label: t('adminLogs'), icon: <ScrollText className="w-4 h-4" /> },
  ];

  return (
    <>
      <SeoHead title={`${t('adminTitle')} – ${t('brandName')}`} description={t('adminTitle')} noIndex />
      <div className="max-w-6xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        <div className="bg-white dark:bg-slate-900 border-y sm:border border-[#D8D1BE] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-xs px-4 py-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-4 mb-5 sm:mb-6">
          <h1 className="font-serif text-xl sm:text-3xl font-semibold text-slate-900 dark:text-stone-100">{t('adminTitle')}</h1>
          {feedback && (
            <span className={`text-xs font-medium ${feedback.startsWith('Error:') ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{feedback}</span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8">
          <aside className="lg:col-span-3 flex overflow-x-auto no-scrollbar gap-1.5 pb-1 lg:block lg:space-y-1 lg:pb-0">
            {navItems.map((item) => (
              <Link
                key={item.key}
                to={`/admin/${item.key}`}
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

          <div className="lg:col-span-9 min-w-0 space-y-6">
            {loading && !overview ? (
              <div className="h-48 rounded-md bg-stone-200/60 dark:bg-slate-800/50 animate-pulse" />
            ) : activeTab === 'overview' && overview ? (
              <div className="space-y-6 sm:space-y-8">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
                  {[
                    { label: 'Published / Total Books', val: `${overview.metrics.publishedBooks} / ${overview.metrics.totalBooks}` },
                    { label: 'Draft Books', val: String(overview.metrics.draftBooks) },
                    { label: 'Registered Customers', val: String(overview.metrics.registeredCustomers) },
                    { label: 'Verified Revenue', val: formatMoney(overview.metrics.verifiedRevenueCents, 'USD', language) },
                    { label: 'Paid Orders', val: String(overview.metrics.paidOrders) },
                    { label: 'Pending Payments', val: String(overview.metrics.pendingPayments) },
                    { label: 'Failed Payments', val: String(overview.metrics.failedPayments) },
                    { label: 'Total Orders', val: String(overview.metrics.totalOrders) },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className="p-3 sm:p-4 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 min-w-0"
                    >
                      <div className="text-[11px] sm:text-xs text-slate-500 truncate">{kpi.label}</div>
                      <div className="font-mono-tabular text-lg sm:text-xl font-semibold mt-1">{kpi.val}</div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 sm:p-5 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 space-y-3">
                  <h2 className="text-lg sm:text-xl font-semibold text-[#02598B] dark:text-sky-400">Recent Orders</h2>
                  {overview.recentOrders.length === 0 ? (
                    <p className="text-sm text-slate-500">No orders yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E5E0CE] dark:border-slate-800 text-xs text-slate-500 text-start">
                            <th className="py-2 text-start">Reference</th>
                            <th className="py-2 text-start">Customer</th>
                            <th className="py-2 text-start">Status</th>
                            <th className="py-2 text-end">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E5E0CE]/60 dark:divide-slate-800">
                          {overview.recentOrders.map((o) => (
                            <tr key={o.id}>
                              <td className="py-2.5 font-mono-tabular">{o.orderReference}</td>
                              <td className="py-2.5">{o.customerEmail}</td>
                              <td className="py-2.5 uppercase text-xs font-medium">{o.status}</td>
                              <td className="py-2.5 text-end font-mono-tabular">
                                {formatMoney(o.totalCents, o.currency, language)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'books' ? (
              <div className="space-y-5 sm:space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminBooks')}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="search"
                      value={booksSearch}
                      onChange={(e) => {
                        setBooksSearch(e.target.value);
                        setBooksPage(1);
                      }}
                      placeholder={t('searchBooksPlaceholder')}
                      className="min-h-[40px] w-48 sm:w-64 px-3 py-2 text-xs sm:text-sm rounded-md border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => openBookEditor()}
                      className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                    >
                      {t('createBtn')}
                    </button>
                  </div>
                </div>

                {bookFormOpen && (
                  <form
                    ref={bookFormRef}
                    onSubmit={handleSaveBook}
                    className="p-4 sm:p-6 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-4"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-3">
                      <h3 className="font-semibold text-base text-slate-900 dark:text-stone-100">
                        {editingBookId ? `${t('editBtn')}: ${bTitle || 'Book'}` : t('createBtn')}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setBookFormOpen(false)}
                        className="p-1.5 rounded hover:bg-stone-200/70 dark:hover:bg-slate-800"
                        aria-label={t('cancelBtn')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium mb-1">Title</label>
                        <input required value={bTitle} onChange={(e) => setBTitle(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('bookSubtitleLabel')}</label>
                        <input value={bSubtitle} onChange={(e) => setBSubtitle(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Slug</label>
                        <input value={bSlug} onChange={(e) => setBSlug(e.target.value)} placeholder="auto-generated-slug" className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Author</label>
                        <input required value={bAuthor} onChange={(e) => setBAuthor(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Category</label>
                        <select value={bCategoryId} onChange={(e) => setBCategoryId(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900">
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.nameEn}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Language</label>
                        <select value={bLang} onChange={(e) => setBLang(e.target.value as LanguageCode)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900">
                          <option value="so">Somali</option>
                          <option value="en">English</option>
                          <option value="ar">Arabic</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Status</label>
                        <select value={bStatus} onChange={(e) => setBStatus(e.target.value as BookStatus)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900">
                          <option value="draft">Draft</option>
                          <option value="published">Published</option>
                          <option value="archived">Archived</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('publishedLabel')}</label>
                        <input type="number" min={1000} max={2100} value={bYear} onChange={(e) => setBYear(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('bookPublisherLabel')}</label>
                        <input value={bPublisher} onChange={(e) => setBPublisher(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('bookIsbnLabel')}</label>
                          <input value={bIsbn} onChange={(e) => setBIsbn(e.target.value)} placeholder="978-..." className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('bookPageCountLabel')}</label>
                          <input type="number" min={1} max={10000} value={bPageCount} onChange={(e) => setBPageCount(e.target.value)} placeholder="240" className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                        </div>
                      </div>

                      <div className="sm:col-span-2 p-3.5 rounded-md bg-white dark:bg-slate-900 border border-[#E5E0CE] dark:border-slate-800 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Pricing ({bIsFree ? 'FREE' : 'PAID'})
                          </span>
                          <div className="inline-flex rounded-md border border-[#CCC4B0] dark:border-slate-700 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => {
                                setBIsFree(false);
                                if (!Number.isFinite(Number(bPriceDollars)) || Number(bPriceDollars) <= 0) {
                                  setBPriceDollars('10.00');
                                }
                              }}
                              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                !bIsFree
                                  ? 'bg-[#0376B8] text-white'
                                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#F3EFE2] dark:hover:bg-slate-800'
                              }`}
                            >
                              {t('setPaidPriceBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBIsFree(true)}
                              className={`px-3 py-1.5 text-xs font-medium border-s border-[#CCC4B0] dark:border-slate-700 transition-colors ${
                                bIsFree
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#F3EFE2] dark:hover:bg-slate-800'
                              }`}
                            >
                              {t('makeBookFreeBtn')}
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                          <div>
                            <label className="block text-xs font-medium mb-1">Price (USD)</label>
                            <input
                              type="number"
                              step="0.01"
                              min={bIsFree ? '0' : '0.01'}
                              disabled={bIsFree}
                              value={bIsFree ? '0.00' : bPriceDollars}
                              onChange={(e) => setBPriceDollars(e.target.value)}
                              className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">{t('salePriceLabel')}</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={bIsFree}
                              placeholder="Optional"
                              value={bIsFree ? '' : bSalePriceDollars}
                              onChange={(e) => setBSalePriceDollars(e.target.value)}
                              className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-50"
                            />
                          </div>
                          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                            <label className="block text-xs font-medium mb-1">Cover Image (JPG, PNG, WebP · max 10 MB)</label>
                            <div className="flex items-center gap-3">
                              {bCoverUrl ? (
                                <img
                                  src={bCoverUrl}
                                  alt={bTitle || 'Book cover preview'}
                                  className="w-11 h-14 object-cover rounded border border-[#D4CEB8] dark:border-slate-700 shrink-0 bg-[#F3EFE2]"
                                />
                              ) : null}
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-[#F3EFE2] dark:hover:bg-slate-800 cursor-pointer ${
                                      uploadingCover ? 'opacity-60 pointer-events-none' : ''
                                    }`}
                                  >
                                    <Upload className="w-3.5 h-3.5" />
                                    <span>{uploadingCover ? 'Uploading...' : bCoverUrl ? 'Replace Cover' : 'Upload Cover'}</span>
                                    <input
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      disabled={uploadingCover}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        e.target.value = '';
                                        if (f) void handleUploadCover(f);
                                      }}
                                      className="sr-only"
                                    />
                                  </label>
                                  {bCoverUrl && (
                                    <button
                                      type="button"
                                      onClick={() => void handleClearCover()}
                                      className="px-2 py-1.5 text-xs rounded border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                                {coverUploadError && (
                                  <p className="text-[11px] text-red-600 dark:text-red-400">{coverUploadError}</p>
                                )}
                                {coverUploadStatus && !coverUploadError && (
                                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{coverUploadStatus}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-dashed border-[#CCC4B0] dark:border-slate-700 p-3.5 space-y-2">
                      <label className="block text-xs font-medium">Book PDF (optional, maximum 50 MB)</label>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-[#F3EFE2] dark:hover:bg-slate-800 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>{bookPdfFile ? 'Replace PDF' : 'Choose Book PDF'}</span>
                          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            e.target.value = '';
                            if (!file) return;
                            if (file.size === 0 || file.size > 50 * 1024 * 1024 || (file.type && file.type !== 'application/pdf')) {
                              setFeedback('Choose a valid PDF file up to 50 MB.');
                              setBookPdfFile(null);
                              return;
                            }
                            setBookPdfFile(file);
                            setFeedback(null);
                          }} />
                        </label>
                        <span className="text-xs text-slate-600 dark:text-slate-400">{bookPdfFile ? `${bookPdfFile.name} · ${(bookPdfFile.size / (1024 * 1024)).toFixed(1)} MB` : editingBookId ? 'Choose a PDF to add or replace this book’s file.' : 'Selected PDF will be uploaded securely when you save the book.'}</span>
                      </div>
                      {!editingBookId && <p className="text-[11px] text-slate-500">You can also save the book first and upload its PDF from the book list.</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Description</label>
                      <textarea required rows={3} value={bDesc} onChange={(e) => setBDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                    </div>
                    <div className="flex flex-wrap gap-5 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={bFeatured} onChange={(e) => setBFeatured(e.target.checked)} />
                        <span>Featured</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={bRecommended} onChange={(e) => setBRecommended(e.target.checked)} />
                        <span>Recommended</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={bWatermarkEnabled} onChange={(e) => setBWatermarkEnabled(e.target.checked)} />
                        <span>{t('bookWatermarkLabel')}</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="submit" className="min-h-[42px] px-4 py-2 text-sm font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white">
                        {t('saveChanges')}
                      </button>
                      <button type="button" onClick={() => setBookFormOpen(false)} className="min-h-[42px] px-4 py-2 text-sm rounded-md border border-[#CCC4B0] dark:border-slate-700">
                        {t('cancelBtn')}
                      </button>
                    </div>
                  </form>
                )}

                <div className="bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E0CE] dark:border-slate-800 text-xs text-slate-500">
                        <th className="p-3 text-start">Title</th>
                        <th className="p-3 text-start">Status</th>
                        <th className="p-3 text-end">Price</th>
                        <th className="p-3 text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E0CE]/60 dark:divide-slate-800">
                      {books.map((b) => (
                        <tr key={b.id}>
                          <td className="p-3 min-w-[180px]">
                            <div className="font-medium">{b.title}</div>
                            <div className="text-xs text-slate-500">
                              {b.author} · {b.hasPdfFile ? 'PDF Ready' : 'No PDF'}
                            </div>
                          </td>
                          <td className="p-3 uppercase text-xs font-medium">{b.status}</td>
                          <td className="p-3 text-end font-mono-tabular">
                            {b.isFree ? (
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">FREE</span>
                            ) : typeof b.salePriceCents === 'number' && b.salePriceCents < b.priceCents ? (
                              <div className="inline-flex flex-col items-end">
                                <span className="text-xs line-through text-slate-400">
                                  {formatMoney(b.priceCents, b.currency, language)}
                                </span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                  {formatMoney(b.salePriceCents, b.currency, language)}
                                </span>
                              </div>
                            ) : (
                              formatMoney(b.priceCents, b.currency, language)
                            )}
                          </td>
                          <td className="p-3 text-end space-x-2 whitespace-nowrap">
                            <label className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 cursor-pointer hover:bg-[#F3EFE2] dark:hover:bg-slate-800">
                              <Upload className="w-3 h-3" />
                              <span>PDF</span>
                              <input
                                type="file"
                                accept="application/pdf"
                                className="sr-only"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  e.target.value = '';
                                  if (f) void handleUploadBookPdf(b.id, f);
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => openBookEditor(b)}
                              className="px-2.5 py-1 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                            >
                              {t('editBtn')}
                            </button>
                            {b.status !== 'archived' && (
                              <button
                                type="button"
                                onClick={() => void handleArchiveBook(b.id, b.title)}
                                className="px-2.5 py-1 text-xs rounded border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                {t('archiveBookBtn')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {booksTotal > 25 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-mono-tabular">
                      {t('pageLabel')} {booksPage} / {Math.max(1, Math.ceil(booksTotal / 25))} · {booksTotal} total
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={booksPage <= 1}
                        onClick={() => setBooksPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('prevPage')}
                      </button>
                      <button
                        type="button"
                        disabled={booksPage * 25 >= booksTotal}
                        onClick={() => setBooksPage((p) => p + 1)}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('nextPage')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === 'categories' ? (
              <div className="space-y-5 sm:space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminCategories')}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCatId(null);
                      setCSlug('');
                      setCNameEn('');
                      setCNameSo('');
                      setCNameAr('');
                      setCDescEn('');
                      setCDescSo('');
                      setCDescAr('');
                      setCSortOrder('1');
                      setCPublished(true);
                      setCatFormOpen(true);
                    }}
                    className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                  >
                    {t('createBtn')}
                  </button>
                </div>

                {catFormOpen && (
                  <form onSubmit={handleSaveCategory} className="p-4 sm:p-6 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <input required placeholder="Slug (e.g. science)" value={cSlug} onChange={(e) => setCSlug(e.target.value)} className="min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input required placeholder="Name (English)" value={cNameEn} onChange={(e) => setCNameEn(e.target.value)} className="min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input required placeholder="Name (Somali)" value={cNameSo} onChange={(e) => setCNameSo(e.target.value)} className="min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input required placeholder="Name (Arabic)" value={cNameAr} onChange={(e) => setCNameAr(e.target.value)} className="min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <input placeholder={t('categoryDescEnLabel')} value={cDescEn} onChange={(e) => setCDescEn(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input placeholder={t('categoryDescSoLabel')} value={cDescSo} onChange={(e) => setCDescSo(e.target.value)} className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input placeholder={t('categoryDescArLabel')} value={cDescAr} onChange={(e) => setCDescAr(e.target.value)} dir="rtl" className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <input type="number" value={cSortOrder} onChange={(e) => setCSortOrder(e.target.value)} className="w-24 min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={cPublished} onChange={(e) => setCPublished(e.target.checked)} />
                        <span>Published</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="min-h-[40px] px-4 py-2 text-sm rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white">{t('saveChanges')}</button>
                      <button type="button" onClick={() => setCatFormOpen(false)} className="min-h-[40px] px-4 py-2 text-sm rounded-md border border-[#CCC4B0] dark:border-slate-700">{t('cancelBtn')}</button>
                    </div>
                  </form>
                )}

                <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800 bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-lg">
                  {categories.map((c) => (
                    <div key={c.id} className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{c.nameEn} / {c.nameSo} / {c.nameAr}</div>
                        <div className="text-xs text-slate-500">{c.slug} · Order {c.sortOrder} · {c.bookCount ?? 0} books</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(c.id);
                            setCSlug(c.slug);
                            setCNameEn(c.nameEn);
                            setCNameSo(c.nameSo);
                            setCNameAr(c.nameAr);
                            setCDescEn(c.descriptionEn);
                            setCDescSo(c.descriptionSo);
                            setCDescAr(c.descriptionAr);
                            setCSortOrder(String(c.sortOrder));
                            setCPublished(c.isPublished);
                            setCatFormOpen(true);
                          }}
                          className="min-h-[36px] px-3 py-1.5 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                        >
                          {t('editBtn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCategory(c.id)}
                          className="min-h-[36px] px-3 py-1.5 text-xs rounded border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          {t('deleteCategoryBtn')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeTab === 'orders' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl font-semibold">{t('adminOrders')}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="search"
                      value={ordersSearch}
                      onChange={(e) => {
                        setOrdersSearch(e.target.value);
                        setOrdersPage(1);
                      }}
                      placeholder={t('searchOrdersPlaceholder')}
                      className="min-h-[38px] w-48 sm:w-60 px-3 py-1.5 text-xs sm:text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <select
                      value={orderFilter}
                      onChange={(e) => {
                        setOrderFilter(e.target.value);
                        setOrdersPage(1);
                      }}
                      className="min-h-[38px] px-3 py-1.5 text-xs sm:text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="processing">Awaiting Verification</option>
                      <option value="awaiting_payment">Awaiting Payment</option>
                      <option value="paid">Paid</option>
                      <option value="failed">Failed</option>
                      <option value="refunded">Refunded</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        void downloadAuthenticatedFile(
                          `/api/admin/orders/export?status=${encodeURIComponent(orderFilter)}&q=${encodeURIComponent(ordersSearch)}`,
                          'orders-export.csv'
                        )
                      }
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('exportCsvBtn')}</span>
                    </button>
                  </div>
                </div>

                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="p-5 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono-tabular font-semibold">{o.orderReference}</div>
                        <div className="text-xs text-slate-500">
                          {o.customerName} ({o.customerEmail}) · {formatLocalizedDate(o.createdAt, language)}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="font-mono-tabular font-semibold">{formatMoney(o.totalCents, o.currency, language)}</div>
                        <div className="text-xs uppercase font-medium">{o.status}</div>
                      </div>
                    </div>

                    {o.payment && (
                      <div className="text-xs bg-white dark:bg-slate-900 p-3 rounded border border-[#E5E0CE] dark:border-slate-800 space-y-1">
                        <div>
                          Method:{' '}
                          {o.payment.providerCode === 'premier_bank_gateway'
                            ? 'Mastercard / Visa'
                            : o.payment.providerCode}{' '}
                          · TX: <span className="font-mono-tabular">{o.payment.transactionReference}</span>
                        </div>
                        {o.payment.customerSubmittedReference && (
                          <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                            Customer Submitted Reference: {o.payment.customerSubmittedReference}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {(o.status === 'pending' || o.status === 'processing' || o.status === 'awaiting_payment') && (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              setFeedback(null);
                              try {
                                await apiFetch(`/api/admin/orders/${o.id}/verify-payment`, { method: 'POST' });
                                setFeedback(`Order ${o.orderReference} verified and unlocked.`);
                                void loadTabData();
                              } catch (err) {
                                setFeedback(`Error: ${err instanceof Error ? err.message : 'Unable to approve this payment.'}`);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#025E94] text-white"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {t('verifyPaymentBtn')}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setFeedback(null);
                              try {
                                await apiFetch(`/api/admin/orders/${o.id}/reject-payment`, { method: 'POST', body: JSON.stringify({}) });
                                setFeedback(`Order ${o.orderReference} rejected.`);
                                void loadTabData();
                              } catch (err) {
                                setFeedback(`Error: ${err instanceof Error ? err.message : 'Unable to reject this payment.'}`);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                          >
                            <X className="w-3.5 h-3.5" />
                            {t('rejectPaymentBtn')}
                          </button>
                        </>
                      )}
                      {o.status === 'paid' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/orders/${o.id}/refund`, { method: 'POST', body: JSON.stringify({}) });
                            setFeedback(`Order ${o.orderReference} refunded and entitlement revoked.`);
                            void loadTabData();
                          }}
                          className="px-3 py-1.5 text-xs rounded border border-[#CCC4B0] dark:border-slate-700"
                        >
                          {t('refundBtn')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void downloadAuthenticatedFile(
                            `/api/orders/${o.id}/receipt`,
                            `receipt-${o.orderReference}.pdf`
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{t('downloadReceipt')}</span>
                      </button>
                    </div>
                  </div>
                ))}

                {ordersTotal > 20 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-mono-tabular">
                      {t('pageLabel')} {ordersPage} / {Math.max(1, Math.ceil(ordersTotal / 20))} · {ordersTotal} total
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={ordersPage <= 1}
                        onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('prevPage')}
                      </button>
                      <button
                        type="button"
                        disabled={ordersPage * 20 >= ordersTotal}
                        onClick={() => setOrdersPage((p) => p + 1)}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('nextPage')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === 'customers' ? (
              <div className="space-y-5">
                {/* Header & Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminCustomers')}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Pause, suspend, reactivate users, reset passwords, or unlock specific / all books for free.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void downloadAuthenticatedFile(
                          `/api/admin/customers/export?q=${encodeURIComponent(customerSearch)}&status=${encodeURIComponent(customerStatusFilter)}`,
                          'customers-export.csv'
                        )
                      }
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium rounded-md border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('exportCsvBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateUserOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{t('createUserBtn')}</span>
                    </button>
                  </div>
                </div>

                {/* User Status Summary KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    { label: t('allStatusesFilter'), val: customers.length, tone: 'text-slate-900 dark:text-stone-100' },
                    {
                      label: t('activeBadge'),
                      val: customers.filter((c) => c.accountStatus === 'active').length,
                      tone: 'text-emerald-700 dark:text-emerald-400',
                    },
                    {
                      label: t('pausedBadge'),
                      val: customers.filter((c) => c.accountStatus === 'paused').length,
                      tone: 'text-amber-700 dark:text-amber-400',
                    },
                    {
                      label: t('suspendedBadge'),
                      val: customers.filter((c) => c.accountStatus === 'suspended').length,
                      tone: 'text-red-700 dark:text-red-400',
                    },
                    {
                      label: 'Admins',
                      val: customers.filter((c) => c.roles.includes('admin') || c.roles.includes('super_admin')).length,
                      tone: 'text-[#0376B8] dark:text-sky-400',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="p-3 rounded-md bg-[#F3F0E6] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800"
                    >
                      <div className="text-[11px] text-slate-500 truncate">{item.label}</div>
                      <div className={`font-mono-tabular text-lg font-semibold mt-0.5 ${item.tone}`}>{item.val}</div>
                    </div>
                  ))}
                </div>

                {/* Create User Form */}
                {createUserOpen && (
                  <form
                    onSubmit={handleCreateUser}
                    className="p-4 sm:p-6 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-[#E5E0CE] dark:border-slate-800 pb-2.5">
                      <h3 className="font-serif text-base sm:text-lg font-semibold">{t('createUserBtn')}</h3>
                      <button
                        type="button"
                        onClick={() => setCreateUserOpen(false)}
                        className="p-1 rounded hover:bg-[#E8E2D0] dark:hover:bg-slate-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('fullNameLabel')}</label>
                        <input
                          required
                          minLength={2}
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('emailLabel')}</label>
                        <input
                          required
                          type="email"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('passwordLabel')}</label>
                        <input
                          required
                          type="password"
                          minLength={8}
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          placeholder="Min 8 characters"
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('languageLabel')}</label>
                          <select
                            value={newUserLang}
                            onChange={(e) => setNewUserLang(e.target.value as LanguageCode)}
                            className="w-full min-h-[40px] px-2.5 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <option value="so">Soomaali</option>
                            <option value="en">English</option>
                            <option value="ar">العربية</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Status</label>
                          <select
                            value={newUserStatus}
                            onChange={(e) => setNewUserStatus(e.target.value as AccountStatus)}
                            className="w-full min-h-[40px] px-2.5 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <option value="active">{t('activeBadge')}</option>
                            <option value="paused">{t('pausedBadge')}</option>
                            <option value="suspended">{t('suspendedBadge')}</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {isSuperAdmin && (
                      <div className="flex flex-wrap items-center gap-5 text-xs sm:text-sm pt-1">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserIsAdmin}
                            onChange={(e) => setNewUserIsAdmin(e.target.checked)}
                          />
                          <span>Admin Privileges</span>
                        </label>
                      </div>
                    )}

                    <div className="p-3.5 rounded-md bg-white dark:bg-slate-900 border border-[#E5E0CE] dark:border-slate-800 space-y-2.5">
                      <div className="text-xs font-semibold">Initial Free Book Access</div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="new-user-book-grant"
                            checked={newUserGrantMode === 'none'}
                            onChange={() => setNewUserGrantMode('none')}
                          />
                          <span>None</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="new-user-book-grant"
                            checked={newUserGrantMode === 'selected'}
                            onChange={() => setNewUserGrantMode('selected')}
                          />
                          <span>Selected Books</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="new-user-book-grant"
                            checked={newUserGrantMode === 'all'}
                            onChange={() => setNewUserGrantMode('all')}
                          />
                          <span>{t('unlockAllBooksBtn')}</span>
                        </label>
                      </div>

                      {newUserGrantMode === 'selected' && (
                        <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {books
                            .filter((b) => b.status !== 'archived')
                            .map((b) => {
                              const checked = newUserBookIds.includes(b.id);
                              return (
                                <label
                                  key={b.id}
                                  className="flex items-center gap-2 p-2 rounded border border-[#E5E0CE] dark:border-slate-800 text-xs cursor-pointer hover:bg-[#FAF9F5] dark:hover:bg-slate-950"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setNewUserBookIds((prev) =>
                                        e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id)
                                      );
                                    }}
                                  />
                                  <span className="truncate flex-1">{b.title}</span>
                                  <span className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                                    {b.isFree ? 'FREE' : formatMoney(b.priceCents, b.currency, language)}
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        disabled={creatingUser}
                        className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60"
                      >
                        {creatingUser ? t('loading') : t('createUserBtn')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreateUserOpen(false)}
                        className="min-h-[40px] px-4 py-2 text-xs sm:text-sm rounded-md border border-[#CCC4B0] dark:border-slate-700"
                      >
                        {t('cancelBtn')}
                      </button>
                    </div>
                  </form>
                )}

                {/* Status Filter Pills + Search */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', 'active', 'paused', 'suspended'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setCustomerStatusFilter(st);
                          setCustomersPage(1);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                          customerStatusFilter === st
                            ? 'bg-[#0376B8] text-white border-[#0376B8]'
                            : 'border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800'
                        }`}
                      >
                        {st === 'all'
                          ? t('allStatusesFilter')
                          : st === 'active'
                            ? t('activeBadge')
                            : st === 'paused'
                              ? t('pausedBadge')
                              : t('suspendedBadge')}
                      </button>
                    ))}
                  </div>
                  <input
                    type="search"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomersPage(1);
                    }}
                    placeholder="Search email or name..."
                    className="w-full sm:w-64 min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>

                {/* Users Table */}
                <div className="bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E0CE] dark:border-slate-800 text-xs text-slate-500">
                        <th className="p-3 text-start">User</th>
                        <th className="p-3 text-start">Roles / Status</th>
                        <th className="p-3 text-end">Unlocked Books</th>
                        <th className="p-3 text-end">Orders / Spend</th>
                        <th className="p-3 text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E0CE]/60 dark:divide-slate-800">
                      {customers.map((c) => {
                        const isSelf = c.id === user.id;
                        const targetIsSuperAdmin = c.roles.includes('super_admin');
                        const hasAdminRole = c.roles.includes('admin') || targetIsSuperAdmin;
                        const canManageTarget = !isSelf && (!targetIsSuperAdmin || isSuperAdmin);
                        const isSelected = selectedCustomerDetails?.customer.id === c.id;
                        const statusBadgeClass =
                          c.accountStatus === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                            : c.accountStatus === 'paused'
                              ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800';
                        const statusLabel =
                          c.accountStatus === 'active'
                            ? t('activeBadge')
                            : c.accountStatus === 'paused'
                              ? t('pausedBadge')
                              : t('suspendedBadge');

                        return (
                          <tr
                            key={c.id}
                            className={isSelected ? 'bg-[#F0F7FC] dark:bg-sky-950/20' : ''}
                          >
                            <td className="p-3 min-w-[160px]">
                              <div className="font-medium break-words">{c.fullName || '—'}</div>
                              <div className="text-xs text-slate-500 break-all">{c.email}</div>
                            </td>
                            <td className="p-3 text-xs space-y-1">
                              <div className="text-slate-600 dark:text-slate-400">{c.roles.join(', ')}</div>
                              <span
                                className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${statusBadgeClass}`}
                              >
                                {statusLabel}
                              </span>
                            </td>
                            <td className="p-3 text-end font-mono-tabular">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F3F0E6] dark:bg-slate-800 text-xs font-medium">
                                <BookCheck className="w-3.5 h-3.5 text-[#0376B8] dark:text-sky-400" />
                                {c.activeBooksCount}
                              </span>
                            </td>
                            <td className="p-3 text-end font-mono-tabular text-xs">
                              <div>{c.orderCount} orders</div>
                              <div className="text-slate-500">{formatMoney(c.totalSpentCents, 'USD', language)}</div>
                            </td>
                            <td className="p-3 text-end">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void openCustomerDetails(c.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#025E94] text-white"
                                >
                                  <UserCog className="w-3.5 h-3.5" />
                                  <span>{t('manageUserBtn')}</span>
                                </button>
                                {canManageTarget && (
                                  <>
                                    {c.accountStatus !== 'active' && (
                                      <button
                                        type="button"
                                        disabled={customerActionId === c.id}
                                        onClick={() => void handleUpdateCustomerStatus(c.id, c.email, 'active')}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                                      >
                                        <PlayCircle className="w-3.5 h-3.5" />
                                        <span>{t('activateUserBtn')}</span>
                                      </button>
                                    )}
                                    {c.accountStatus !== 'paused' && (
                                      <button
                                        type="button"
                                        disabled={customerActionId === c.id}
                                        onClick={() => void handleUpdateCustomerStatus(c.id, c.email, 'paused')}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                                      >
                                        <PauseCircle className="w-3.5 h-3.5" />
                                        <span>{t('pauseUserBtn')}</span>
                                      </button>
                                    )}
                                    {c.accountStatus !== 'suspended' && (
                                      <button
                                        type="button"
                                        disabled={customerActionId === c.id}
                                        onClick={() => void handleUpdateCustomerStatus(c.id, c.email, 'suspended')}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                                      >
                                        <ShieldBan className="w-3.5 h-3.5" />
                                        <span>{t('suspendUserBtn')}</span>
                                      </button>
                                    )}
                                    {isSuperAdmin && !targetIsSuperAdmin && (
                                      <button
                                        type="button"
                                        disabled={customerActionId === c.id}
                                        onClick={async () => {
                                          setCustomerActionId(c.id);
                                          try {
                                            await apiFetch(`/api/admin/customers/${c.id}/role`, {
                                              method: 'PATCH',
                                              body: JSON.stringify({ isAdmin: !hasAdminRole }),
                                            });
                                            setFeedback(`Updated role for ${c.email}.`);
                                            void loadTabData();
                                          } catch (err) {
                                            setFeedback(err instanceof Error ? err.message : 'Role update failed');
                                          } finally {
                                            setCustomerActionId(null);
                                          }
                                        }}
                                        className="px-2 py-1 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                                      >
                                        {hasAdminRole ? t('removeAdminBtn') : t('makeAdminBtn')}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {customers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-xs text-slate-500">
                            No users match the selected search or status filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {customersTotal > 20 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-mono-tabular">
                      {t('pageLabel')} {customersPage} / {Math.max(1, Math.ceil(customersTotal / 20))} · {customersTotal} total
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={customersPage <= 1}
                        onClick={() => setCustomersPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('prevPage')}
                      </button>
                      <button
                        type="button"
                        disabled={customersPage * 20 >= customersTotal}
                        onClick={() => setCustomersPage((p) => p + 1)}
                        className="px-3 py-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40"
                      >
                        {t('nextPage')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Selected User Deep Management Drawer / Panel */}
                {loadingCustomerDetails && (
                  <div className="p-5 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 text-sm text-slate-500">
                    {t('loading')}
                  </div>
                )}

                {selectedCustomerDetails && !loadingCustomerDetails && (
                  <div className="p-4 sm:p-6 rounded-xl bg-[#FAF9F5] dark:bg-slate-950/60 border-2 border-[#0376B8]/40 dark:border-sky-800/60 space-y-6">
                    {/* Panel Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-serif text-lg sm:text-xl font-semibold text-slate-900 dark:text-stone-100">
                            {selectedCustomerDetails.customer.fullName || selectedCustomerDetails.customer.email}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              selectedCustomerDetails.customer.accountStatus === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                : selectedCustomerDetails.customer.accountStatus === 'paused'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
                            }`}
                          >
                            {selectedCustomerDetails.customer.accountStatus === 'active'
                              ? t('activeBadge')
                              : selectedCustomerDetails.customer.accountStatus === 'paused'
                                ? t('pausedBadge')
                                : t('suspendedBadge')}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 break-all mt-0.5">
                          {selectedCustomerDetails.customer.email} · {selectedCustomerDetails.customer.roles.join(', ')} ·{' '}
                          Joined {formatLocalizedDate(selectedCustomerDetails.customer.createdAt, language)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerDetails(null)}
                        aria-label="Close user panel"
                        className="p-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Section A: Profile, Account Status & Password Reset */}
                    <form
                      onSubmit={handleSaveCustomerEdit}
                      className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-[#E5E0CE] dark:border-slate-800 space-y-3.5"
                    >
                      <h4 className="text-sm font-semibold text-[#02598B] dark:text-sky-400">
                        {t('userProfileControlTitle')}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('fullNameLabel')}</label>
                          <input
                            required
                            minLength={2}
                            value={editCustName}
                            onChange={(e) => setEditCustName(e.target.value)}
                            className="w-full min-h-[38px] px-3 py-1.5 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('languageLabel')}</label>
                          <select
                            value={editCustLang}
                            onChange={(e) => setEditCustLang(e.target.value as LanguageCode)}
                            className="w-full min-h-[38px] px-2.5 py-1.5 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                          >
                            <option value="so">Soomaali</option>
                            <option value="en">English</option>
                            <option value="ar">العربية</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Account Status</label>
                          <select
                            disabled={
                              selectedCustomerDetails.customer.id === user.id ||
                              (selectedCustomerDetails.customer.roles.includes('super_admin') && !isSuperAdmin)
                            }
                            value={editCustStatus}
                            onChange={(e) => setEditCustStatus(e.target.value as AccountStatus)}
                            className="w-full min-h-[38px] px-2.5 py-1.5 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                          >
                            <option value="active">{t('activeBadge')}</option>
                            <option value="paused">{t('pausedBadge')}</option>
                            <option value="suspended">{t('suspendedBadge')}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">{t('resetPasswordOptional')}</label>
                          <input
                            type="password"
                            minLength={8}
                            disabled={selectedCustomerDetails.customer.roles.includes('super_admin') && !isSuperAdmin && selectedCustomerDetails.customer.id !== user.id}
                            value={editCustPassword}
                            onChange={(e) => setEditCustPassword(e.target.value)}
                            placeholder="Leave blank to keep"
                            className="w-full min-h-[38px] px-3 py-1.5 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={
                          savingCustEdit ||
                          (selectedCustomerDetails.customer.roles.includes('super_admin') &&
                            !isSuperAdmin &&
                            selectedCustomerDetails.customer.id !== user.id)
                        }
                        className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60"
                      >
                        {savingCustEdit ? t('loading') : t('saveChanges')}
                      </button>
                    </form>

                    {/* Section B: Free Book Access Control for This User */}
                    <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-[#E5E0CE] dark:border-slate-800 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <h4 className="text-sm font-semibold text-[#02598B] dark:text-sky-400">
                          {t('userBookAccessTitle')}
                        </h4>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={grantBusy}
                            onClick={() => void handleGrantBooksToSelectedUser(true, [])}
                            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>{t('unlockAllBooksBtn')}</span>
                          </button>

                          {selectedCustomerDetails.entitlements.some((e) => e.status === 'active') &&
                            (confirmRevokeAll ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={grantBusy}
                                  onClick={() => void handleRevokeAllFromSelectedUser()}
                                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 hover:bg-red-700 text-white"
                                >
                                  Confirm Revoke All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRevokeAll(false)}
                                  className="min-h-[36px] px-2.5 py-1.5 text-xs rounded-md border border-[#CCC4B0] dark:border-slate-700"
                                >
                                  {t('cancelBtn')}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={grantBusy}
                                onClick={() => setConfirmRevokeAll(true)}
                                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>{t('revokeAllAccessBtn')}</span>
                              </button>
                            ))}
                        </div>
                      </div>

                      {/* Multi-select books not currently active for this user */}
                      {(() => {
                        const activeBookIds = new Set(
                          selectedCustomerDetails.entitlements
                            .filter((e) => e.status === 'active')
                            .map((e) => e.bookId)
                        );
                        const grantableBooks = books.filter(
                          (b) => b.status !== 'archived' && !activeBookIds.has(b.id)
                        );
                        if (grantableBooks.length === 0) {
                          return (
                            <p className="text-xs text-emerald-700 dark:text-emerald-400">
                              All non-archived library books are currently unlocked for this user.
                            </p>
                          );
                        }
                        return (
                          <div className="p-3 rounded-md bg-[#FAF9F5] dark:bg-slate-950 border border-[#E5E0CE] dark:border-slate-800 space-y-2.5">
                            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              Select specific books to unlock for free:
                            </div>
                            <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {grantableBooks.map((b) => {
                                const checked = grantPickBookIds.includes(b.id);
                                return (
                                  <label
                                    key={b.id}
                                    className="flex items-center gap-2 p-2 rounded border border-[#E5E0CE] dark:border-slate-800 bg-white dark:bg-slate-900 text-xs cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        setGrantPickBookIds((prev) =>
                                          e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id)
                                        );
                                      }}
                                    />
                                    <span className="truncate flex-1">{b.title}</span>
                                    <span className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                                      {b.isFree ? 'FREE' : formatMoney(b.priceCents, b.currency, language)}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              disabled={grantBusy || grantPickBookIds.length === 0}
                              onClick={() => void handleGrantBooksToSelectedUser(false, grantPickBookIds)}
                              className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-50"
                            >
                              {t('grantSelectedBooksBtn')} ({grantPickBookIds.length})
                            </button>
                          </div>
                        );
                      })()}

                      {/* User's Current Book Access List */}
                      {selectedCustomerDetails.entitlements.length === 0 ? (
                        <p className="text-xs text-slate-500">No individual book entitlements recorded yet.</p>
                      ) : (
                        <div className="divide-y divide-[#E5E0CE]/70 dark:divide-slate-800 border border-[#E5E0CE] dark:border-slate-800 rounded-md">
                          {selectedCustomerDetails.entitlements.map((ent) => (
                            <div
                              key={ent.bookId}
                              className="p-2.5 sm:px-3.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium break-words">{ent.title}</div>
                                <div className="text-[11px] text-slate-500">
                                  {ent.author} · Source:{' '}
                                  <span className="font-medium">
                                    {ent.sourceType === 'admin_grant'
                                      ? 'Admin Free Grant'
                                      : ent.sourceType === 'purchase'
                                        ? 'Purchased'
                                        : 'Free Claim'}
                                  </span>{' '}
                                  · Status:{' '}
                                  <span
                                    className={
                                      ent.status === 'active'
                                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                        : 'text-red-600 dark:text-red-400 font-semibold'
                                    }
                                  >
                                    {ent.status.toUpperCase()}
                                  </span>
                                </div>
                              </div>
                              {ent.status === 'active' ? (
                                <button
                                  type="button"
                                  disabled={grantBusy}
                                  onClick={() => void handleRevokeBookFromSelectedUser(ent.bookId)}
                                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                                >
                                  {t('revokeAccessBtn')}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={grantBusy}
                                  onClick={() => void handleGrantBooksToSelectedUser(false, [ent.bookId])}
                                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 shrink-0"
                                >
                                  Re-grant Free
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Section C: Recent Orders for This User */}
                    {selectedCustomerDetails.orders.length > 0 && (
                      <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-[#E5E0CE] dark:border-slate-800 space-y-2.5">
                        <h4 className="text-sm font-semibold text-[#02598B] dark:text-sky-400">
                          User Order History ({selectedCustomerDetails.orders.length})
                        </h4>
                        <div className="divide-y divide-[#E5E0CE]/70 dark:divide-slate-800 text-xs">
                          {selectedCustomerDetails.orders.map((ord) => (
                            <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="font-mono-tabular font-semibold">{ord.orderReference}</span>{' '}
                                <span className="uppercase text-[11px] text-slate-500">({ord.status})</span>
                                <div className="text-[11px] text-slate-500">
                                  {ord.items.map((it) => it.bookTitleSnapshot).join(', ')}
                                </div>
                              </div>
                              <div className="text-end font-mono-tabular">
                                <div>{formatMoney(ord.totalCents, ord.currency, language)}</div>
                                <div className="text-[11px] text-slate-400">
                                  {formatLocalizedDate(ord.createdAt, language)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : activeTab === 'reviews' ? (
              <div className="space-y-4">
                <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminReviews')}</h2>
                {reviews.length === 0 ? (
                  <div className="p-6 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 text-sm text-slate-500">
                    No reader reviews submitted yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sm text-slate-900 dark:text-stone-100">
                              {rev.bookTitle} · <span className="font-mono-tabular text-[#0376B8] dark:text-sky-400">{rev.rating}/5</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              {rev.reviewerName} ({rev.reviewerEmail}) · {formatLocalizedDate(rev.createdAt, language)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/admin/reviews/${rev.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ isPublished: !rev.isPublished }),
                                });
                                setFeedback(rev.isPublished ? 'Review hidden.' : 'Review published.');
                                void loadTabData();
                              }}
                              className={`px-2.5 py-1 text-xs rounded border ${
                                rev.isPublished
                                  ? 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300'
                                  : 'bg-[#0376B8] text-white border-[#0376B8]'
                              }`}
                            >
                              {rev.isPublished ? t('hideReviewBtn') : t('publishReviewBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/admin/reviews/${rev.id}`, { method: 'DELETE' });
                                setFeedback('Review deleted.');
                                void loadTabData();
                              }}
                              className="px-2.5 py-1 text-xs rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                            >
                              {t('deleteReviewBtn')}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === 'payments' ? (
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-semibold">{t('adminPayments')}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Manage visible payment methods, manual payment instructions, card gateway settings, and discount codes.
                  </p>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSavingManualMethod(true);
                    setFeedback(null);
                    try {
                      await apiFetch('/api/admin/payment-providers', {
                        method: 'POST',
                        body: JSON.stringify({
                          displayName: newManualMethodName,
                          accountNumber: newManualAccountNumber,
                        }),
                      });
                      setNewManualMethodName('');
                      setNewManualAccountNumber('');
                      setFeedback('Manual payment method added. Enable it to show it at checkout.');
                      void loadTabData();
                    } catch (err) {
                      setFeedback(err instanceof Error ? err.message : 'Unable to add payment method.');
                    } finally {
                      setSavingManualMethod(false);
                    }
                  }}
                  className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2DCCB] dark:border-slate-800 space-y-3"
                >
                  <div>
                    <h3 className="font-semibold">Add manual payment method</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">New payment methods start hidden until you enable them.</p>
                  </div>
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    value={newManualMethodName}
                    onChange={(e) => setNewManualMethodName(e.target.value)}
                    placeholder="Method name (e.g. EVC Plus)"
                    className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <div>
                    <label className="block text-xs font-medium mb-1">Account number or USSD code</label>
                    <input required minLength={3} maxLength={120} value={newManualAccountNumber} onChange={(e) => setNewManualAccountNumber(e.target.value)} placeholder="Account number or *799*70378426*{{amount}}#" className="w-full min-h-[40px] px-3 py-2 text-sm font-mono rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950" />
                    <p className="mt-1 text-[11px] text-slate-500">For an automatic phone code, enter the full USSD code and put {'{{amount}}'} where the book price goes.</p>
                  </div>
                  <button type="submit" disabled={savingManualMethod} className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60">
                    <Plus className="w-3.5 h-3.5" />
                    {savingManualMethod ? t('loading') : 'Add payment method'}
                  </button>
                </form>

                {providers
                  .map((p) => {
                  const isEditingThis = editingProviderCode === p.code;
                  const cardNetworks = Array.isArray(p.publicConfig?.cardNetworks)
                    ? (p.publicConfig.cardNetworks as string[])
                    : [];
                  const gatewaySettingsExpanded = expandedGatewayProviderCode === p.code;

                  return (
                    <div key={p.code} className="p-5 rounded-xl bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#E2DCCB] dark:border-slate-800 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-900 dark:text-stone-100">{p.displayName}</h3>
                            {cardNetworks.length > 0 && (
                              <span className="text-[11px] font-mono-tabular font-semibold text-[#0376B8] dark:text-sky-400">
                                ({cardNetworks.join(' · ')})
                              </span>
                            )}
                          </div>
                          {p.providerType !== 'manual' && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Status:{' '}
                              <span className={p.isConnected ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-amber-700 dark:text-amber-400 font-semibold'}>
                                {p.isConnected ? t('providerConnected') : t('providerNotConnected')}
                              </span>
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingThis) {
                                setEditingProviderCode(null);
                              } else {
                                setEditingProviderCode(p.code);
                                setPInstSo(p.instructionsSo);
                                setPInstEn(p.instructionsEn);
                                setPInstAr(p.instructionsAr);
                                setPAccountNumber(String(p.publicConfig?.accountNumber || ''));
                              }
                            }}
                            className="px-3 py-1.5 text-xs rounded-md border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                          >
                            {isEditingThis ? t('cancelBtn') : t('editBtn')}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/payment-providers/${p.code}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                  isEnabled: !p.isEnabled,
                                  instructionsEn: p.instructionsEn,
                                  instructionsSo: p.instructionsSo,
                                  instructionsAr: p.instructionsAr,
                                }),
                              });
                              setFeedback(`${p.displayName} ${!p.isEnabled ? 'enabled' : 'disabled'}.`);
                              void loadTabData();
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                              p.isEnabled
                                ? 'bg-[#0376B8] text-white'
                                : 'border border-[#CCC4B0] dark:border-slate-700'
                            }`}
                          >
                            {p.isEnabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                      </div>

                      {isEditingThis ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            await apiFetch(`/api/admin/payment-providers/${p.code}`, {
                              method: 'PUT',
                              body: JSON.stringify({
                                isEnabled: p.isEnabled,
                                instructionsEn: pInstEn,
                                instructionsSo: pInstSo,
                                instructionsAr: pInstAr,
                                ...(p.providerType === 'manual' ? { accountNumber: pAccountNumber } : {}),
                              }),
                            });
                            setEditingProviderCode(null);
                            setFeedback('Payment instructions saved.');
                            void loadTabData();
                          }}
                          className="space-y-3 pt-2 border-t border-[#E5DFCF] dark:border-slate-800"
                        >
                          {p.providerType === 'manual' ? (
                            <div>
                              <label className="block text-xs font-medium mb-1">Account number or USSD code</label>
                              <input required minLength={3} maxLength={120} value={pAccountNumber} onChange={(e) => setPAccountNumber(e.target.value)} placeholder="Account number or *799*70378426*{{amount}}#" className="w-full min-h-[40px] px-3 py-2 text-sm font-mono rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                              <p className="mt-1 text-[11px] text-slate-500">Use {'{{amount}}'} in the full USSD code to insert the book total automatically.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <textarea rows={2} value={pInstSo} onChange={(e) => setPInstSo(e.target.value)} aria-label="Instructions in Somali" className="w-full px-3 py-2 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                              <textarea rows={2} value={pInstEn} onChange={(e) => setPInstEn(e.target.value)} aria-label="Instructions in English" className="w-full px-3 py-2 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                              <textarea rows={2} value={pInstAr} onChange={(e) => setPInstAr(e.target.value)} aria-label="Instructions in Arabic" className="w-full px-3 py-2 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900" />
                            </div>
                          )}
                          <button type="submit" className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white">
                            {t('saveChanges')}
                          </button>
                        </form>
                      ) : p.providerType === 'manual' ? (
                        <p className="text-xs text-slate-600 dark:text-slate-400">Account: <span className="font-mono font-semibold">{String(p.publicConfig?.accountNumber || 'No number set')}</span></p>
                      ) : (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {language === 'so' ? p.instructionsSo : language === 'ar' ? p.instructionsAr : p.instructionsEn}
                        </p>
                      )}

                      {/* Turnkey Live Payment Gateway Credentials Box */}
                      {p.providerType === 'online_gateway' && p.credentials && (
                        <>
                        <button
                          type="button"
                          aria-expanded={gatewaySettingsExpanded}
                          onClick={() => setExpandedGatewayProviderCode(gatewaySettingsExpanded ? null : p.code)}
                          className="w-full flex items-center justify-between rounded-md border border-[#D4CEB8] dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          <span>Gateway settings</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${gatewaySettingsExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {gatewaySettingsExpanded && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            setSavingGw(true);
                            setGwTestResult(null);
                            setFeedback(null);
                            try {
                              const res = await apiFetch<{ isConnected: boolean }>(
                                `/api/admin/payment-providers/${p.code}/credentials`,
                                {
                                  method: 'PUT',
                                  body: JSON.stringify({
                                    gatewayMode: gwMode,
                                    gatewayUrl: gwUrl,
                                    merchantId: gwMerchantId,
                                    apiVersion: gwApiVersion || '73',
                                    apiKey: gwApiKey || undefined,
                                    webhookSecret: gwWebhookSecret || undefined,
                                  }),
                                }
                              );
                              setGwApiKey('');
                              setGwWebhookSecret('');
                              setFeedback(t('gatewaySavedMsg'));
                              setGwTestResult({
                                ok: res.isConnected,
                                message: res.isConnected
                                  ? 'Gateway credentials saved and active for live checkout.'
                                  : 'Saved. Complete any remaining required fields to activate live checkout.',
                              });
                              void loadTabData();
                            } catch (err) {
                              setGwTestResult({
                                ok: false,
                                message: err instanceof Error ? err.message : 'Unable to save gateway credentials',
                              });
                            } finally {
                              setSavingGw(false);
                            }
                          }}
                          className="mt-4 p-4 sm:p-5 rounded-lg bg-white dark:bg-slate-900 border border-[#D4CEB8] dark:border-slate-800 space-y-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <KeyRound className="w-4 h-4 text-[#0376B8] dark:text-sky-400 shrink-0" />
                                <h4 className="font-serif text-base sm:text-lg font-semibold text-slate-900 dark:text-stone-100">
                                  {t('gatewayBoxTitle')}
                                </h4>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {t('gatewayBoxSubtitle')}
                              </p>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold ${
                                p.isConnected
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              }`}
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              {p.isConnected ? t('providerConnected') : t('providerNotConnected')}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                {t('gatewayModeLabel')}
                              </label>
                              <select
                                value={gwMode}
                                onChange={(e) => setGwMode(e.target.value as GatewayMode)}
                                className="w-full min-h-[40px] px-3 py-2 text-xs sm:text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                              >
                                <option value="mpgs_hosted">{t('gatewayModeMpgs')}</option>
                                <option value="rest_redirect">{t('gatewayModeRest')}</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                {t('gatewayUrlLabel')}
                              </label>
                              <input
                                type="url"
                                value={gwUrl}
                                onChange={(e) => setGwUrl(e.target.value)}
                                placeholder={
                                  gwMode === 'mpgs_hosted'
                                    ? 'https://ap-gateway.mastercard.com'
                                    : 'https://gateway.premierbank.so/api/v1/checkout'
                                }
                                className="w-full min-h-[40px] px-3 py-2 text-xs sm:text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                {t('gatewayMerchantIdLabel')}
                              </label>
                              <input
                                type="text"
                                value={gwMerchantId}
                                onChange={(e) => setGwMerchantId(e.target.value)}
                                placeholder="MERCHANT_ID"
                                className="w-full min-h-[40px] px-3 py-2 text-xs sm:text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            </div>

                            {gwMode === 'mpgs_hosted' && (
                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                  {t('gatewayApiVersionLabel')}
                                </label>
                                <input
                                  type="text"
                                  value={gwApiVersion}
                                  onChange={(e) => setGwApiVersion(e.target.value)}
                                  placeholder="73"
                                  className="w-full min-h-[40px] px-3 py-2 text-xs sm:text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                                />
                              </div>
                            )}

                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                  {t('gatewayApiKeyLabel')}
                                </label>
                                {p.credentials.hasApiKey && (
                                  <span className="text-[11px] font-mono-tabular text-emerald-700 dark:text-emerald-400">
                                    {p.credentials.apiKeyMasked}
                                  </span>
                                )}
                              </div>
                              <div className="relative">
                                <input
                                  type={showGwSecrets ? 'text' : 'password'}
                                  value={gwApiKey}
                                  onChange={(e) => setGwApiKey(e.target.value)}
                                  placeholder={p.credentials.hasApiKey ? t('gatewayKeepSavedHint') : 'Enter API Password / Secret Key'}
                                  className="w-full min-h-[40px] ps-3 pe-9 py-2 text-xs sm:text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowGwSecrets((s) => !s)}
                                  aria-label="Toggle secret visibility"
                                  className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                  {showGwSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                  {t('gatewayWebhookSecretLabel')}
                                </label>
                                {p.credentials.hasWebhookSecret && (
                                  <span className="text-[11px] font-mono-tabular text-emerald-700 dark:text-emerald-400">
                                    {p.credentials.webhookSecretMasked}
                                  </span>
                                )}
                              </div>
                              <input
                                type={showGwSecrets ? 'text' : 'password'}
                                value={gwWebhookSecret}
                                onChange={(e) => setGwWebhookSecret(e.target.value)}
                                placeholder={p.credentials.hasWebhookSecret ? t('gatewayKeepSavedHint') : 'Enter Webhook / Notification Secret'}
                                className="w-full min-h-[40px] px-3 py-2 text-xs sm:text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            </div>
                          </div>

                          {/* Copyable Webhook Callback URL for bank onboarding */}
                          <div className="p-3 rounded-md bg-[#F7F6F0] dark:bg-slate-950 border border-[#E5E0CE] dark:border-slate-800 space-y-1">
                            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {t('gatewayWebhookCallbackLabel')}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <code className="text-[11px] font-mono-tabular text-[#02598B] dark:text-sky-400 break-all">
                                {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/payments/${p.code}`}
                              </code>
                              <button
                                type="button"
                                onClick={async () => {
                                  const cb = `${window.location.origin}/api/webhooks/payments/${p.code}`;
                                  await navigator.clipboard.writeText(cb).catch(() => {});
                                  setCopiedWebhook(true);
                                  setTimeout(() => setCopiedWebhook(false), 1800);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                              >
                                {copiedWebhook ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedWebhook ? t('contactCopied') : t('contactCopyBtn')}</span>
                              </button>
                            </div>
                          </div>

                          {gwTestResult && (
                            <div
                              className={`p-3 rounded-md text-xs border ${
                                gwTestResult.ok
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'
                                  : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
                              }`}
                            >
                              {gwTestResult.message}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2.5 pt-1">
                            <button
                              type="submit"
                              disabled={savingGw}
                              className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60"
                            >
                              {savingGw ? t('loading') : t('gatewaySaveBtn')}
                            </button>
                            <button
                              type="button"
                              disabled={testingGw}
                              onClick={async () => {
                                setTestingGw(true);
                                setGwTestResult(null);
                                try {
                                  const res = await apiFetch<{ ok: boolean; message: string }>(
                                    `/api/admin/payment-providers/${p.code}/test`,
                                    { method: 'POST' }
                                  );
                                  setGwTestResult(res);
                                } catch (err) {
                                  setGwTestResult({
                                    ok: false,
                                    message: err instanceof Error ? err.message : 'Test failed',
                                  });
                                } finally {
                                  setTestingGw(false);
                                }
                              }}
                              className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800 disabled:opacity-60"
                            >
                              {testingGw ? t('loading') : t('gatewayTestBtn')}
                            </button>
                            {(p.credentials.hasApiKey || p.credentials.hasWebhookSecret || p.credentials.gatewayUrl) && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/admin/payment-providers/${p.code}/credentials`, {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                      gatewayMode: gwMode,
                                      gatewayUrl: '',
                                      merchantId: '',
                                      apiVersion: '73',
                                      clearSecrets: true,
                                    }),
                                  });
                                  setGwUrl('');
                                  setGwMerchantId('');
                                  setGwApiKey('');
                                  setGwWebhookSecret('');
                                  setGwTestResult(null);
                                  setFeedback('Saved gateway credentials cleared.');
                                  void loadTabData();
                                }}
                                className="min-h-[38px] px-3 py-1.5 text-xs rounded-md border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                {t('gatewayClearBtn')}
                              </button>
                            )}
                          </div>
                        </form>
                        )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Discount Codes Management */}
                <form
                  onSubmit={handleSaveDiscounts}
                  className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2DCCB] dark:border-slate-800 space-y-4 mt-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-serif text-lg font-semibold text-slate-900 dark:text-stone-100">
                        {t('adminDiscountsTitle')}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('adminDiscountsSubtitle')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDiscountCodes((prev) => [...prev, { code: '', percent: 10 }])
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('addDiscountBtn')}</span>
                    </button>
                  </div>

                  {discountCodes.length === 0 ? (
                    <p className="text-xs text-slate-500">No discount codes configured.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {discountCodes.map((dc, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2.5 items-center">
                          <div className="col-span-6 sm:col-span-6">
                            <input
                              required
                              value={dc.code}
                              placeholder={t('discountCodeField')}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                setDiscountCodes((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, code: val } : row))
                                );
                              }}
                              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm font-mono-tabular uppercase rounded border border-[#CCC4B0] dark:border-slate-700 bg-transparent"
                            />
                          </div>
                          <div className="col-span-4 sm:col-span-4">
                            <div className="relative">
                              <input
                                required
                                type="number"
                                min={1}
                                max={95}
                                value={dc.percent}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setDiscountCodes((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, percent: val } : row))
                                  );
                                }}
                                className="w-full min-h-[38px] ps-3 pe-7 py-1.5 text-xs sm:text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-transparent"
                              />
                              <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                            </div>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button
                              type="button"
                              aria-label="Remove discount code"
                              onClick={() =>
                                setDiscountCodes((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="p-2 rounded border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingDiscounts}
                      className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60"
                    >
                      {t('saveChanges')}
                    </button>
                  </div>
                </form>
              </div>
            ) : activeTab === 'promotions' ? (
              <div className="space-y-5 sm:space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminPromotions')}</h2>
                  <button
                    type="button"
                    onClick={() => openPromoEditor()}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('addPromotionBtn')}</span>
                  </button>
                </div>

                {promoFormOpen && (
                  <form
                    onSubmit={handleSavePromotion}
                    className="p-4 sm:p-6 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-[#E5E0CE] dark:border-slate-800 pb-2.5">
                      <h3 className="font-serif text-base sm:text-lg font-semibold">
                        {editingPromoId ? `${t('editBtn')}: ${prName}` : t('addPromotionBtn')}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setPromoFormOpen(false)}
                        className="p-1 rounded hover:bg-[#E8E2D0] dark:hover:bg-slate-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium mb-1">Name</label>
                        <input
                          required
                          minLength={2}
                          value={prName}
                          onChange={(e) => setPrName(e.target.value)}
                          placeholder="Eid Collection Sale"
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">{t('promoScopeLabel')}</label>
                        <select
                          value={prScope}
                          onChange={(e) => {
                            const nextScope = e.target.value as PromotionScope;
                            setPrScope(nextScope);
                            if (nextScope === 'library') {
                              setPrTargetId('');
                            } else if (nextScope === 'category') {
                              setPrTargetId(categories[0]?.id || '');
                            } else {
                              const firstPaid = books.find((b) => !b.isFree && b.status !== 'archived') || books[0];
                              setPrTargetId(firstPaid?.id || '');
                            }
                          }}
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="library">{t('promoScopeLibrary')}</option>
                          <option value="category">{t('promoScopeCategory')}</option>
                          <option value="book">{t('promoScopeBook')}</option>
                        </select>
                      </div>

                      {prScope === 'category' && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium mb-1">{t('promoScopeCategory')}</label>
                          <select
                            required
                            value={prTargetId}
                            onChange={(e) => setPrTargetId(e.target.value)}
                            className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <option value="">Select category...</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nameEn} / {c.nameSo}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {prScope === 'book' && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium mb-1">{t('promoScopeBook')}</label>
                          <select
                            required
                            value={prTargetId}
                            onChange={(e) => setPrTargetId(e.target.value)}
                            className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <option value="">Select book...</option>
                            {books
                              .filter((b) => b.status !== 'archived' && !b.isFree)
                              .map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.title} ({formatMoney(b.priceCents, b.currency, language)})
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium mb-1">{t('promoDiscountTypeLabel')}</label>
                        <select
                          value={prDiscountType}
                          onChange={(e) => {
                            const nextType = e.target.value as PromotionDiscountType;
                            setPrDiscountType(nextType);
                            setPrDiscountValue(nextType === 'percent' ? '15' : '5.00');
                          }}
                          className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="percent">{t('promoPercent')}</option>
                          <option value="fixed_cents">{t('promoFixedCents')}</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">
                          {prDiscountType === 'percent' ? t('promoPercent') : t('promoFixedCents')}
                        </label>
                        <input
                          required
                          type="number"
                          step={prDiscountType === 'fixed_cents' ? '0.01' : '1'}
                          min={prDiscountType === 'fixed_cents' ? '0.01' : '1'}
                          max={prDiscountType === 'percent' ? '95' : '10000'}
                          value={prDiscountValue}
                          onChange={(e) => setPrDiscountValue(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">Starts At (Optional)</label>
                        <input
                          type="datetime-local"
                          value={prStartsAt}
                          onChange={(e) => setPrStartsAt(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">Ends At (Optional)</label>
                        <input
                          type="datetime-local"
                          value={prEndsAt}
                          onChange={(e) => setPrEndsAt(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono-tabular rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prIsActive}
                        onChange={(e) => setPrIsActive(e.target.checked)}
                      />
                      <span>{t('activeBadge')}</span>
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 py-2 text-sm font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                      >
                        {t('saveChanges')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromoFormOpen(false)}
                        className="min-h-[40px] px-4 py-2 text-sm rounded-md border border-[#CCC4B0] dark:border-slate-700"
                      >
                        {t('cancelBtn')}
                      </button>
                    </div>
                  </form>
                )}

                <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800 bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 rounded-lg">
                  {promotions.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">No promotions configured.</div>
                  ) : (
                    promotions.map((pr) => {
                      const targetLabel =
                        pr.scope === 'library'
                          ? t('promoScopeLibrary')
                          : pr.scope === 'category'
                            ? categories.find((c) => c.id === pr.targetId)?.nameEn || pr.targetId || 'Category'
                            : books.find((b) => b.id === pr.targetId)?.title || pr.targetId || 'Book';
                      const discountDisplay =
                        pr.discountType === 'percent'
                          ? `-${pr.discountValue}%`
                          : `-${formatMoney(pr.discountValue, 'USD', language)}`;

                      return (
                        <div key={pr.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-900 dark:text-stone-100">{pr.name}</span>
                              <span className="font-mono-tabular text-xs font-semibold px-2 py-0.5 rounded-xs bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                {discountDisplay}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              {targetLabel}
                              {(pr.startsAt || pr.endsAt) && (
                                <span className="font-mono-tabular">
                                  {' · '}
                                  {pr.startsAt ? formatLocalizedDate(pr.startsAt, language) : 'Now'} →{' '}
                                  {pr.endsAt ? formatLocalizedDate(pr.endsAt, language) : 'Open'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleTogglePromotionActive(pr)}
                              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded ${
                                pr.isActive
                                  ? 'bg-[#0376B8] text-white'
                                  : 'border border-[#CCC4B0] dark:border-slate-700 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {pr.isActive ? t('activeBadge') : t('pausedBadge')}
                            </button>
                            <button
                              type="button"
                              onClick={() => openPromoEditor(pr)}
                              className="min-h-[34px] px-3 py-1 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 hover:bg-[#F3EFE2] dark:hover:bg-slate-800"
                            >
                              {t('editBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePromotion(pr.id)}
                              className="min-h-[34px] px-2.5 py-1 text-xs rounded border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              aria-label="Delete promotion"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : activeTab === 'contacts' ? (
              <form onSubmit={handleSaveContacts} className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-xl sm:text-2xl font-semibold text-slate-900 dark:text-stone-100">
                      {t('adminContactsTitle')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t('adminContactsSubtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddContactChannel}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('addContactBtn')}</span>
                  </button>
                </div>

                {contactChannels.length === 0 ? (
                  <div className="p-6 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 text-sm text-slate-500">
                    {t('contactEmpty')}
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {contactChannels.map((ch, idx) => (
                      <div
                        key={ch.id}
                        className="p-4 sm:p-5 rounded-xl bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#E2DCCB] dark:border-slate-800 space-y-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E5E0CE] dark:border-slate-800">
                          <span className="text-xs font-mono-tabular font-semibold text-[#02598B] dark:text-sky-400">
                            #{idx + 1} · {t(contactTypeTranslationKey(ch.type))}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              aria-label="Move up"
                              onClick={() => {
                                if (idx === 0) return;
                                setContactChannels((prev) => {
                                  const next = [...prev];
                                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                  return next;
                                });
                              }}
                              className="p-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === contactChannels.length - 1}
                              aria-label="Move down"
                              onClick={() => {
                                if (idx === contactChannels.length - 1) return;
                                setContactChannels((prev) => {
                                  const next = [...prev];
                                  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                  return next;
                                });
                              }}
                              className="p-1.5 rounded border border-[#CCC4B0] dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Delete contact channel"
                              onClick={() =>
                                setContactChannels((prev) => prev.filter((item) => item.id !== ch.id))
                              }
                              className="p-1.5 rounded border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1">{t('contactTypeLabel')}</label>
                            <select
                              value={ch.type}
                              onChange={(e) => {
                                const newType = e.target.value as ContactChannelType;
                                setContactChannels((prev) =>
                                  prev.map((item) =>
                                    item.id === ch.id
                                      ? {
                                          ...item,
                                          type: newType,
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              {CONTACT_TYPES.map((ct) => (
                                <option key={ct} value={ct}>
                                  {t(contactTypeTranslationKey(ct))}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium mb-1">{t('contactLabelField')}</label>
                            <input
                              required
                              value={ch.label}
                              onChange={(e) => {
                                const val = e.target.value;
                                setContactChannels((prev) =>
                                  prev.map((item) => (item.id === ch.id ? { ...item, label: val } : item))
                                );
                              }}
                              className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium mb-1">{t('contactValueField')}</label>
                            <input
                              required
                              value={ch.value}
                              placeholder="+252611086006"
                              onChange={(e) => {
                                const val = e.target.value;
                                setContactChannels((prev) =>
                                  prev.map((item) => (item.id === ch.id ? { ...item, value: val } : item))
                                );
                              }}
                              className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium mb-1">{t('contactUrlField')}</label>
                            <input
                              value={ch.url || ''}
                              placeholder="https://... or tel:+..."
                              onChange={(e) => {
                                const val = e.target.value;
                                setContactChannels((prev) =>
                                  prev.map((item) => (item.id === ch.id ? { ...item, url: val } : item))
                                );
                              }}
                              className="w-full min-h-[40px] px-3 py-2 text-sm rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-5 pt-1 text-xs sm:text-sm">
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="primary-contact-channel"
                              checked={ch.isPrimary}
                              onChange={() =>
                                setContactChannels((prev) =>
                                  prev.map((item) => ({
                                    ...item,
                                    isPrimary: item.id === ch.id,
                                  }))
                                )
                              }
                            />
                            <span>{t('contactPrimaryLabel')}</span>
                          </label>
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ch.isEnabled}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setContactChannels((prev) =>
                                  prev.map((item) =>
                                    item.id === ch.id ? { ...item, isEnabled: checked } : item
                                  )
                                );
                              }}
                            />
                            <span>{t('contactVisibleLabel')}</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <Link
                    to="/contact"
                    className="text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
                  >
                    {t('navContact')} →
                  </Link>
                  <button
                    type="submit"
                    disabled={savingContacts}
                    className="min-h-[42px] px-5 py-2 text-sm font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-60"
                  >
                    {t('saveChanges')}
                  </button>
                </div>
              </form>
            ) : activeTab === 'sections' ? (
              <div className="space-y-4">
                <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminSections')}</h2>
                {sections.map((sec) => (
                  <div key={sec.id} className="p-3.5 sm:p-4 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{sec.titleEn} / {sec.titleSo} / {sec.titleAr}</div>
                      <div className="text-xs text-slate-500">Key: {sec.sectionKey} · Order: {sec.sortOrder}</div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/homepage-sections/${sec.id}`, {
                          method: 'PUT',
                          body: JSON.stringify({
                            isEnabled: !sec.isEnabled,
                            sortOrder: sec.sortOrder,
                            titleEn: sec.titleEn,
                            titleSo: sec.titleSo,
                            titleAr: sec.titleAr,
                          }),
                        });
                        void loadTabData();
                      }}
                      className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded w-full sm:w-auto shrink-0 ${
                        sec.isEnabled ? 'bg-[#0376B8] text-white' : 'border border-[#CCC4B0] dark:border-slate-700'
                      }`}
                    >
                      {sec.isEnabled ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                ))}
              </div>
            ) : activeTab === 'reports' && overview ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminReports')}</h2>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 sm:flex-none min-h-[38px] px-2.5 py-1.5 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950" />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 sm:flex-none min-h-[38px] px-2.5 py-1.5 text-xs rounded border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-950" />
                    <button
                      type="button"
                      onClick={exportSalesCsv}
                      className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded bg-[#0376B8] hover:bg-[#025E94] text-white"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                <div className="p-3.5 sm:p-5 rounded-lg bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 space-y-3">
                  <h3 className="font-semibold">Popular Books (Verified Sales)</h3>
                  <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800">
                    {overview.reports.popularBooks.map((pb) => (
                      <div key={pb.bookId} className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1 text-sm">
                        <span className="min-w-0 break-words">{pb.title} — <span className="text-slate-500">{pb.author}</span></span>
                        <span className="font-mono-tabular shrink-0">{pb.salesCount} sales · {formatMoney(pb.revenueCents, 'USD', language)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'logs' ? (
              <div className="space-y-4">
                <h2 className="font-display text-xl sm:text-2xl font-semibold">{t('adminLogs')}</h2>
                <div className="divide-y divide-[#E5E0CE] dark:divide-slate-800 bg-[#FAF9F5] dark:bg-slate-950/60 border border-[#D8D1BE] dark:border-slate-800 rounded-lg">
                  {logs.map((l) => (
                    <div key={l.id} className="p-3.5 text-xs flex flex-col sm:flex-row sm:justify-between gap-1.5 sm:gap-4">
                      <div className="min-w-0 break-words">
                        <span className="font-semibold">{l.action}</span> · {l.entityType} ({l.entityId})
                        <div className="text-slate-500 break-all">{l.actorEmail || l.actorUserId}</div>
                      </div>
                      <span className="font-mono-tabular text-slate-400 shrink-0">{formatLocalizedDate(l.createdAt, language)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </>
  );
};
