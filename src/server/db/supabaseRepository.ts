import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateAuthoritativeOrderTotals,
  isPromotionCurrentlyActive,
  resolveBookEffectivePricing,
} from '../../shared/commerce.ts';
import { decryptGatewayPayload, encryptGatewayPayload, maskSecretValue } from '../services/secrets.ts';
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
  OrderItem,
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
import type { GatewayEnvFallback, ILibraryRepository, StoredGatewayCredentials } from './interface.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

function parseJsonValue<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

function mapCategoryRow(
  r: Record<string, unknown>,
  bookCount?: number
): Category {
  return {
    id: String(r.id),
    slug: String(r.slug),
    nameEn: String(r.name_en),
    nameSo: String(r.name_so),
    nameAr: String(r.name_ar),
    descriptionEn: String(r.description_en || ''),
    descriptionSo: String(r.description_so || ''),
    descriptionAr: String(r.description_ar || ''),
    imageUrl: r.image_url ? String(r.image_url) : null,
    seoTitle: r.seo_title ? String(r.seo_title) : null,
    seoDescription: r.seo_description ? String(r.seo_description) : null,
    sortOrder: Number(r.sort_order || 0),
    isPublished: Boolean(r.is_published),
    bookCount,
  };
}

interface BookMetaStats {
  hasPdfFile: boolean;
  averageRating?: number;
  reviewCount?: number;
}

function mapBookRow(
  r: Record<string, unknown>,
  cat?: Record<string, unknown> | null,
  stats?: BookMetaStats,
  activePromotions: Promotion[] = []
): Book {
  const joinedCat = cat ?? ((r.categories as Record<string, unknown> | null | undefined) ?? null);
  const book: Book = {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    subtitle: String(r.subtitle || ''),
    author: String(r.author),
    description: String(r.description),
    categoryId: String(r.category_id),
    categorySlug: joinedCat?.slug ? String(joinedCat.slug) : undefined,
    categoryNameEn: joinedCat?.name_en ? String(joinedCat.name_en) : undefined,
    categoryNameSo: joinedCat?.name_so ? String(joinedCat.name_so) : undefined,
    categoryNameAr: joinedCat?.name_ar ? String(joinedCat.name_ar) : undefined,
    language: r.language as LanguageCode,
    publicationYear: r.publication_year !== null && r.publication_year !== undefined ? Number(r.publication_year) : null,
    publisher: String(r.publisher || 'Khalid Sharif Press'),
    isbn: r.isbn ? String(r.isbn) : null,
    pageCount: r.page_count !== null && r.page_count !== undefined ? Number(r.page_count) : null,
    samplePageCount: r.sample_page_count !== null && r.sample_page_count !== undefined ? Number(r.sample_page_count) : 0,
    fileFormat: String(r.file_format || 'PDF'),
    coverUrl: r.cover_url ? String(r.cover_url) : null,
    isFree: Boolean(r.is_free),
    priceCents: Number(r.price_cents),
    salePriceCents:
      r.sale_price_cents !== null && r.sale_price_cents !== undefined ? Number(r.sale_price_cents) : null,
    currency: String(r.currency || 'USD'),
    status: r.status as Book['status'],
    isFeatured: Boolean(r.is_featured),
    isRecommended: Boolean(r.is_recommended),
    popularityScore: Number(r.popularity_score || 0),
    watermarkEnabled: Boolean(r.watermark_enabled),
    hasPdfFile: stats ? stats.hasPdfFile : Boolean(r.has_pdf_file),
    averageRating: stats?.averageRating,
    reviewCount: stats?.reviewCount,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
  const pricing = resolveBookEffectivePricing(book, activePromotions);
  book.effectivePriceCents = pricing.effectivePriceCents;
  book.promotionLabel = pricing.discountLabel;
  return book;
}

function mapPromotionRow(r: Record<string, unknown>): Promotion {
  return {
    id: String(r.id),
    name: String(r.name),
    scope: r.scope as PromotionScope,
    targetId: r.target_id ? String(r.target_id) : null,
    discountType: r.discount_type as PromotionDiscountType,
    discountValue: Number(r.discount_value),
    startsAt: r.starts_at ? String(r.starts_at) : null,
    endsAt: r.ends_at ? String(r.ends_at) : null,
    isActive: Boolean(r.is_active),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class SupabaseLibraryRepository implements ILibraryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private assertOk<T>(data: T | null, error: { message: string } | null, fallbackMsg: string): T {
    if (error) {
      throw new Error(`${fallbackMsg}: ${error.message}`);
    }
    if (data === null || data === undefined) {
      throw new Error(fallbackMsg);
    }
    return data;
  }

  private async enrichBookStats(bookIds: string[]): Promise<Map<string, BookMetaStats>> {
    const map = new Map<string, BookMetaStats>();
    for (const id of bookIds) {
      map.set(id, { hasPdfFile: false });
    }
    if (bookIds.length === 0) return map;

    const [{ data: fileRows }, { data: reviewRows }] = await Promise.all([
      this.supabase.from('book_files').select('book_id').in('book_id', bookIds).eq('is_active', true),
      this.supabase.from('reviews').select('book_id, rating').in('book_id', bookIds).eq('is_published', true),
    ]);

    for (const f of fileRows || []) {
      const existing = map.get(String(f.book_id));
      if (existing) existing.hasPdfFile = true;
    }

    const revAgg = new Map<string, { sum: number; count: number }>();
    for (const rv of reviewRows || []) {
      const bId = String(rv.book_id);
      const cur = revAgg.get(bId) || { sum: 0, count: 0 };
      cur.sum += Number(rv.rating);
      cur.count += 1;
      revAgg.set(bId, cur);
    }
    for (const [bId, agg] of revAgg.entries()) {
      const existing = map.get(bId);
      if (existing && agg.count > 0) {
        existing.averageRating = Math.round((agg.sum / agg.count) * 10) / 10;
        existing.reviewCount = agg.count;
      }
    }

    return map;
  }

  // ---- AUTH & PROFILES ----
  async createCustomerUser(params: {
    email: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage: LanguageCode;
  }): Promise<UserProfile> {
    const normalizedEmail = params.email.toLowerCase().trim();
    const { data: existing } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .insert({
        email: normalizedEmail,
        password_hash: params.passwordHash,
        full_name: params.fullName,
        preferred_language: params.preferredLanguage,
        email_verified: false,
      })
      .select('id')
      .single();

    if (error) {
      if (error.message.toLowerCase().includes('duplicate') || error.code === '23505') {
        throw new Error('EMAIL_EXISTS');
      }
      throw new Error(`Failed to create user profile: ${error.message}`);
    }

    const userId = String(profile.id);
    await Promise.all([
      this.supabase.from('user_roles').upsert({ user_id: userId, role: 'customer' }, { onConflict: 'user_id,role' }),
      this.supabase.from('wishlists').upsert({ user_id: userId }, { onConflict: 'user_id' }),
      this.supabase.from('carts').upsert({ user_id: userId }, { onConflict: 'user_id' }),
    ]);

    return (await this.getUserProfileById(userId))!;
  }

  async findAuthCredentialsByEmail(email: string): Promise<{
    id: string;
    passwordHash: string;
    accountStatus: string;
  } | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, password_hash, account_status')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: String(data.id),
      passwordHash: String(data.password_hash || ''),
      accountStatus: String(data.account_status),
    };
  }

  async getUserProfileById(userId: string): Promise<UserProfile | null> {
    if (!isUuid(userId)) return null;
    const { data: row, error } = await this.supabase
      .from('profiles')
      .select('id, email, email_verified, full_name, preferred_language, preferred_theme, email_notifications, account_status, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error || !row) return null;
    const roles = await this.getUserRoles(userId);
    return {
      id: String(row.id),
      email: String(row.email),
      emailVerified: Boolean(row.email_verified),
      fullName: String(row.full_name || ''),
      preferredLanguage: row.preferred_language as LanguageCode,
      preferredTheme: row.preferred_theme as ThemeMode,
      emailNotifications: Boolean(row.email_notifications),
      accountStatus: row.account_status as AccountStatus,
      roles,
      createdAt: String(row.created_at),
    };
  }

  async getUserRoles(userId: string): Promise<UserRole[]> {
    if (!isUuid(userId)) return [];
    const { data } = await this.supabase.from('user_roles').select('role').eq('user_id', userId);
    return (data || []).map((r) => r.role as UserRole);
  }

  async isAdmin(userId: string): Promise<boolean> {
    const roles = await this.getUserRoles(userId);
    return roles.includes('admin') || roles.includes('super_admin');
  }

  async grantAdminRole(userId: string, grantedBy: string | null, role: 'admin' | 'super_admin' = 'admin'): Promise<void> {
    const { error } = await this.supabase
      .from('user_roles')
      .upsert({ user_id: userId, role, granted_by: grantedBy }, { onConflict: 'user_id,role' });
    if (error) throw new Error(`Failed to grant admin role: ${error.message}`);
  }

  async hasAnyAdmin(): Promise<boolean> {
    const { count } = await this.supabase
      .from('user_roles')
      .select('*', { count: 'exact', head: true })
      .in('role', ['admin', 'super_admin']);
    return (count ?? 0) > 0;
  }

  async setupFirstAdminAtomic(params: {
    email: string;
    rawPassword: string;
    passwordHash: string;
    verifyPasswordFn: (raw: string, hash: string) => boolean;
    fullName: string;
    preferredLanguage: LanguageCode;
  }): Promise<UserProfile> {
    const existing = await this.findAuthCredentialsByEmail(params.email);
    if (existing && !params.verifyPasswordFn(params.rawPassword, existing.passwordHash)) {
      throw new Error('EXISTING_ACCOUNT_PASSWORD_MISMATCH');
    }

    const { data: userId, error } = await this.supabase.rpc('setup_first_admin_atomic', {
      p_email: params.email,
      p_password_hash: params.passwordHash,
      p_full_name: params.fullName,
      p_preferred_language: params.preferredLanguage,
      p_existing_user_id: existing?.id ?? null,
    });

    if (error) {
      if (error.message.includes('ADMIN_ALREADY_EXISTS')) {
        throw new Error('ADMIN_ALREADY_EXISTS');
      }
      throw new Error(`Admin setup failed: ${error.message}`);
    }

    return (await this.getUserProfileById(String(userId)))!;
  }

  async updateProfile(
    userId: string,
    input: {
      fullName: string;
      preferredLanguage: LanguageCode;
      preferredTheme: ThemeMode;
      emailNotifications: boolean;
    }
  ): Promise<UserProfile> {
    const { error } = await this.supabase
      .from('profiles')
      .update({
        full_name: input.fullName,
        preferred_language: input.preferredLanguage,
        preferred_theme: input.preferredTheme,
        email_notifications: input.emailNotifications,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) throw new Error(`Failed to update profile: ${error.message}`);
    return (await this.getUserProfileById(userId))!;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const currentSv = await this.getSessionVersion(userId);
    const { error } = await this.supabase
      .from('profiles')
      .update({
        password_hash: passwordHash,
        session_version: currentSv + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) throw new Error(`Failed to update password: ${error.message}`);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.supabase
      .from('profiles')
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq('id', userId);
  }

  async getSessionVersion(userId: string): Promise<number> {
    if (!isUuid(userId)) return 1;
    const { data } = await this.supabase
      .from('profiles')
      .select('session_version')
      .eq('id', userId)
      .maybeSingle();
    return Number((data as { session_version?: number } | null)?.session_version ?? 1);
  }

  async incrementSessionVersion(userId: string): Promise<number> {
    if (!isUuid(userId)) return 1;
    const current = await this.getSessionVersion(userId);
    const next = current + 1;
    await this.supabase
      .from('profiles')
      .update({ session_version: next, updated_at: new Date().toISOString() })
      .eq('id', userId);
    return next;
  }

  async consumeSingleUseToken(
    jtiHash: string,
    tokenType: 'password_reset' | 'email_verify',
    expiresAtIso: string
  ): Promise<boolean> {
    const { error } = await this.supabase.from('consumed_tokens').insert({
      jti_hash: jtiHash,
      token_type: tokenType,
      expires_at: expiresAtIso,
    });
    return !error;
  }

  async countActiveSuperAdmins(): Promise<number> {
    const { data: roleRows } = await this.supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'super_admin');
    const userIds = Array.from(new Set((roleRows || []).map((r) => String(r.user_id))));
    if (userIds.length === 0) return 0;
    const { data: activeRows } = await this.supabase
      .from('profiles')
      .select('id')
      .in('id', userIds)
      .eq('account_status', 'active');
    return (activeRows || []).length;
  }

  // ---- CATEGORIES ----
  async listCategories(includeUnpublished = false): Promise<Category[]> {
    let query = this.supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name_en', { ascending: true });

    if (!includeUnpublished) {
      query = query.eq('is_published', true);
    }

    const [{ data: catRows, error }, { data: pubBooks }] = await Promise.all([
      query,
      this.supabase.from('books').select('category_id').eq('status', 'published'),
    ]);
    if (error) throw new Error(`Failed to load categories: ${error.message}`);

    const counts = new Map<string, number>();
    for (const b of pubBooks || []) {
      const cid = String(b.category_id);
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }

    return (catRows || []).map((r) => mapCategoryRow(r as Record<string, unknown>, counts.get(String(r.id)) || 0));
  }

  async getCategoryBySlug(slug: string, includeUnpublished = false): Promise<Category | null> {
    let query = this.supabase.from('categories').select('*').eq('slug', slug);
    if (!includeUnpublished) {
      query = query.eq('is_published', true);
    }
    const { data: row } = await query.maybeSingle();
    if (!row) return null;

    const { count } = await this.supabase
      .from('books')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', row.id)
      .eq('status', 'published');

    return mapCategoryRow(row as Record<string, unknown>, count ?? 0);
  }

  async upsertCategory(
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
  ): Promise<Category> {
    const payload = {
      slug: data.slug,
      name_en: data.nameEn,
      name_so: data.nameSo,
      name_ar: data.nameAr,
      description_en: data.descriptionEn,
      description_so: data.descriptionSo,
      description_ar: data.descriptionAr,
      image_url: data.imageUrl || null,
      seo_title: data.seoTitle || null,
      seo_description: data.seoDescription || null,
      sort_order: data.sortOrder,
      is_published: data.isPublished,
      updated_at: new Date().toISOString(),
    };

    const res = id
      ? await this.supabase.from('categories').update(payload).eq('id', id).select('*').single()
      : await this.supabase.from('categories').insert(payload).select('*').single();

    const row = this.assertOk(res.data, res.error, 'Failed to save category');
    return mapCategoryRow(row as Record<string, unknown>);
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const { count } = await this.supabase
      .from('books')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if ((count ?? 0) > 0) {
      throw new Error('CATEGORY_HAS_BOOKS');
    }
    const { error } = await this.supabase.from('categories').delete().eq('id', categoryId);
    if (error) throw new Error(`Failed to delete category: ${error.message}`);
  }

  // ---- BOOKS & CATALOG ----
  async listBooks(params: {
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
  }): Promise<{ items: Book[]; total: number; page: number; pageSize: number }> {
    let categoryIdFilter: string | null = null;
    if (params.categorySlug && params.categorySlug !== 'all') {
      const { data: cat } = await this.supabase
        .from('categories')
        .select('id')
        .eq('slug', params.categorySlug)
        .maybeSingle();
      if (!cat) {
        return {
          items: [],
          total: 0,
          page: Math.max(1, params.page || 1),
          pageSize: Math.min(50, Math.max(1, params.pageSize || 12)),
        };
      }
      categoryIdFilter = String(cat.id);
    }

    let query = this.supabase
      .from('books')
      .select('*, categories!category_id(id, slug, name_en, name_so, name_ar)', { count: 'exact' });

    if (!params.includeNonPublished) {
      query = query.eq('status', 'published');
    }
    if (params.featuredOnly) {
      query = query.eq('is_featured', true);
    }
    if (params.recommendedOnly) {
      query = query.eq('is_recommended', true);
    }
    if (categoryIdFilter) {
      query = query.eq('category_id', categoryIdFilter);
    }
    if (params.priceFilter === 'free') {
      query = query.eq('is_free', true);
    } else if (params.priceFilter === 'paid') {
      query = query.eq('is_free', false);
    }
    if (params.language && params.language !== 'all') {
      query = query.eq('language', params.language);
    }
    if (params.search && params.search.trim()) {
      const term = params.search.trim().replace(/[(),]/g, ' ');
      query = query.or(`title.ilike.%${term}%,author.ilike.%${term}%,description.ilike.%${term}%`);
    }

    switch (params.sort) {
      case 'popular':
        query = query.order('popularity_score', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'price_asc':
        query = query.order('price_cents', { ascending: true }).order('title', { ascending: true });
        break;
      case 'price_desc':
        query = query.order('price_cents', { ascending: false }).order('title', { ascending: true });
        break;
      case 'alpha':
        query = query.order('title', { ascending: true });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize || 12));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, count, error } = await query.range(from, to);
    if (error) throw new Error(`Failed to list books: ${error.message}`);

    const list = (rows || []) as Array<Record<string, unknown>>;
    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(list.map((r) => String(r.id))),
      this.listPromotions(true),
    ]);

    return {
      items: list.map((r) => mapBookRow(r, undefined, stats.get(String(r.id)), activePromotions)),
      total: count ?? list.length,
      page,
      pageSize,
    };
  }

  async getBookBySlugOrId(slugOrId: string, includeNonPublished = false): Promise<Book | null> {
    let query = this.supabase.from('books').select('*, categories!category_id(id, slug, name_en, name_so, name_ar)');
    if (isUuid(slugOrId)) {
      query = query.or(`id.eq.${slugOrId},slug.eq.${slugOrId}`);
    } else {
      query = query.eq('slug', slugOrId);
    }
    if (!includeNonPublished) {
      query = query.eq('status', 'published');
    }

    const { data: row, error } = await query.maybeSingle();
    if (error || !row) return null;

    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats([String(row.id)]),
      this.listPromotions(true),
    ]);
    return mapBookRow(row as Record<string, unknown>, undefined, stats.get(String(row.id)), activePromotions);
  }

  async getRelatedBooks(book: Book, limit = 4): Promise<Book[]> {
    const { data: rows } = await this.supabase
      .from('books')
      .select('*, categories!category_id(id, slug, name_en, name_so, name_ar)')
      .eq('status', 'published')
      .eq('category_id', book.categoryId)
      .neq('id', book.id)
      .order('popularity_score', { ascending: false })
      .limit(limit);

    const list = (rows || []) as Array<Record<string, unknown>>;
    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(list.map((r) => String(r.id))),
      this.listPromotions(true),
    ]);
    return list.map((r) => mapBookRow(r, undefined, stats.get(String(r.id)), activePromotions));
  }

  async upsertBook(
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
  ): Promise<Book> {
    const salePriceCents = data.isFree ? null : (data.salePriceCents ?? null);
    const basePayload: Record<string, unknown> = {
      title: data.title,
      subtitle: data.subtitle || '',
      slug: data.slug,
      author: data.author,
      description: data.description,
      category_id: data.categoryId,
      language: data.language,
      publication_year: data.publicationYear ?? null,
      publisher: data.publisher || 'Khalid Sharif Press',
      isbn: data.isbn ?? null,
      page_count: data.pageCount ?? null,
      sample_page_count: data.samplePageCount ?? 0,
      is_free: data.isFree,
      price_cents: data.isFree ? 0 : data.priceCents,
      sale_price_cents: salePriceCents,
      status: data.status,
      is_featured: data.isFeatured,
      is_recommended: data.isRecommended,
      watermark_enabled: data.watermarkEnabled,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      if (data.coverUrl !== undefined && data.coverUrl !== null) {
        basePayload.cover_url = data.coverUrl;
      }
      const { data: updated, error } = await this.supabase
        .from('books')
        .update(basePayload)
        .eq('id', id)
        .select('id')
        .single();
      const row = this.assertOk(updated, error, 'Failed to update book');
      return (await this.getBookBySlugOrId(String(row.id), true))!;
    }

    const insertPayload = {
      ...basePayload,
      cover_url: data.coverUrl || null,
      created_by: isUuid(actorUserId) ? actorUserId : null,
    };
    const { data: created, error } = await this.supabase.from('books').insert(insertPayload).select('id').single();
    const row = this.assertOk(created, error, 'Failed to create book');
    return (await this.getBookBySlugOrId(String(row.id), true))!;
  }

  async archiveBook(bookId: string): Promise<void> {
    const { error } = await this.supabase
      .from('books')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', bookId);
    if (error) throw new Error(`Failed to archive book: ${error.message}`);
  }

  async attachBookPdfFile(params: {
    bookId: string;
    storagePath: string;
    originalFilename: string;
    fileSizeBytes: number;
    checksum: string;
  }): Promise<void> {
    await this.supabase.from('book_files').update({ is_active: false }).eq('book_id', params.bookId);
    const { error } = await this.supabase.from('book_files').insert({
      book_id: params.bookId,
      storage_bucket: 'book-pdfs',
      storage_path: params.storagePath,
      original_filename: params.originalFilename,
      mime_type: 'application/pdf',
      file_size_bytes: params.fileSizeBytes,
      sha256_checksum: params.checksum,
      is_active: true,
    });
    if (error) throw new Error(`Failed to attach PDF metadata: ${error.message}`);
  }

  async getActiveBookFile(bookId: string): Promise<{
    storagePath: string;
    originalFilename: string;
    fileSizeBytes: number;
  } | null> {
    const { data } = await this.supabase
      .from('book_files')
      .select('storage_path, original_filename, file_size_bytes')
      .eq('book_id', bookId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      storagePath: String(data.storage_path),
      originalFilename: String(data.original_filename),
      fileSizeBytes: Number(data.file_size_bytes),
    };
  }

  // ---- REVIEWS ----
  async listReviewsForBook(bookId: string): Promise<BookReview[]> {
    const [{ data: rows }, { data: purchRows }, { data: entRows }] = await Promise.all([
      this.supabase
        .from('reviews')
        .select('id, book_id, user_id, rating, comment, created_at, profiles(full_name)')
        .eq('book_id', bookId)
        .eq('is_published', true)
        .order('created_at', { ascending: false }),
      this.supabase.from('purchases').select('user_id').eq('book_id', bookId).eq('status', 'completed'),
      this.supabase
        .from('entitlements')
        .select('user_id')
        .eq('book_id', bookId)
        .eq('status', 'active')
        .eq('source_type', 'purchase'),
    ]);

    const verifiedUsers = new Set<string>();
    for (const p of purchRows || []) verifiedUsers.add(String(p.user_id));
    for (const e of entRows || []) verifiedUsers.add(String(e.user_id));

    return (rows || []).map((r) => {
      const prof = r.profiles as { full_name?: string } | null | undefined;
      return {
        id: String(r.id),
        bookId: String(r.book_id),
        userId: String(r.user_id),
        reviewerName: String(prof?.full_name || 'Reader'),
        rating: Number(r.rating),
        comment: String(r.comment),
        verifiedPurchase: verifiedUsers.has(String(r.user_id)),
        createdAt: String(r.created_at),
      };
    });
  }

  async upsertReview(userId: string, bookId: string, rating: number, comment: string): Promise<BookReview> {
    const { error } = await this.supabase.from('reviews').upsert(
      {
        book_id: bookId,
        user_id: userId,
        rating,
        comment,
        is_published: true,
      },
      { onConflict: 'book_id,user_id' }
    );
    if (error) throw new Error(`Failed to save review: ${error.message}`);
    const list = await this.listReviewsForBook(bookId);
    return list.find((r) => r.userId === userId)!;
  }

  // ---- WISHLIST ----
  async getWishlist(userId: string): Promise<Book[]> {
    const { data: items } = await this.supabase
      .from('wishlist_items')
      .select('book_id, created_at, books!inner(*, categories!category_id(id, slug, name_en, name_so, name_ar))')
      .eq('user_id', userId)
      .eq('books.status', 'published')
      .order('created_at', { ascending: false });

    const books = (items || [])
      .map((i) => i.books as unknown as Record<string, unknown> | null)
      .filter((b): b is Record<string, unknown> => Boolean(b));

    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(books.map((b) => String(b.id))),
      this.listPromotions(true),
    ]);
    return books.map((b) => mapBookRow(b, undefined, stats.get(String(b.id)), activePromotions));
  }

  async addToWishlist(userId: string, bookId: string): Promise<void> {
    let { data: wl } = await this.supabase.from('wishlists').select('id').eq('user_id', userId).maybeSingle();
    if (!wl) {
      const { data: created } = await this.supabase.from('wishlists').insert({ user_id: userId }).select('id').single();
      wl = created;
    }
    if (!wl) throw new Error('Unable to initialize wishlist');
    await this.supabase
      .from('wishlist_items')
      .upsert({ wishlist_id: wl.id, user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' });
  }

  async removeFromWishlist(userId: string, bookId: string): Promise<void> {
    await this.supabase.from('wishlist_items').delete().eq('user_id', userId).eq('book_id', bookId);
  }

  // ---- CART ----
  async getCartItems(userId: string): Promise<CartItem[]> {
    const { data: rows } = await this.supabase
      .from('cart_items')
      .select('id, book_id, created_at, books!inner(*, categories!category_id(id, slug, name_en, name_so, name_ar))')
      .eq('user_id', userId)
      .eq('books.status', 'published')
      .order('created_at', { ascending: false });

    const raw = rows || [];
    const bookIds = raw.map((r) => String(r.book_id));
    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(bookIds),
      this.listPromotions(true),
    ]);

    return raw.map((r) => {
      const bookRow = r.books as unknown as Record<string, unknown>;
      return {
        id: String(r.id),
        bookId: String(r.book_id),
        book: mapBookRow(bookRow, undefined, stats.get(String(r.book_id)), activePromotions),
        createdAt: String(r.created_at),
      };
    });
  }

  async addToCart(userId: string, bookId: string): Promise<void> {
    const book = await this.getBookBySlugOrId(bookId, false);
    if (!book) throw new Error('BOOK_NOT_FOUND');
    if (book.isFree) throw new Error('FREE_BOOK_NO_CART');
    if (await this.hasActiveEntitlement(userId, book.id)) {
      throw new Error('ALREADY_OWNED');
    }

    let { data: cart } = await this.supabase.from('carts').select('id').eq('user_id', userId).maybeSingle();
    if (!cart) {
      const { data: created } = await this.supabase.from('carts').insert({ user_id: userId }).select('id').single();
      cart = created;
    }
    if (!cart) throw new Error('Unable to initialize cart');
    await this.supabase
      .from('cart_items')
      .upsert({ cart_id: cart.id, user_id: userId, book_id: book.id }, { onConflict: 'user_id,book_id' });
  }

  async removeFromCart(userId: string, bookId: string): Promise<void> {
    await this.supabase.from('cart_items').delete().eq('user_id', userId).eq('book_id', bookId);
  }

  async clearCart(userId: string): Promise<void> {
    await this.supabase.from('cart_items').delete().eq('user_id', userId);
  }

  // ---- ENTITLEMENTS & LIBRARY ----
  async hasActiveEntitlement(userId: string, bookId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(bookId)) return false;
    const nowIso = new Date().toISOString();
    const { data } = await this.supabase
      .from('entitlements')
      .select('id')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .maybeSingle();
    return Boolean(data);
  }

  async claimFreeBook(userId: string, bookId: string): Promise<Entitlement> {
    const book = await this.getBookBySlugOrId(bookId, false);
    if (!book || !book.isFree) {
      throw new Error('NOT_FREE_BOOK');
    }

    const { data: row, error } = await this.supabase
      .from('entitlements')
      .upsert(
        {
          user_id: userId,
          book_id: book.id,
          source_type: 'free_claim',
          status: 'active',
        },
        { onConflict: 'user_id,book_id' }
      )
      .select('*')
      .single();

    const saved = this.assertOk(row, error, 'Failed to claim free book');
    return {
      id: String(saved.id),
      userId: String(saved.user_id),
      bookId: String(saved.book_id),
      sourceType: saved.source_type as Entitlement['sourceType'],
      orderId: saved.order_id ? String(saved.order_id) : null,
      status: saved.status as Entitlement['status'],
      grantedAt: String(saved.granted_at),
    };
  }

  async listLibraryBooks(
    userId: string
  ): Promise<Array<{ book: Book; entitlement: Entitlement; progress: ReadingProgress | null }>> {
    const [{ data: entRows }, { data: progRows }] = await Promise.all([
      this.supabase
        .from('entitlements')
        .select('id, source_type, order_id, status, granted_at, books!inner(*, categories!category_id(id, slug, name_en, name_so, name_ar))')
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq('books.status', 'published'),
      this.supabase.from('reading_progress').select('*').eq('user_id', userId),
    ]);

    const progMap = new Map<string, ReadingProgress>();
    for (const p of progRows || []) {
      progMap.set(String(p.book_id), {
        bookId: String(p.book_id),
        currentPage: Number(p.current_page),
        totalPages: Number(p.total_pages),
        progressPercent: Number(p.progress_percent),
        lastReadAt: String(p.last_read_at),
      });
    }

    const list = entRows || [];
    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(
        list.map((e) => String((e.books as unknown as Record<string, unknown>).id))
      ),
      this.listPromotions(true),
    ]);

    const mapped = list.map((e) => {
      const bRow = e.books as unknown as Record<string, unknown>;
      const bookId = String(bRow.id);
      const progress = progMap.get(bookId) || null;
      return {
        book: mapBookRow(bRow, undefined, stats.get(bookId), activePromotions),
        entitlement: {
          id: String(e.id),
          userId,
          bookId,
          sourceType: e.source_type as Entitlement['sourceType'],
          orderId: e.order_id ? String(e.order_id) : null,
          status: e.status as Entitlement['status'],
          grantedAt: String(e.granted_at),
        },
        progress,
      };
    });

    mapped.sort((a, b) => {
      const timeA = Date.parse(a.progress?.lastReadAt || a.entitlement.grantedAt);
      const timeB = Date.parse(b.progress?.lastReadAt || b.entitlement.grantedAt);
      return timeB - timeA;
    });
    return mapped;
  }

  // ---- READER PROGRESS, BOOKMARKS & HISTORY ----
  async getReaderState(
    userId: string,
    bookId: string
  ): Promise<{ progress: ReadingProgress | null; bookmarks: Bookmark[] }> {
    const [{ data: pRow }, { data: bRows }] = await Promise.all([
      this.supabase
        .from('reading_progress')
        .select('book_id, current_page, total_pages, progress_percent, last_read_at')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .maybeSingle(),
      this.supabase
        .from('bookmarks')
        .select('id, book_id, page_number, label, created_at')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .order('page_number', { ascending: true }),
    ]);

    return {
      progress: pRow
        ? {
            bookId: String(pRow.book_id),
            currentPage: Number(pRow.current_page),
            totalPages: Number(pRow.total_pages),
            progressPercent: Number(pRow.progress_percent),
            lastReadAt: String(pRow.last_read_at),
          }
        : null,
      bookmarks: (bRows || []).map((b) => ({
        id: String(b.id),
        bookId: String(b.book_id),
        pageNumber: Number(b.page_number),
        label: String(b.label || ''),
        createdAt: String(b.created_at),
      })),
    };
  }

  async saveReadingProgress(
    userId: string,
    bookId: string,
    currentPage: number,
    totalPages: number
  ): Promise<ReadingProgress> {
    const clampedPage = Math.min(Math.max(1, currentPage), Math.max(1, totalPages));
    const percent = Math.round((clampedPage / Math.max(1, totalPages)) * 100);
    const nowIso = new Date().toISOString();

    await Promise.all([
      this.supabase.from('reading_progress').upsert(
        {
          user_id: userId,
          book_id: bookId,
          current_page: clampedPage,
          total_pages: totalPages,
          progress_percent: percent,
          last_read_at: nowIso,
        },
        { onConflict: 'user_id,book_id' }
      ),
      this.supabase.from('reading_history').insert({
        user_id: userId,
        book_id: bookId,
        opened_at: nowIso,
      }),
    ]);

    return (await this.getReaderState(userId, bookId)).progress!;
  }

  async addBookmark(userId: string, bookId: string, pageNumber: number, label: string): Promise<Bookmark[]> {
    await this.supabase.from('bookmarks').upsert(
      {
        user_id: userId,
        book_id: bookId,
        page_number: pageNumber,
        label,
      },
      { onConflict: 'user_id,book_id,page_number' }
    );
    return (await this.getReaderState(userId, bookId)).bookmarks;
  }

  async deleteBookmark(userId: string, bookId: string, bookmarkId: string): Promise<Bookmark[]> {
    await this.supabase
      .from('bookmarks')
      .delete()
      .eq('id', bookmarkId)
      .eq('user_id', userId)
      .eq('book_id', bookId);
    return (await this.getReaderState(userId, bookId)).bookmarks;
  }

  async listReadingHistory(
    userId: string
  ): Promise<Array<{ book: Book; progress: ReadingProgress | null; lastOpenedAt: string }>> {
    const [{ data: histRows }, { data: progRows }] = await Promise.all([
      this.supabase
        .from('reading_history')
        .select('opened_at, book_id, books!inner(*, categories!category_id(id, slug, name_en, name_so, name_ar))')
        .eq('user_id', userId)
        .eq('books.status', 'published')
        .order('opened_at', { ascending: false })
        .limit(200),
      this.supabase.from('reading_progress').select('*').eq('user_id', userId),
    ]);

    const progMap = new Map<string, ReadingProgress>();
    for (const p of progRows || []) {
      progMap.set(String(p.book_id), {
        bookId: String(p.book_id),
        currentPage: Number(p.current_page),
        totalPages: Number(p.total_pages),
        progressPercent: Number(p.progress_percent),
        lastReadAt: String(p.last_read_at),
      });
    }

    const dedup = new Map<string, { bookRow: Record<string, unknown>; lastOpenedAt: string }>();
    for (const row of histRows || []) {
      const bId = String(row.book_id);
      if (!dedup.has(bId)) {
        dedup.set(bId, {
          bookRow: row.books as unknown as Record<string, unknown>,
          lastOpenedAt: String(row.opened_at),
        });
      }
      if (dedup.size >= 30) break;
    }

    const [stats, activePromotions] = await Promise.all([
      this.enrichBookStats(Array.from(dedup.keys())),
      this.listPromotions(true),
    ]);
    return Array.from(dedup.entries()).map(([bId, entry]) => ({
      book: mapBookRow(entry.bookRow, undefined, stats.get(bId), activePromotions),
      lastOpenedAt: entry.lastOpenedAt,
      progress: progMap.get(bId) || null,
    }));
  }

  // ---- COMMERCE, DISCOUNTS, CONTACTS & GATEWAY SETTINGS ----
  private async getSiteSettingValue<T>(key: string): Promise<T | null> {
    const { data } = await this.supabase.from('site_settings').select('value').eq('key', key).maybeSingle();
    if (!data) return null;
    return parseJsonValue<T>(data.value, null as unknown as T);
  }

  async getDiscountRatePercent(code?: string): Promise<number> {
    if (!code) return 0;
    const map = await this.getSiteSettingValue<Record<string, number>>('discount_codes');
    if (!map) return 0;
    return Number(map[code.trim().toUpperCase()] || 0);
  }

  async listDiscountCodes(): Promise<DiscountCodeEntry[]> {
    const parsed = await this.getSiteSettingValue<Record<string, unknown>>('discount_codes');
    if (!parsed) return [];
    return Object.entries(parsed)
      .filter(([, percent]) => typeof percent === 'number' && percent > 0)
      .map(([code, percent]) => ({ code: code.toUpperCase(), percent: Number(percent) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async saveDiscountCodes(entries: DiscountCodeEntry[], updatedBy?: string | null): Promise<DiscountCodeEntry[]> {
    const map: Record<string, number> = {};
    for (const item of entries) {
      const cleanCode = item.code.trim().toUpperCase();
      if (cleanCode && item.percent > 0 && item.percent <= 95) {
        map[cleanCode] = Math.round(item.percent);
      }
    }
    const { error } = await this.supabase.from('site_settings').upsert(
      {
        key: 'discount_codes',
        value: map,
        updated_by: updatedBy && isUuid(updatedBy) ? updatedBy : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (error) throw new Error(`Failed to save discount codes: ${error.message}`);
    return this.listDiscountCodes();
  }

  async listContactChannels(includeDisabled = false): Promise<ContactChannel[]> {
    const parsed = await this.getSiteSettingValue<unknown>('contact_channels');
    if (!Array.isArray(parsed)) return [];
    const list = (parsed as ContactChannel[]).map((item, idx) => ({
      id: String(item.id || `contact-${idx + 1}`),
      type: item.type || 'other',
      label: String(item.label || ''),
      value: String(item.value || ''),
      url: item.url ? String(item.url) : '',
      isPrimary: Boolean(item.isPrimary),
      isEnabled: item.isEnabled !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : idx + 1,
    }));
    const filtered = includeDisabled ? list : list.filter((c) => c.isEnabled);
    return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async saveContactChannels(channels: ContactChannel[], updatedBy?: string | null): Promise<ContactChannel[]> {
    let seenPrimary = false;
    const normalized: ContactChannel[] = channels.map((c, idx) => {
      const isPrimary = Boolean(c.isPrimary) && !seenPrimary;
      if (isPrimary) seenPrimary = true;
      return {
        id: c.id.trim() || crypto.randomUUID(),
        type: c.type,
        label: c.label.trim(),
        value: c.value.trim(),
        url: c.url ? c.url.trim() : '',
        isPrimary,
        isEnabled: c.isEnabled !== false,
        sortOrder: idx + 1,
      };
    });
    const { error } = await this.supabase.from('site_settings').upsert(
      {
        key: 'contact_channels',
        value: normalized,
        updated_by: updatedBy && isUuid(updatedBy) ? updatedBy : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (error) throw new Error(`Failed to save contact channels: ${error.message}`);
    return this.listContactChannels(true);
  }

  async listPaymentProviders(): Promise<PaymentProviderConfig[]> {
    const { data: rows, error } = await this.supabase
      .from('payment_provider_configs')
      .select('*')
      .order('provider_type', { ascending: false })
      .order('code', { ascending: true });
    if (error) throw new Error(`Failed to load payment providers: ${error.message}`);

    return (rows || []).map((r) => ({
      code: String(r.code),
      displayName: String(r.display_name),
      providerType: r.provider_type as 'online_gateway' | 'manual',
      isEnabled: Boolean(r.is_enabled),
      isConnected: Boolean(r.is_connected),
      instructionsEn: String(r.instructions_en || ''),
      instructionsSo: String(r.instructions_so || ''),
      instructionsAr: String(r.instructions_ar || ''),
      publicConfig: parseJsonValue<Record<string, unknown>>(r.public_config, {}),
    }));
  }

  async createManualPaymentProvider(input: {
    code: string;
    displayName: string;
    accountNumber: string;
    instructionsEn: string;
    instructionsSo: string;
    instructionsAr: string;
  }): Promise<PaymentProviderConfig> {
    const isEvc = /evc/i.test(input.displayName);
    const cleanNumber = input.accountNumber.replace(/\s+/g, '');
    const { error } = await this.supabase.from('payment_provider_configs').insert({
      code: input.code,
      display_name: input.displayName,
      provider_type: 'manual',
      is_enabled: false,
      is_connected: true,
      instructions_en: input.instructionsEn || 'Send the payment to the account shown below, then submit your payment reference.',
      instructions_so: input.instructionsSo || 'Lacagta u dir lambarka hoose, kadib soo gudbi tixraaca lacag-bixinta.',
      instructions_ar: input.instructionsAr || 'أرسل المبلغ إلى الرقم أدناه ثم أرسل مرجع الدفع.',
      public_config: {
        accountNumber: input.accountNumber,
        ...(isEvc && /^\+?[0-9]+$/.test(cleanNumber) ? { ussdTemplate: `*712*${cleanNumber}*{{amount}}#` } : {}),
      },
    });
    if (error) throw new Error(`Failed to create payment method: ${error.message}`);
    const providers = await this.listPaymentProviders();
    return providers.find((provider) => provider.code === input.code)!;
  }

  async updatePaymentProviderConfig(
    code: string,
    updates: { isEnabled: boolean; instructionsEn: string; instructionsSo: string; instructionsAr: string; ussdTemplate?: string; accountNumber?: string }
  ): Promise<PaymentProviderConfig> {
    let publicConfigPatch: Record<string, unknown> | undefined;
    if (updates.ussdTemplate !== undefined || updates.accountNumber !== undefined) {
      const { data: current, error: readError } = await this.supabase
        .from('payment_provider_configs')
        .select('public_config,display_name')
        .eq('code', code)
        .single();
      if (readError) throw new Error(`Failed to read payment provider settings: ${readError.message}`);
      const currentConfig = parseJsonValue<Record<string, unknown>>(current?.public_config, {});
      publicConfigPatch = { ...currentConfig };
      if (updates.accountNumber !== undefined) publicConfigPatch.accountNumber = updates.accountNumber;
      if (updates.ussdTemplate !== undefined) {
        if (updates.ussdTemplate) publicConfigPatch.ussdTemplate = updates.ussdTemplate;
        else delete publicConfigPatch.ussdTemplate;
      } else if (updates.accountNumber !== undefined) {
        const number = updates.accountNumber.replace(/\s+/g, '');
        if (/evc/i.test(String(current?.display_name || '')) && /^\+?[0-9]+$/.test(number)) {
          publicConfigPatch.ussdTemplate = `*712*${number}*{{amount}}#`;
        } else {
          delete publicConfigPatch.ussdTemplate;
        }
      }
    }
    const { error } = await this.supabase
      .from('payment_provider_configs')
      .update({
        is_enabled: updates.isEnabled,
        instructions_en: updates.instructionsEn,
        instructions_so: updates.instructionsSo,
        instructions_ar: updates.instructionsAr,
        ...(publicConfigPatch ? { public_config: publicConfigPatch } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('code', code);
    if (error) throw new Error(`Failed to update payment provider: ${error.message}`);
    const providers = await this.listPaymentProviders();
    return providers.find((p) => p.code === code)!;
  }

  private async getStoredAdminGatewayCredentials(
    providerCode: string,
    primarySecret: string,
    fallbackSecret?: string
  ): Promise<StoredGatewayCredentials | null> {
    const { data } = await this.supabase
      .from('site_settings')
      .select('value')
      .eq('key', `payment_gateway_credentials:${providerCode}`)
      .maybeSingle();

    if (!data?.value) return null;
    const encrypted = typeof data.value === 'string' ? data.value : String((data.value as { encrypted?: string }).encrypted || '');
    if (!encrypted) return null;
    return decryptGatewayPayload<StoredGatewayCredentials>(encrypted, primarySecret, fallbackSecret);
  }

  async getResolvedGatewayConfig(
    providerCode: string,
    envFallback: GatewayEnvFallback
  ): Promise<StoredGatewayCredentials & { source: 'admin' | 'env' | 'none' }> {
    const primaryKey = envFallback.gatewayEncryptionKey || envFallback.sessionSecret;
    const adminStored = await this.getStoredAdminGatewayCredentials(providerCode, primaryKey, envFallback.sessionSecret);
    const hasAdminValues = Boolean(
      adminStored &&
        (adminStored.gatewayUrl || adminStored.merchantId || adminStored.apiKey || adminStored.webhookSecret)
    );
    if (hasAdminValues && adminStored) {
      return {
        gatewayMode: adminStored.gatewayMode || 'mpgs_hosted',
        gatewayUrl: adminStored.gatewayUrl || '',
        merchantId: adminStored.merchantId || '',
        apiVersion: adminStored.apiVersion || '73',
        apiKey: adminStored.apiKey || '',
        webhookSecret: adminStored.webhookSecret || '',
        source: 'admin',
      };
    }

    const hasEnvValues = Boolean(
      envFallback.gatewayUrl || envFallback.merchantId || envFallback.apiKey || envFallback.webhookSecret
    );
    if (hasEnvValues) {
      return {
        gatewayMode: 'rest_redirect',
        gatewayUrl: envFallback.gatewayUrl,
        merchantId: envFallback.merchantId,
        apiVersion: '73',
        apiKey: envFallback.apiKey,
        webhookSecret: envFallback.webhookSecret,
        source: 'env',
      };
    }

    return {
      gatewayMode: adminStored?.gatewayMode || 'mpgs_hosted',
      gatewayUrl: '',
      merchantId: '',
      apiVersion: adminStored?.apiVersion || '73',
      apiKey: '',
      webhookSecret: '',
      source: 'none',
    };
  }

  async getGatewayCredentialsAdminView(
    providerCode: string,
    envFallback: GatewayEnvFallback
  ): Promise<PaymentGatewayCredentialsView> {
    const resolved = await this.getResolvedGatewayConfig(providerCode, envFallback);
    return {
      gatewayMode: resolved.gatewayMode,
      gatewayUrl: resolved.gatewayUrl,
      merchantId: resolved.merchantId,
      apiVersion: resolved.apiVersion,
      hasApiKey: Boolean(resolved.apiKey),
      apiKeyMasked: maskSecretValue(resolved.apiKey),
      hasWebhookSecret: Boolean(resolved.webhookSecret),
      webhookSecretMasked: maskSecretValue(resolved.webhookSecret),
      source: resolved.source,
      webhookCallbackUrl: `${envFallback.appUrl.replace(/\/+$/, '')}/api/webhooks/payments/${providerCode}`,
    };
  }

  async saveGatewayCredentials(
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
  ): Promise<PaymentGatewayCredentialsView> {
    const primaryKey = envFallback.gatewayEncryptionKey || envFallback.sessionSecret;
    const existing = await this.getStoredAdminGatewayCredentials(providerCode, primaryKey, envFallback.sessionSecret);
    const nextApiKey = input.clearSecrets
      ? ''
      : input.apiKey && input.apiKey.trim()
        ? input.apiKey.trim()
        : existing?.apiKey || '';
    const nextWebhookSecret = input.clearSecrets
      ? ''
      : input.webhookSecret && input.webhookSecret.trim()
        ? input.webhookSecret.trim()
        : existing?.webhookSecret || '';

    const payload: StoredGatewayCredentials = {
      gatewayMode: input.gatewayMode,
      gatewayUrl: input.gatewayUrl.trim(),
      merchantId: input.merchantId.trim(),
      apiVersion: (input.apiVersion || existing?.apiVersion || '73').trim() || '73',
      apiKey: nextApiKey,
      webhookSecret: nextWebhookSecret,
    };

    const encrypted = encryptGatewayPayload(JSON.stringify(payload), primaryKey);
    const { error: setErr } = await this.supabase.from('site_settings').upsert(
      {
        key: `payment_gateway_credentials:${providerCode}`,
        value: encrypted,
        updated_by: updatedBy && isUuid(updatedBy) ? updatedBy : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (setErr) throw new Error(`Failed to store gateway credentials: ${setErr.message}`);

    const { data: provRow } = await this.supabase
      .from('payment_provider_configs')
      .select('public_config')
      .eq('code', providerCode)
      .maybeSingle();

    const currentPub = parseJsonValue<Record<string, unknown>>(provRow?.public_config, {});
    const isNowConnected = Boolean(
      payload.gatewayUrl &&
        payload.merchantId &&
        payload.apiKey &&
        (payload.gatewayMode === 'mpgs_hosted' || payload.webhookSecret)
    );

    await this.supabase
      .from('payment_provider_configs')
      .update({
        public_config: { ...currentPub, gatewayMode: payload.gatewayMode },
        is_connected: isNowConnected,
        updated_at: new Date().toISOString(),
      })
      .eq('code', providerCode);

    return this.getGatewayCredentialsAdminView(providerCode, envFallback);
  }

  async createAuthoritativeOrder(params: {
    userId: string;
    bookIds: string[];
    paymentMethodCode: string;
    discountCode?: string;
    billingEmail?: string;
    billingPhone?: string;
    notes?: string;
  }): Promise<{ order: Order; payment: PaymentRecord }> {
    const uniqueBookIds = Array.from(new Set(params.bookIds));
    const books: Book[] = [];
    for (const id of uniqueBookIds) {
      const b = await this.getBookBySlugOrId(id, false);
      if (!b) throw new Error(`Book ${id} is unavailable`);
      if (await this.hasActiveEntitlement(params.userId, b.id)) {
        throw new Error(`You already have active access to "${b.title}"`);
      }
      books.push(b);
    }

    const [discountRate, activePromotions] = await Promise.all([
      this.getDiscountRatePercent(params.discountCode),
      this.listPromotions(true),
    ]);
    const totals = calculateAuthoritativeOrderTotals(books, discountRate, activePromotions);

    const orderReference = `KSDL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const transactionReference = `TX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const itemsPayload = books.map((b, idx) => ({
      book_id: b.id,
      book_title_snapshot: b.title,
      unit_price_cents: totals.appliedUnitPriceCents[idx] ?? b.priceCents,
    }));

    const { data: rpcRes, error: rpcErr } = await this.supabase.rpc('create_authoritative_order_atomic', {
      p_user_id: params.userId,
      p_order_reference: orderReference,
      p_transaction_reference: transactionReference,
      p_subtotal_cents: totals.subtotalCents,
      p_discount_cents: totals.discountCents,
      p_total_cents: totals.totalCents,
      p_currency: totals.currency,
      p_payment_method_code: params.paymentMethodCode,
      p_billing_email: params.billingEmail || '',
      p_billing_phone: params.billingPhone || '',
      p_notes: params.notes || '',
      p_items: itemsPayload,
    });

    if (rpcErr) {
      throw new Error(rpcErr.message);
    }

    const createdId = String((rpcRes as { order_id?: string } | null)?.order_id || '');
    const order = (await this.getOrderById(createdId || orderReference))!;
    return { order, payment: order.payment! };
  }

  async updatePaymentInitiation(
    paymentId: string,
    providerPaymentId: string | null,
    status: PaymentStatus,
    gatewayMetadata?: Record<string, unknown>
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      provider_payment_id: providerPaymentId,
      status,
      updated_at: new Date().toISOString(),
    };
    if (gatewayMetadata !== undefined) {
      updates.gateway_metadata = gatewayMetadata;
    }
    const { error } = await this.supabase.from('payments').update(updates).eq('id', paymentId);
    if (error) throw new Error(`Failed to update payment initiation: ${error.message}`);
  }

  async getPaymentGatewayMetadata(paymentId: string): Promise<Record<string, unknown>> {
    const { data } = await this.supabase
      .from('payments')
      .select('gateway_metadata')
      .eq('id', paymentId)
      .maybeSingle();
    return parseJsonValue<Record<string, unknown>>(data?.gateway_metadata, {});
  }

  async submitManualPaymentReference(userId: string, orderId: string, customerReference: string): Promise<Order> {
    const resolvedOrder = await this.getOrderById(orderId);
    if (!resolvedOrder || resolvedOrder.userId !== userId || !resolvedOrder.payment) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const { error } = await this.supabase.rpc('submit_manual_payment_reference', {
      p_user_id: userId,
      p_order_id: resolvedOrder.id,
      p_customer_reference: customerReference,
    });

    if (error) {
      if (error.message.includes('ORDER_NOT_FOUND')) throw new Error('ORDER_NOT_FOUND');
      if (error.message.includes('INVALID_ORDER_STATE')) throw new Error('INVALID_ORDER_STATE');
      throw new Error(`Unable to submit payment reference: ${error.message}`);
    }

    return (await this.getOrderById(resolvedOrder.id))!;
  }

  async processVerifiedPaymentAtomic(params: {
    paymentId: string;
    providerPaymentId?: string | null;
    verifiedByAdminId?: string | null;
  }): Promise<{ alreadyVerified: boolean; order: Order }> {
    const { data, error } = await this.supabase.rpc('verify_payment_and_grant_entitlement', {
      p_payment_id: params.paymentId,
      p_provider_payment_id: params.providerPaymentId ?? null,
      p_verified_by: params.verifiedByAdminId ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    const res = data as { status?: string; order_id?: string };
    const order = (await this.getOrderById(String(res.order_id)))!;
    return {
      alreadyVerified: res.status === 'already_verified',
      order,
    };
  }

  async markPaymentFailedOrCancelled(params: {
    paymentId: string;
    targetStatus: 'failed' | 'cancelled' | 'refunded';
    reason?: string;
    actorAdminId?: string | null;
  }): Promise<Order> {
    const { data: orderId, error } = await this.supabase.rpc('mark_payment_failed_or_cancelled', {
      p_payment_id: params.paymentId,
      p_target_status: params.targetStatus,
      p_reason: params.reason ?? null,
      p_actor_admin_id: params.actorAdminId ?? null,
    });
    if (error) throw new Error(error.message);
    return (await this.getOrderById(String(orderId)))!;
  }

  async recordWebhookEventIfNew(params: {
    providerCode: string;
    externalEventId: string;
    eventType: string;
    signatureVerified: boolean;
    paymentId: string | null;
    payload: unknown;
  }): Promise<boolean> {
    const { error } = await this.supabase.from('payment_events').insert({
      payment_id: params.paymentId,
      provider_code: params.providerCode,
      external_event_id: params.externalEventId,
      event_type: params.eventType,
      signature_verified: params.signatureVerified,
      payload: typeof params.payload === 'string' ? parseJsonValue(params.payload, { raw: params.payload }) : params.payload,
    });
    if (error) {
      return false; // Duplicate (provider_code, external_event_id) -> idempotent ignore
    }
    return true;
  }

  async findPaymentByTransactionReference(txRef: string): Promise<PaymentRecord | null> {
    let { data: payRow } = await this.supabase
      .from('payments')
      .select('*')
      .eq('transaction_reference', txRef)
      .maybeSingle();

    if (!payRow) {
      const { data: ord } = await this.supabase
        .from('orders')
        .select('id')
        .eq('order_reference', txRef)
        .maybeSingle();
      if (ord) {
        const res = await this.supabase
          .from('payments')
          .select('*')
          .eq('order_id', ord.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        payRow = res.data;
      }
    }

    if (!payRow) return null;
    return {
      id: String(payRow.id),
      orderId: String(payRow.order_id),
      userId: String(payRow.user_id),
      providerCode: String(payRow.provider_code),
      transactionReference: String(payRow.transaction_reference),
      providerPaymentId: payRow.provider_payment_id ? String(payRow.provider_payment_id) : null,
      customerSubmittedReference: payRow.customer_submitted_reference ? String(payRow.customer_submitted_reference) : null,
      amountCents: Number(payRow.amount_cents),
      currency: String(payRow.currency),
      status: payRow.status as PaymentStatus,
      verifiedAt: payRow.verified_at ? String(payRow.verified_at) : null,
      failureReason: payRow.failure_reason ? String(payRow.failure_reason) : null,
      createdAt: String(payRow.created_at),
    };
  }

  private mapOrderAggregate(
    r: Record<string, unknown>,
    itemRows: Array<Record<string, unknown>>,
    payRow: Record<string, unknown> | null | undefined
  ): Order {
    const profile = r.profiles as { email?: string; full_name?: string } | null | undefined;
    const items: OrderItem[] = itemRows.map((i) => {
      const bookRef = i.books as { cover_url?: string | null; author?: string } | null | undefined;
      return {
        id: String(i.id),
        orderId: String(i.order_id),
        bookId: String(i.book_id),
        bookTitleSnapshot: String(i.book_title_snapshot),
        unitPriceCents: Number(i.unit_price_cents),
        coverUrl: bookRef?.cover_url ? String(bookRef.cover_url) : null,
        author: bookRef?.author ? String(bookRef.author) : undefined,
      };
    });

    return {
      id: String(r.id),
      orderReference: String(r.order_reference),
      userId: String(r.user_id),
      customerEmail: profile?.email ? String(profile.email) : undefined,
      customerName: profile?.full_name ? String(profile.full_name) : undefined,
      billingEmail: r.billing_email ? String(r.billing_email) : undefined,
      billingPhone: r.billing_phone ? String(r.billing_phone) : undefined,
      subtotalCents: Number(r.subtotal_cents),
      discountCents: Number(r.discount_cents),
      totalCents: Number(r.total_cents),
      currency: String(r.currency),
      status: r.status as Order['status'],
      paymentMethodCode: String(r.payment_method_code),
      notes: String(r.notes || ''),
      items,
      payment: payRow
        ? {
            id: String(payRow.id),
            orderId: String(payRow.order_id),
            userId: String(payRow.user_id),
            providerCode: String(payRow.provider_code),
            transactionReference: String(payRow.transaction_reference),
            providerPaymentId: payRow.provider_payment_id ? String(payRow.provider_payment_id) : null,
            customerSubmittedReference: payRow.customer_submitted_reference
              ? String(payRow.customer_submitted_reference)
              : null,
            amountCents: Number(payRow.amount_cents),
            currency: String(payRow.currency),
            status: payRow.status as PaymentStatus,
            verifiedAt: payRow.verified_at ? String(payRow.verified_at) : null,
            failureReason: payRow.failure_reason ? String(payRow.failure_reason) : null,
            createdAt: String(payRow.created_at),
          }
        : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    let query = this.supabase.from('orders').select('*, profiles(email, full_name)');
    if (isUuid(orderId)) {
      query = query.or(`id.eq.${orderId},order_reference.eq.${orderId}`);
    } else {
      query = query.eq('order_reference', orderId);
    }

    const { data: r } = await query.maybeSingle();
    if (!r) return null;

    const [{ data: itemRows }, { data: payRow }] = await Promise.all([
      this.supabase.from('order_items').select('*, books(cover_url, author)').eq('order_id', r.id),
      this.supabase.from('payments').select('*').eq('order_id', r.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    return this.mapOrderAggregate(
      r as Record<string, unknown>,
      (itemRows || []) as Array<Record<string, unknown>>,
      payRow as Record<string, unknown> | null
    );
  }

  async listOrdersForUser(userId: string): Promise<Order[]> {
    const { data: ordRows } = await this.supabase
      .from('orders')
      .select('*, profiles(email, full_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return this.hydrateOrderList((ordRows || []) as Array<Record<string, unknown>>);
  }

  private async hydrateOrderList(ordRows: Array<Record<string, unknown>>): Promise<Order[]> {
    if (ordRows.length === 0) return [];
    const orderIds = ordRows.map((o) => String(o.id));
    const [{ data: itemRows }, { data: payRows }] = await Promise.all([
      this.supabase.from('order_items').select('*, books(cover_url, author)').in('order_id', orderIds),
      this.supabase
        .from('payments')
        .select('*')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false }),
    ]);

    const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
    for (const item of (itemRows || []) as Array<Record<string, unknown>>) {
      const oId = String(item.order_id);
      const list = itemsByOrder.get(oId) || [];
      list.push(item);
      itemsByOrder.set(oId, list);
    }

    const payByOrder = new Map<string, Record<string, unknown>>();
    for (const pay of (payRows || []) as Array<Record<string, unknown>>) {
      const oId = String(pay.order_id);
      if (!payByOrder.has(oId)) payByOrder.set(oId, pay);
    }

    return ordRows.map((o) =>
      this.mapOrderAggregate(o, itemsByOrder.get(String(o.id)) || [], payByOrder.get(String(o.id)))
    );
  }

  // ---- NOTIFICATIONS & HOMEPAGE ----
  async listNotifications(userId: string): Promise<NotificationItem[]> {
    const { data: rows } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    return (rows || []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      type: r.type as NotificationItem['type'],
      title: String(r.title),
      message: String(r.message),
      linkUrl: r.link_url ? String(r.link_url) : null,
      isRead: Boolean(r.is_read),
      createdAt: String(r.created_at),
    }));
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);
  }

  async listHomepageSections(includeDisabled = false): Promise<HomepageSection[]> {
    let query = this.supabase.from('homepage_sections').select('*').order('sort_order', { ascending: true });
    if (!includeDisabled) {
      query = query.eq('is_enabled', true);
    }
    const { data: rows } = await query;
    return (rows || []).map((r) => ({
      id: String(r.id),
      sectionKey: String(r.section_key),
      titleEn: String(r.title_en),
      titleSo: String(r.title_so),
      titleAr: String(r.title_ar),
      sortOrder: Number(r.sort_order),
      isEnabled: Boolean(r.is_enabled),
    }));
  }

  async updateHomepageSection(
    id: string,
    data: { isEnabled: boolean; sortOrder: number; titleEn: string; titleSo: string; titleAr: string }
  ): Promise<void> {
    const { error } = await this.supabase
      .from('homepage_sections')
      .update({
        is_enabled: data.isEnabled,
        sort_order: data.sortOrder,
        title_en: data.titleEn,
        title_so: data.titleSo,
        title_ar: data.titleAr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`Failed to update homepage section: ${error.message}`);
  }

  // ---- ADMIN METRICS, LOGS, CUSTOMERS & REPORTS ----
  async logAdminAction(params: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void> {
    await this.supabase.from('admin_activity_logs').insert({
      actor_user_id: params.actorUserId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      details: params.details || {},
      ip_address: params.ipAddress || null,
    });
  }

  async getAdminMetrics(
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
  }> {
    let ordersQuery = this.supabase.from('orders').select('status, total_cents, created_at');
    if (startDate && endDate) {
      ordersQuery = ordersQuery.gte('created_at', `${startDate}T00:00:00.000Z`).lte('created_at', `${endDate}T23:59:59.999Z`);
    }

    const [{ data: bookRows }, { count: customerCount }, { data: orderRows }] = await Promise.all([
      this.supabase.from('books').select('status'),
      this.supabase.from('profiles').select('*', { count: 'exact', head: true }),
      ordersQuery,
    ]);

    const books = bookRows || [];
    const orders = orderRows || [];

    return {
      totalBooks: books.length,
      publishedBooks: books.filter((b) => b.status === 'published').length,
      draftBooks: books.filter((b) => b.status === 'draft').length,
      registeredCustomers: customerCount ?? 0,
      totalOrders: orders.length,
      paidOrders: orders.filter((o) => o.status === 'paid').length,
      pendingPayments: orders.filter((o) => ['pending', 'awaiting_payment', 'processing'].includes(String(o.status))).length,
      failedPayments: orders.filter((o) => o.status === 'failed').length,
      verifiedRevenueCents: orders
        .filter((o) => o.status === 'paid')
        .reduce((sum, o) => sum + Number(o.total_cents || 0), 0),
    };
  }

  async listAllOrders(statusFilter?: string): Promise<Order[]> {
    let query = this.supabase
      .from('orders')
      .select('*, profiles(email, full_name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    const { data: ordRows } = await query;
    return this.hydrateOrderList((ordRows || []) as Array<Record<string, unknown>>);
  }

  async listCustomers(
    search?: string,
    statusFilter: 'all' | AccountStatus = 'all'
  ): Promise<AdminCustomerListItem[]> {
    let query = this.supabase
      .from('profiles')
      .select('id, email, email_verified, full_name, preferred_language, preferred_theme, email_notifications, account_status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (search?.trim()) {
      const term = search.trim().replace(/[(),]/g, ' ');
      query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
    }
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('account_status', statusFilter);
    }

    const { data: profiles } = await query;
    const list = profiles || [];
    if (list.length === 0) return [];

    const userIds = list.map((p) => String(p.id));
    const [{ data: roleRows }, { data: orderRows }, { data: entRows }] = await Promise.all([
      this.supabase.from('user_roles').select('user_id, role').in('user_id', userIds),
      this.supabase.from('orders').select('user_id, status, total_cents').in('user_id', userIds),
      this.supabase.from('entitlements').select('user_id').in('user_id', userIds).eq('status', 'active'),
    ]);

    const rolesMap = new Map<string, UserRole[]>();
    for (const r of roleRows || []) {
      const uId = String(r.user_id);
      const arr = rolesMap.get(uId) || [];
      arr.push(r.role as UserRole);
      rolesMap.set(uId, arr);
    }

    const ordAgg = new Map<string, { count: number; spent: number }>();
    for (const o of orderRows || []) {
      const uId = String(o.user_id);
      const cur = ordAgg.get(uId) || { count: 0, spent: 0 };
      cur.count += 1;
      if (o.status === 'paid') cur.spent += Number(o.total_cents || 0);
      ordAgg.set(uId, cur);
    }

    const entCounts = new Map<string, number>();
    for (const e of entRows || []) {
      const uId = String(e.user_id);
      entCounts.set(uId, (entCounts.get(uId) || 0) + 1);
    }

    return list.map((p) => {
      const uId = String(p.id);
      const agg = ordAgg.get(uId) || { count: 0, spent: 0 };
      return {
        id: uId,
        email: String(p.email),
        emailVerified: Boolean(p.email_verified),
        fullName: String(p.full_name || ''),
        preferredLanguage: p.preferred_language as LanguageCode,
        preferredTheme: p.preferred_theme as ThemeMode,
        emailNotifications: Boolean(p.email_notifications),
        accountStatus: p.account_status as AccountStatus,
        roles: rolesMap.get(uId) || ['customer'],
        createdAt: String(p.created_at),
        orderCount: agg.count,
        totalSpentCents: agg.spent,
        activeBooksCount: entCounts.get(uId) || 0,
      };
    });
  }

  private async listCustomerBookAccess(targetUserId: string): Promise<AdminUserBookAccessItem[]> {
    if (!isUuid(targetUserId)) return [];
    const { data: rows } = await this.supabase
      .from('entitlements')
      .select('book_id, source_type, status, granted_at, books!inner(title, author, is_free, price_cents, currency, status)')
      .eq('user_id', targetUserId)
      .order('granted_at', { ascending: false });

    return (rows || []).map((r) => {
      const bRef = r.books as unknown as {
        title?: string;
        author?: string;
        is_free?: boolean;
        price_cents?: number;
        currency?: string;
        status?: BookStatus;
      };
      return {
        bookId: String(r.book_id),
        title: String(bRef?.title || ''),
        author: String(bRef?.author || ''),
        isFree: Boolean(bRef?.is_free),
        priceCents: Number(bRef?.price_cents || 0),
        currency: String(bRef?.currency || 'USD'),
        bookStatus: (bRef?.status || 'published') as BookStatus,
        sourceType: r.source_type as Entitlement['sourceType'],
        status: r.status as Entitlement['status'],
        grantedAt: String(r.granted_at),
      };
    });
  }

  async getAdminCustomerDetails(targetUserId: string): Promise<AdminCustomerDetails | null> {
    const profile = await this.getUserProfileById(targetUserId);
    if (!profile) return null;

    const [entitlements, orders] = await Promise.all([
      this.listCustomerBookAccess(targetUserId),
      this.listOrdersForUser(targetUserId),
    ]);

    const activeBooksCount = entitlements.filter((e) => e.status === 'active').length;
    const totalSpentCents = orders
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + Number(o.totalCents || 0), 0);

    return {
      customer: {
        ...profile,
        orderCount: orders.length,
        totalSpentCents,
        activeBooksCount,
      },
      entitlements,
      orders,
    };
  }

  async adminCreateUser(params: {
    email: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage: LanguageCode;
    accountStatus: AccountStatus;
    isAdmin: boolean;
    grantAll: boolean;
    bookIds: string[];
    grantedByUserId: string;
  }): Promise<UserProfile> {
    const normalizedEmail = params.email.toLowerCase().trim();
    const { data: existing } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .insert({
        email: normalizedEmail,
        password_hash: params.passwordHash,
        full_name: params.fullName,
        preferred_language: params.preferredLanguage,
        account_status: params.accountStatus,
        email_verified: true,
      })
      .select('id')
      .single();

    if (error) {
      if (error.message.toLowerCase().includes('duplicate') || error.code === '23505') {
        throw new Error('EMAIL_EXISTS');
      }
      throw new Error(`Failed to create user profile: ${error.message}`);
    }

    const userId = String(profile.id);
    const roleInserts: Array<Promise<unknown>> = [
      Promise.resolve(
        this.supabase.from('user_roles').upsert({ user_id: userId, role: 'customer' }, { onConflict: 'user_id,role' })
      ),
      Promise.resolve(this.supabase.from('wishlists').upsert({ user_id: userId }, { onConflict: 'user_id' })),
      Promise.resolve(this.supabase.from('carts').upsert({ user_id: userId }, { onConflict: 'user_id' })),
    ];
    if (params.isAdmin) {
      roleInserts.push(
        Promise.resolve(
          this.supabase
            .from('user_roles')
            .upsert(
              {
                user_id: userId,
                role: 'admin',
                granted_by: isUuid(params.grantedByUserId) ? params.grantedByUserId : null,
              },
              { onConflict: 'user_id,role' }
            )
        )
      );
    }
    await Promise.all(roleInserts);

    if (params.grantAll || params.bookIds.length > 0) {
      await this.adminGrantBooksToUser({
        targetUserId: userId,
        grantAll: params.grantAll,
        bookIds: params.bookIds,
        grantedByUserId: params.grantedByUserId,
        reason: 'Initial account setup grant',
      });
    }

    return (await this.getUserProfileById(userId))!;
  }

  async adminUpdateCustomer(
    targetUserId: string,
    input: {
      fullName: string;
      preferredLanguage: LanguageCode;
      accountStatus: AccountStatus;
      newPasswordHash?: string;
    }
  ): Promise<UserProfile> {
    const target = await this.getUserProfileById(targetUserId);
    if (!target) {
      throw new Error('Customer not found');
    }

    const bumpSession = Boolean(input.newPasswordHash) || input.accountStatus === 'suspended';
    const currentSv = bumpSession ? await this.getSessionVersion(targetUserId) : 0;
    const payload: Record<string, unknown> = {
      full_name: input.fullName,
      preferred_language: input.preferredLanguage,
      account_status: input.accountStatus,
      updated_at: new Date().toISOString(),
    };
    if (bumpSession) {
      payload.session_version = currentSv + 1;
    }
    if (input.newPasswordHash) {
      payload.password_hash = input.newPasswordHash;
    }

    const { error } = await this.supabase.from('profiles').update(payload).eq('id', targetUserId);
    if (error) throw new Error(`Failed to update customer: ${error.message}`);
    return (await this.getUserProfileById(targetUserId))!;
  }

  async adminGrantBooksToUser(params: {
    targetUserId: string;
    grantAll: boolean;
    bookIds: string[];
    grantedByUserId: string;
    reason?: string;
  }): Promise<AdminUserBookAccessItem[]> {
    const target = await this.getUserProfileById(params.targetUserId);
    if (!target) {
      throw new Error('Customer not found');
    }

    let candidateBooks: Array<{ id: string; title: string }> = [];
    if (params.grantAll) {
      const { data: rows } = await this.supabase.from('books').select('id, title').neq('status', 'archived');
      candidateBooks = (rows || []).map((b) => ({ id: String(b.id), title: String(b.title) }));
    } else {
      const uniqueIds = Array.from(new Set(params.bookIds));
      const resolved = await Promise.all(uniqueIds.map((id) => this.getBookBySlugOrId(id, true)));
      candidateBooks = resolved.filter((b): b is Book => Boolean(b)).map((b) => ({ id: b.id, title: b.title }));
    }

    if (candidateBooks.length === 0) {
      return this.listCustomerBookAccess(params.targetUserId);
    }

    const candidateIds = candidateBooks.map((b) => b.id);
    const { data: existingRows } = await this.supabase
      .from('entitlements')
      .select('id, book_id, source_type, status')
      .eq('user_id', params.targetUserId)
      .in('book_id', candidateIds);

    const existingMap = new Map<string, { id: string; source_type: string; status: string }>();
    for (const r of existingRows || []) {
      existingMap.set(String(r.book_id), {
        id: String(r.id),
        source_type: String(r.source_type),
        status: String(r.status),
      });
    }

    const nowIso = new Date().toISOString();
    const toInsert: Array<Record<string, unknown>> = [];
    const toReactivatePurchase: string[] = [];
    const toReactivateGrant: string[] = [];

    for (const b of candidateBooks) {
      const ex = existingMap.get(b.id);
      if (!ex) {
        toInsert.push({
          user_id: params.targetUserId,
          book_id: b.id,
          source_type: 'admin_grant',
          status: 'active',
          granted_at: nowIso,
        });
      } else if (ex.status !== 'active') {
        if (ex.source_type === 'purchase') {
          toReactivatePurchase.push(ex.id);
        } else {
          toReactivateGrant.push(ex.id);
        }
      }
    }

    const ops: Array<Promise<unknown>> = [];
    if (toInsert.length > 0) {
      ops.push(Promise.resolve(this.supabase.from('entitlements').insert(toInsert)));
    }
    if (toReactivatePurchase.length > 0) {
      ops.push(
        Promise.resolve(
          this.supabase
            .from('entitlements')
            .update({ status: 'active', granted_at: nowIso })
            .in('id', toReactivatePurchase)
        )
      );
    }
    if (toReactivateGrant.length > 0) {
      ops.push(
        Promise.resolve(
          this.supabase
            .from('entitlements')
            .update({ status: 'active', source_type: 'admin_grant', granted_at: nowIso })
            .in('id', toReactivateGrant)
        )
      );
    }
    await Promise.all(ops);

    const grantedCount = toInsert.length + toReactivatePurchase.length + toReactivateGrant.length;
    if (grantedCount > 0) {
      const titleMsg =
        grantedCount === 1 && candidateBooks[0]
          ? `"${candidateBooks[0].title}" has been unlocked in your library for free.`
          : `${grantedCount} digital books have been unlocked in your library.`;
      await this.supabase.from('notifications').insert({
        user_id: params.targetUserId,
        type: 'account',
        title: 'Library Access Unlocked',
        message: titleMsg,
        link_url: '/account/library',
      });
    }

    return this.listCustomerBookAccess(params.targetUserId);
  }

  async adminRevokeBookFromUser(targetUserId: string, bookId: string): Promise<AdminUserBookAccessItem[]> {
    const target = await this.getUserProfileById(targetUserId);
    if (!target) {
      throw new Error('Customer not found');
    }
    await this.supabase
      .from('entitlements')
      .update({ status: 'revoked' })
      .eq('user_id', targetUserId)
      .eq('book_id', bookId);
    return this.listCustomerBookAccess(targetUserId);
  }

  async adminRevokeAllGrantedBooksFromUser(targetUserId: string): Promise<AdminUserBookAccessItem[]> {
    const target = await this.getUserProfileById(targetUserId);
    if (!target) {
      throw new Error('Customer not found');
    }
    await this.supabase
      .from('entitlements')
      .update({ status: 'revoked' })
      .eq('user_id', targetUserId)
      .eq('status', 'active');
    return this.listCustomerBookAccess(targetUserId);
  }

  async quickUpdateBook(
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
  ): Promise<Book> {
    const existing = await this.getBookBySlugOrId(bookId, true);
    if (!existing) {
      throw new Error('Book not found');
    }
    const nextIsFree = updates.isFree !== undefined ? updates.isFree : existing.isFree;
    const nextPriceCents = nextIsFree
      ? 0
      : updates.priceCents !== undefined
        ? updates.priceCents
        : existing.priceCents;
    let nextSalePriceCents = nextIsFree
      ? null
      : updates.salePriceCents !== undefined
        ? updates.salePriceCents
        : (existing.salePriceCents ?? null);
    if (nextSalePriceCents !== null && nextSalePriceCents >= nextPriceCents) {
      nextSalePriceCents = null;
    }
    const nextSamplePageCount =
      updates.samplePageCount !== undefined ? updates.samplePageCount : existing.samplePageCount;
    const nextStatus = updates.status || existing.status;
    const nextWatermark =
      updates.watermarkEnabled !== undefined ? updates.watermarkEnabled : existing.watermarkEnabled;
    const nextCoverUrl = updates.coverUrl !== undefined ? updates.coverUrl : existing.coverUrl;

    const { error } = await this.supabase
      .from('books')
      .update({
        is_free: nextIsFree,
        price_cents: nextPriceCents,
        sale_price_cents: nextSalePriceCents,
        sample_page_count: nextSamplePageCount,
        status: nextStatus,
        watermark_enabled: nextWatermark,
        cover_url: nextCoverUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) throw new Error(`Failed to update book: ${error.message}`);
    return (await this.getBookBySlugOrId(existing.id, true))!;
  }

  async listPromotions(activeOnly = false): Promise<Promotion[]> {
    const { data: rows, error } = await this.supabase
      .from('promotions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !Array.isArray(rows)) return [];
    const list = (rows as Array<Record<string, unknown>>).map(mapPromotionRow);
    return activeOnly ? list.filter((p) => isPromotionCurrentlyActive(p)) : list;
  }

  async upsertPromotion(
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
  ): Promise<Promotion> {
    const payload = {
      name: data.name,
      scope: data.scope,
      target_id: data.scope === 'library' ? null : data.targetId,
      discount_type: data.discountType,
      discount_value: data.discountValue,
      starts_at: data.startsAt || null,
      ends_at: data.endsAt || null,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };
    const res = id
      ? await this.supabase.from('promotions').update(payload).eq('id', id).select('*').single()
      : await this.supabase.from('promotions').insert(payload).select('*').single();
    const row = this.assertOk(res.data, res.error, 'Failed to save promotion');
    return mapPromotionRow(row as Record<string, unknown>);
  }

  async deletePromotion(promotionId: string): Promise<void> {
    const { error } = await this.supabase.from('promotions').delete().eq('id', promotionId);
    if (error) throw new Error(`Failed to delete promotion: ${error.message}`);
  }

  async listAdminLogs(): Promise<AdminActivityLog[]> {
    const { data: rows } = await this.supabase
      .from('admin_activity_logs')
      .select('*, profiles(email)')
      .order('created_at', { ascending: false })
      .limit(100);

    return (rows || []).map((r) => {
      const prof = r.profiles as { email?: string } | null | undefined;
      return {
        id: String(r.id),
        actorUserId: String(r.actor_user_id),
        actorEmail: prof?.email ? String(prof.email) : undefined,
        action: String(r.action),
        entityType: String(r.entity_type),
        entityId: String(r.entity_id),
        details: parseJsonValue<Record<string, unknown>>(r.details, {}),
        createdAt: String(r.created_at),
      };
    });
  }

  async getSalesReport(
    startDate?: string,
    endDate?: string
  ): Promise<{
    popularBooks: Array<{ bookId: string; title: string; author: string; salesCount: number; revenueCents: number }>;
    dailyRevenue: Array<{ day: string; orderCount: number; revenueCents: number }>;
  }> {
    const { data: rpcData, error: rpcErr } = await this.supabase.rpc('get_sales_report_summary', {
      p_start_date: startDate ? `${startDate}T00:00:00.000Z` : null,
      p_end_date: endDate ? `${endDate}T23:59:59.999Z` : null,
    });
    if (
      !rpcErr &&
      rpcData &&
      typeof rpcData === 'object' &&
      Array.isArray((rpcData as { popularBooks?: unknown }).popularBooks) &&
      Array.isArray((rpcData as { dailyRevenue?: unknown }).dailyRevenue)
    ) {
      return rpcData as {
        popularBooks: Array<{ bookId: string; title: string; author: string; salesCount: number; revenueCents: number }>;
        dailyRevenue: Array<{ day: string; orderCount: number; revenueCents: number }>;
      };
    }

    let paidOrdersQuery = this.supabase
      .from('orders')
      .select('created_at, total_cents')
      .eq('status', 'paid');
    if (startDate && endDate) {
      paidOrdersQuery = paidOrdersQuery
        .gte('created_at', `${startDate}T00:00:00.000Z`)
        .lte('created_at', `${endDate}T23:59:59.999Z`);
    }

    const [{ data: books }, { data: purchases }, { data: paidOrders }] = await Promise.all([
      this.supabase.from('books').select('id, title, author, popularity_score'),
      this.supabase.from('purchases').select('book_id, amount_paid_cents').eq('status', 'completed'),
      paidOrdersQuery,
    ]);

    const purchaseAgg = new Map<string, { sales: number; rev: number }>();
    for (const p of purchases || []) {
      const bId = String(p.book_id);
      const cur = purchaseAgg.get(bId) || { sales: 0, rev: 0 };
      cur.sales += 1;
      cur.rev += Number(p.amount_paid_cents || 0);
      purchaseAgg.set(bId, cur);
    }

    const popularBooks = (books || [])
      .map((b) => {
        const agg = purchaseAgg.get(String(b.id)) || { sales: 0, rev: 0 };
        return {
          bookId: String(b.id),
          title: String(b.title),
          author: String(b.author),
          salesCount: agg.sales,
          revenueCents: agg.rev,
          popularityScore: Number(b.popularity_score || 0),
        };
      })
      .sort((a, b) => b.salesCount - a.salesCount || b.popularityScore - a.popularityScore)
      .slice(0, 10)
      .map(({ popularityScore: _p, ...rest }) => rest);

    const dailyMap = new Map<string, { orderCount: number; revenueCents: number }>();
    for (const o of paidOrders || []) {
      const day = String(o.created_at).slice(0, 10);
      const cur = dailyMap.get(day) || { orderCount: 0, revenueCents: 0 };
      cur.orderCount += 1;
      cur.revenueCents += Number(o.total_cents || 0);
      dailyMap.set(day, cur);
    }

    const dailyRevenue = Array.from(dailyMap.entries())
      .map(([day, agg]) => ({ day, orderCount: agg.orderCount, revenueCents: agg.revenueCents }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 30);

    return { popularBooks, dailyRevenue };
  }

  async listAllReviews(): Promise<AdminReviewItem[]> {
    const { data: rows } = await this.supabase
      .from('reviews')
      .select('id, book_id, user_id, rating, comment, is_published, created_at, books(title), profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(200);

    return (rows || []).map((r) => {
      const bookRef = r.books as { title?: string } | null | undefined;
      const profRef = r.profiles as { full_name?: string; email?: string } | null | undefined;
      return {
        id: String(r.id),
        bookId: String(r.book_id),
        bookTitle: String(bookRef?.title || ''),
        userId: String(r.user_id),
        reviewerName: String(profRef?.full_name || 'Reader'),
        reviewerEmail: String(profRef?.email || ''),
        rating: Number(r.rating),
        comment: String(r.comment),
        isPublished: Boolean(r.is_published),
        createdAt: String(r.created_at),
      };
    });
  }

  async setReviewPublished(reviewId: string, isPublished: boolean): Promise<void> {
    const { data, error } = await this.supabase
      .from('reviews')
      .update({ is_published: isPublished })
      .eq('id', reviewId)
      .select('id');
    if (error || !data || data.length === 0) {
      throw new Error('Review not found');
    }
  }

  async deleteReview(reviewId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('reviews')
      .delete()
      .eq('id', reviewId)
      .select('id');
    if (error || !data || data.length === 0) {
      throw new Error('Review not found');
    }
  }

  async updateCustomerStatus(targetUserId: string, accountStatus: AccountStatus): Promise<UserProfile> {
    const updatePayload: Record<string, unknown> = {
      account_status: accountStatus,
      updated_at: new Date().toISOString(),
    };
    if (accountStatus === 'suspended') {
      const curSv = await this.getSessionVersion(targetUserId);
      updatePayload.session_version = curSv + 1;
    }
    const { data, error } = await this.supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', targetUserId)
      .select('id');
    if (error || !data || data.length === 0) {
      throw new Error('Customer not found');
    }
    return (await this.getUserProfileById(targetUserId))!;
  }

  async listOrdersPaginated(params: {
    statusFilter?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<Order>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const start = (page - 1) * pageSize;
    const search = params.search?.trim().toLowerCase() || '';

    if (search) {
      const allOrders = await this.listAllOrders(params.statusFilter);
      const filtered = allOrders.filter((o) => {
        return (
          o.orderReference.toLowerCase().includes(search) ||
          (o.customerEmail || '').toLowerCase().includes(search) ||
          (o.customerName || '').toLowerCase().includes(search) ||
          (o.billingEmail || '').toLowerCase().includes(search) ||
          (o.payment?.transactionReference || '').toLowerCase().includes(search)
        );
      });
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
      };
    }

    let query = this.supabase.from('orders').select('id', { count: 'exact' });
    if (params.statusFilter && params.statusFilter !== 'all') {
      query = query.eq('status', params.statusFilter);
    }
    const end = start + pageSize - 1;

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(start, end);

    if (error) throw new Error(error.message);
    const orderIds = (data || []).map((r) => String(r.id));
    const items = await Promise.all(orderIds.map((id) => this.getOrderById(id).then((o) => o!)));
    return {
      items: items.filter(Boolean),
      total: count || 0,
      page,
      pageSize,
    };
  }

  async listAllOrdersForExport(params?: { statusFilter?: string; search?: string }): Promise<Order[]> {
    const res = await this.listOrdersPaginated({ ...params, page: 1, pageSize: 5000 });
    return res.items;
  }

  async listCustomersPaginated(params: {
    search?: string;
    statusFilter?: 'all' | AccountStatus;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<AdminCustomerListItem>> {
    const list = await this.listCustomers(params.search, params.statusFilter);
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    return {
      items,
      total: list.length,
      page,
      pageSize,
    };
  }

  async listAllCustomersForExport(params?: {
    search?: string;
    statusFilter?: 'all' | AccountStatus;
  }): Promise<AdminCustomerListItem[]> {
    return this.listCustomers(params?.search, params?.statusFilter);
  }

  async consumeRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
    const now = Math.floor(Date.now() / 1000);
    const reset = now + Math.max(1, windowSeconds);

    const { data: existing } = await this.supabase
      .from('rate_limits')
      .select('count, reset_at')
      .eq('key', key)
      .maybeSingle();

    if (!existing || Number(existing.reset_at) <= now) {
      await this.supabase
        .from('rate_limits')
        .upsert({ key, count: 1, reset_at: reset }, { onConflict: 'key' });
      return { allowed: true, remaining: Math.max(0, maxRequests - 1), retryAfterSec: 0 };
    }

    const count = Number(existing.count);
    const resetAt = Number(existing.reset_at);
    if (count >= maxRequests) {
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, resetAt - now) };
    }

    const nextCount = count + 1;
    await this.supabase
      .from('rate_limits')
      .update({ count: nextCount })
      .eq('key', key);

    return { allowed: true, remaining: Math.max(0, maxRequests - nextCount), retryAfterSec: 0 };
  }

  async setUserAdminRole(targetUserId: string, makeAdmin: boolean, grantedByUserId: string): Promise<UserProfile> {
    const target = await this.getUserProfileById(targetUserId);
    if (!target) {
      throw new Error('Customer not found');
    }
    if (makeAdmin) {
      await this.supabase
        .from('user_roles')
        .upsert({ user_id: targetUserId, role: 'admin', granted_by: grantedByUserId }, { onConflict: 'user_id,role' });
    } else {
      await this.supabase
        .from('user_roles')
        .delete()
        .eq('user_id', targetUserId)
        .in('role', ['admin', 'super_admin']);
    }
    return (await this.getUserProfileById(targetUserId))!;
  }
}
