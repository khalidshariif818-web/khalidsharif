import type {
  AccountStatus,
  AdminActivityLog,
  AdminCustomerDetails,
  AdminCustomerListItem,
  AdminReviewItem,
  AdminUserBookAccessItem,
  Book,
  BookReview,
  BookStatus,
  Bookmark,
  CartItem,
  Category,
  ContactChannel,
  DiscountCodeEntry,
  Entitlement,
  GatewayMode,
  HomepageSection,
  LanguageCode,
  NotificationItem,
  Order,
  PaginatedResult,
  PaymentGatewayCredentialsView,
  PaymentProviderConfig,
  PaymentRecord,
  PaymentStatus,
  Promotion,
  PromotionDiscountType,
  PromotionScope,
  ReadingProgress,
  ThemeMode,
  UserProfile,
  UserRole,
} from '../../shared/types.ts';

export interface StoredGatewayCredentials {
  gatewayMode: GatewayMode;
  gatewayUrl: string;
  merchantId: string;
  apiVersion: string;
  apiKey: string;
  webhookSecret: string;
}

export interface GatewayEnvFallback {
  gatewayUrl: string;
  merchantId: string;
  apiKey: string;
  webhookSecret: string;
  sessionSecret: string;
  gatewayEncryptionKey?: string;
  appUrl: string;
}

export interface ILibraryRepository {
  // ---- AUTH & PROFILES ----
  createCustomerUser(params: {
    email: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage: LanguageCode;
  }): Promise<UserProfile>;

  findAuthCredentialsByEmail(email: string): Promise<{
    id: string;
    passwordHash: string;
    accountStatus: string;
  } | null>;

  getUserProfileById(userId: string): Promise<UserProfile | null>;
  getUserRoles(userId: string): Promise<UserRole[]>;
  isAdmin(userId: string): Promise<boolean>;
  grantAdminRole(userId: string, grantedBy: string | null, role?: 'admin' | 'super_admin'): Promise<void>;
  hasAnyAdmin(): Promise<boolean>;

  setupFirstAdminAtomic(params: {
    email: string;
    rawPassword: string;
    passwordHash: string;
    verifyPasswordFn: (raw: string, hash: string) => boolean;
    fullName: string;
    preferredLanguage: LanguageCode;
  }): Promise<UserProfile>;

  updateProfile(
    userId: string,
    input: {
      fullName: string;
      preferredLanguage: LanguageCode;
      preferredTheme: ThemeMode;
      emailNotifications: boolean;
    }
  ): Promise<UserProfile>;

  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  getSessionVersion(userId: string): Promise<number>;
  incrementSessionVersion(userId: string): Promise<number>;
  consumeSingleUseToken(
    jtiHash: string,
    tokenType: 'password_reset' | 'email_verify',
    expiresAtIso: string
  ): Promise<boolean>;
  countActiveSuperAdmins(): Promise<number>;

  // ---- CATEGORIES ----
  listCategories(includeUnpublished?: boolean): Promise<Category[]>;
  getCategoryBySlug(slug: string, includeUnpublished?: boolean): Promise<Category | null>;
  upsertCategory(
    id: string | null,
    data: {
      slug: string;
      nameEn: string;
      nameSo: string;
      nameAr: string;
      descriptionEn: string;
      descriptionSo: string;
      descriptionAr: string;
      imageUrl?: string | null;
      seoTitle?: string | null;
      seoDescription?: string | null;
      sortOrder: number;
      isPublished: boolean;
    }
  ): Promise<Category>;
  deleteCategory(categoryId: string): Promise<void>;

  // ---- BOOKS & CATALOG ----
  listBooks(params: {
    search?: string;
    categorySlug?: string;
    priceFilter?: 'all' | 'free' | 'paid';
    language?: string;
    sort?: 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'alpha';
    page?: number;
    pageSize?: number;
    includeNonPublished?: boolean;
    featuredOnly?: boolean;
    recommendedOnly?: boolean;
  }): Promise<{ items: Book[]; total: number; page: number; pageSize: number }>;

  getBookBySlugOrId(slugOrId: string, includeNonPublished?: boolean): Promise<Book | null>;
  getRelatedBooks(book: Book, limit?: number): Promise<Book[]>;
  upsertBook(
    id: string | null,
    actorUserId: string,
    data: {
      title: string;
      subtitle?: string;
      slug: string;
      author: string;
      description: string;
      categoryId: string;
      language: LanguageCode;
      publicationYear?: number | null;
      publisher?: string;
      isbn?: string | null;
      pageCount?: number | null;
      samplePageCount?: number;
      isFree: boolean;
      priceCents: number;
      salePriceCents?: number | null;
      status: Book['status'];
      isFeatured: boolean;
      isRecommended: boolean;
      watermarkEnabled: boolean;
      coverUrl?: string | null;
    }
  ): Promise<Book>;
  archiveBook(bookId: string): Promise<void>;
  attachBookPdfFile(params: {
    bookId: string;
    storagePath: string;
    originalFilename: string;
    fileSizeBytes: number;
    checksum: string;
  }): Promise<void>;
  getActiveBookFile(bookId: string): Promise<{
    storagePath: string;
    originalFilename: string;
    fileSizeBytes: number;
  } | null>;

  // ---- REVIEWS ----
  listReviewsForBook(bookId: string): Promise<BookReview[]>;
  upsertReview(userId: string, bookId: string, rating: number, comment: string): Promise<BookReview>;

  // ---- WISHLIST ----
  getWishlist(userId: string): Promise<Book[]>;
  addToWishlist(userId: string, bookId: string): Promise<void>;
  removeFromWishlist(userId: string, bookId: string): Promise<void>;

  // ---- CART ----
  getCartItems(userId: string): Promise<CartItem[]>;
  addToCart(userId: string, bookId: string): Promise<void>;
  removeFromCart(userId: string, bookId: string): Promise<void>;
  clearCart(userId: string): Promise<void>;

  // ---- ENTITLEMENTS & LIBRARY ----
  hasActiveEntitlement(userId: string, bookId: string): Promise<boolean>;
  claimFreeBook(userId: string, bookId: string): Promise<Entitlement>;
  listLibraryBooks(
    userId: string
  ): Promise<Array<{ book: Book; entitlement: Entitlement; progress: ReadingProgress | null }>>;

  // ---- READER PROGRESS, BOOKMARKS & HISTORY ----
  getReaderState(
    userId: string,
    bookId: string
  ): Promise<{ progress: ReadingProgress | null; bookmarks: Bookmark[] }>;
  saveReadingProgress(
    userId: string,
    bookId: string,
    currentPage: number,
    totalPages: number
  ): Promise<ReadingProgress>;
  addBookmark(userId: string, bookId: string, pageNumber: number, label: string): Promise<Bookmark[]>;
  deleteBookmark(userId: string, bookId: string, bookmarkId: string): Promise<Bookmark[]>;
  listReadingHistory(
    userId: string
  ): Promise<Array<{ book: Book; progress: ReadingProgress | null; lastOpenedAt: string }>>;

  // ---- COMMERCE, ORDERS & PAYMENTS ----
  getDiscountRatePercent(code?: string): Promise<number>;
  listDiscountCodes(): Promise<DiscountCodeEntry[]>;
  saveDiscountCodes(entries: DiscountCodeEntry[], updatedBy?: string | null): Promise<DiscountCodeEntry[]>;
  listContactChannels(includeDisabled?: boolean): Promise<ContactChannel[]>;
  saveContactChannels(channels: ContactChannel[], updatedBy?: string | null): Promise<ContactChannel[]>;

  listPaymentProviders(): Promise<PaymentProviderConfig[]>;
  createManualPaymentProvider(input: {
    code: string;
    displayName: string;
    accountNumber: string;
    instructionsEn: string;
    instructionsSo: string;
    instructionsAr: string;
  }): Promise<PaymentProviderConfig>;
  updatePaymentProviderConfig(
    code: string,
    updates: { isEnabled: boolean; instructionsEn: string; instructionsSo: string; instructionsAr: string; ussdTemplate?: string; accountNumber?: string }
  ): Promise<PaymentProviderConfig>;
  getResolvedGatewayConfig(
    providerCode: string,
    envFallback: GatewayEnvFallback
  ): Promise<StoredGatewayCredentials & { source: 'admin' | 'env' | 'none' }>;
  getGatewayCredentialsAdminView(
    providerCode: string,
    envFallback: GatewayEnvFallback
  ): Promise<PaymentGatewayCredentialsView>;
  saveGatewayCredentials(
    providerCode: string,
    input: {
      gatewayMode: GatewayMode;
      gatewayUrl: string;
      merchantId: string;
      apiVersion?: string;
      apiKey?: string;
      webhookSecret?: string;
      clearSecrets?: boolean;
    },
    envFallback: GatewayEnvFallback,
    updatedBy?: string
  ): Promise<PaymentGatewayCredentialsView>;

  createAuthoritativeOrder(params: {
    userId: string;
    bookIds: string[];
    paymentMethodCode: string;
    discountCode?: string;
    billingEmail?: string;
    billingPhone?: string;
    notes?: string;
  }): Promise<{ order: Order; payment: PaymentRecord }>;
  updatePaymentInitiation(
    paymentId: string,
    providerPaymentId: string | null,
    status: PaymentStatus,
    gatewayMetadata?: Record<string, unknown>
  ): Promise<void>;
  getPaymentGatewayMetadata(paymentId: string): Promise<Record<string, unknown>>;
  submitManualPaymentReference(userId: string, orderId: string, customerReference: string): Promise<Order>;
  processVerifiedPaymentAtomic(params: {
    paymentId: string;
    providerPaymentId?: string | null;
    verifiedByAdminId?: string | null;
  }): Promise<{ alreadyVerified: boolean; order: Order }>;
  markPaymentFailedOrCancelled(params: {
    paymentId: string;
    targetStatus: 'failed' | 'cancelled' | 'refunded';
    reason?: string;
    actorAdminId?: string | null;
  }): Promise<Order>;
  recordWebhookEventIfNew(params: {
    providerCode: string;
    externalEventId: string;
    eventType: string;
    signatureVerified: boolean;
    paymentId: string | null;
    payload: unknown;
  }): Promise<boolean>;
  findPaymentByTransactionReference(txRef: string): Promise<PaymentRecord | null>;
  getOrderById(orderId: string): Promise<Order | null>;
  listOrdersForUser(userId: string): Promise<Order[]>;

  // ---- NOTIFICATIONS & HOMEPAGE ----
  listNotifications(userId: string): Promise<NotificationItem[]>;
  markNotificationRead(userId: string, notificationId: string): Promise<void>;
  listHomepageSections(includeDisabled?: boolean): Promise<HomepageSection[]>;
  updateHomepageSection(
    id: string,
    data: { isEnabled: boolean; sortOrder: number; titleEn: string; titleSo: string; titleAr: string }
  ): Promise<void>;

  // ---- ADMIN METRICS, LOGS, CUSTOMERS & REPORTS ----
  logAdminAction(params: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void>;
  getAdminMetrics(
    startDate?: string,
    endDate?: string
  ): Promise<{
    totalBooks: number;
    publishedBooks: number;
    draftBooks: number;
    registeredCustomers: number;
    totalOrders: number;
    paidOrders: number;
    pendingPayments: number;
    failedPayments: number;
    verifiedRevenueCents: number;
  }>;
  listAllOrders(statusFilter?: string): Promise<Order[]>;
  listOrdersPaginated(params: {
    statusFilter?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<Order>>;
  listAllOrdersForExport(params?: { statusFilter?: string; search?: string }): Promise<Order[]>;
  listCustomers(search?: string, statusFilter?: 'all' | AccountStatus): Promise<AdminCustomerListItem[]>;
  listCustomersPaginated(params: {
    search?: string;
    statusFilter?: 'all' | AccountStatus;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<AdminCustomerListItem>>;
  listAllCustomersForExport(params?: {
    search?: string;
    statusFilter?: 'all' | AccountStatus;
  }): Promise<AdminCustomerListItem[]>;
  getAdminCustomerDetails(targetUserId: string): Promise<AdminCustomerDetails | null>;
  adminCreateUser(params: {
    email: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage: LanguageCode;
    accountStatus: AccountStatus;
    isAdmin: boolean;
    grantAll: boolean;
    bookIds: string[];
    grantedByUserId: string;
  }): Promise<UserProfile>;
  adminUpdateCustomer(
    targetUserId: string,
    input: {
      fullName: string;
      preferredLanguage: LanguageCode;
      accountStatus: AccountStatus;
      newPasswordHash?: string;
    }
  ): Promise<UserProfile>;
  adminGrantBooksToUser(params: {
    targetUserId: string;
    grantAll: boolean;
    bookIds: string[];
    grantedByUserId: string;
    reason?: string;
  }): Promise<AdminUserBookAccessItem[]>;
  adminRevokeBookFromUser(targetUserId: string, bookId: string): Promise<AdminUserBookAccessItem[]>;
  adminRevokeAllGrantedBooksFromUser(targetUserId: string): Promise<AdminUserBookAccessItem[]>;
  quickUpdateBook(
    bookId: string,
    updates: {
      isFree?: boolean;
      priceCents?: number;
      salePriceCents?: number | null;
      samplePageCount?: number;
      status?: BookStatus;
      watermarkEnabled?: boolean;
      coverUrl?: string | null;
    }
  ): Promise<Book>;
  listPromotions(activeOnly?: boolean): Promise<Promotion[]>;
  upsertPromotion(
    id: string | null,
    data: {
      name: string;
      scope: PromotionScope;
      targetId: string | null;
      discountType: PromotionDiscountType;
      discountValue: number;
      startsAt: string | null;
      endsAt: string | null;
      isActive: boolean;
    }
  ): Promise<Promotion>;
  deletePromotion(promotionId: string): Promise<void>;
  listAdminLogs(): Promise<AdminActivityLog[]>;
  getSalesReport(
    startDate?: string,
    endDate?: string
  ): Promise<{
    popularBooks: Array<{ bookId: string; title: string; author: string; salesCount: number; revenueCents: number }>;
    dailyRevenue: Array<{ day: string; orderCount: number; revenueCents: number }>;
  }>;
  listAllReviews(): Promise<AdminReviewItem[]>;
  setReviewPublished(reviewId: string, isPublished: boolean): Promise<void>;
  deleteReview(reviewId: string): Promise<void>;
  updateCustomerStatus(targetUserId: string, accountStatus: AccountStatus): Promise<UserProfile>;
  setUserAdminRole(targetUserId: string, makeAdmin: boolean, grantedByUserId: string): Promise<UserProfile>;

  // ---- DISTRIBUTED RATE LIMITING ----
  consumeRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }>;
}
