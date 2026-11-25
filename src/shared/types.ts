export type LanguageCode = 'so' | 'en' | 'ar';
export type ThemeMode = 'light' | 'dark';
export type UserRole = 'customer' | 'admin' | 'super_admin';
export type AccountStatus = 'active' | 'paused' | 'suspended';
export type BookStatus = 'draft' | 'published' | 'archived';

export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus =
  | 'initiated'
  | 'pending_verification'
  | 'processing'
  | 'verified'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  preferredLanguage: LanguageCode;
  preferredTheme: ThemeMode;
  emailNotifications: boolean;
  accountStatus: AccountStatus;
  roles: UserRole[];
  createdAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Category {
  id: string;
  slug: string;
  nameEn: string;
  nameSo: string;
  nameAr: string;
  descriptionEn: string;
  descriptionSo: string;
  descriptionAr: string;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: number;
  isPublished: boolean;
  bookCount?: number;
}

export interface Book {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  description: string;
  categoryId: string;
  categorySlug?: string;
  categoryNameEn?: string;
  categoryNameSo?: string;
  categoryNameAr?: string;
  language: LanguageCode;
  publicationYear: number | null;
  publisher: string;
  isbn: string | null;
  pageCount: number | null;
  samplePageCount: number;
  fileFormat: string;
  coverUrl: string | null;
  isFree: boolean;
  priceCents: number;
  salePriceCents: number | null;
  effectivePriceCents?: number;
  promotionLabel?: string | null;
  currency: string;
  status: BookStatus;
  isFeatured: boolean;
  isRecommended: boolean;
  popularityScore: number;
  watermarkEnabled: boolean;
  hasPdfFile?: boolean;
  averageRating?: number;
  reviewCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type PromotionScope = 'library' | 'category' | 'book';
export type PromotionDiscountType = 'percent' | 'fixed_cents';

export interface Promotion {
  id: string;
  name: string;
  scope: PromotionScope;
  targetId: string | null;
  discountType: PromotionDiscountType;
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookReview {
  id: string;
  bookId: string;
  userId: string;
  reviewerName: string;
  rating: number;
  comment: string;
  verifiedPurchase?: boolean;
  createdAt: string;
}

export interface Entitlement {
  id: string;
  userId: string;
  bookId: string;
  sourceType: 'purchase' | 'free_claim' | 'admin_grant';
  orderId: string | null;
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;
}

export interface AdminUserBookAccessItem {
  bookId: string;
  title: string;
  author: string;
  isFree: boolean;
  priceCents: number;
  currency: string;
  bookStatus: BookStatus;
  sourceType: Entitlement['sourceType'];
  status: Entitlement['status'];
  grantedAt: string;
}

export interface ReadingProgress {
  bookId: string;
  currentPage: number;
  totalPages: number;
  progressPercent: number;
  lastReadAt: string;
}

export interface Bookmark {
  id: string;
  bookId: string;
  pageNumber: number;
  label: string;
  createdAt: string;
}

export interface CartItem {
  id: string;
  bookId: string;
  book: Book;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  bookId: string;
  bookTitleSnapshot: string;
  unitPriceCents: number;
  coverUrl?: string | null;
  author?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  providerCode: string;
  transactionReference: string;
  providerPaymentId: string | null;
  customerSubmittedReference: string | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  verifiedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  orderReference: string;
  userId: string;
  customerEmail?: string;
  customerName?: string;
  billingEmail?: string;
  billingPhone?: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  paymentMethodCode: string;
  notes: string;
  items: OrderItem[];
  payment?: PaymentRecord | null;
  createdAt: string;
  updatedAt: string;
}

export type GatewayMode = 'mpgs_hosted' | 'rest_redirect';

export interface PaymentGatewayCredentialsView {
  gatewayMode: GatewayMode;
  gatewayUrl: string;
  merchantId: string;
  apiVersion: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasWebhookSecret: boolean;
  webhookSecretMasked: string;
  source: 'admin' | 'env' | 'none';
  webhookCallbackUrl: string;
}

export interface PaymentProviderConfig {
  code: string;
  displayName: string;
  providerType: 'online_gateway' | 'manual';
  isEnabled: boolean;
  isConnected: boolean;
  instructionsEn: string;
  instructionsSo: string;
  instructionsAr: string;
  missingRequirements?: string[];
  publicConfig: Record<string, unknown>;
  credentials?: PaymentGatewayCredentialsView;
}

export interface AdminReviewItem {
  id: string;
  bookId: string;
  bookTitle: string;
  userId: string;
  reviewerName: string;
  reviewerEmail: string;
  rating: number;
  comment: string;
  isPublished: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'purchase_confirmed' | 'payment_update' | 'new_book' | 'account';
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface HomepageSection {
  id: string;
  sectionKey: string;
  titleEn: string;
  titleSo: string;
  titleAr: string;
  sortOrder: number;
  isEnabled: boolean;
}

export interface AdminActivityLog {
  id: string;
  actorUserId: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type ContactChannelType =
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'address'
  | 'telegram'
  | 'facebook'
  | 'instagram'
  | 'twitter'
  | 'youtube'
  | 'website'
  | 'hours'
  | 'other';

export interface ContactChannel {
  id: string;
  type: ContactChannelType;
  label: string;
  value: string;
  url?: string;
  isPrimary: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

export interface DiscountCodeEntry {
  code: string;
  percent: number;
}

export interface AdminCustomerListItem extends UserProfile {
  orderCount: number;
  totalSpentCents: number;
  activeBooksCount: number;
}

export interface AdminCustomerDetails {
  customer: AdminCustomerListItem;
  entitlements: AdminUserBookAccessItem[];
  orders: Order[];
}
