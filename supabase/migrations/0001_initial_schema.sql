-- Khalid Sharif Digital Library - Normalized PostgreSQL Schema
-- Migration 0001: Core tables, foreign keys, constraints, and indexes

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('so', 'en', 'ar')),
  preferred_theme TEXT NOT NULL DEFAULT 'light' CHECK (preferred_theme IN ('light', 'dark')),
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. User Roles (strictly separated from profiles; never auto-granted)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer', 'admin', 'super_admin')),
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- 3. Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_so TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description_en TEXT NOT NULL DEFAULT '',
  description_so TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Books
CREATE TABLE IF NOT EXISTS public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  author TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE RESTRICT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('so', 'en', 'ar')),
  publication_year INTEGER,
  publisher TEXT DEFAULT 'Khalid Sharif Press',
  isbn TEXT,
  page_count INTEGER,
  file_format TEXT NOT NULL DEFAULT 'PDF',
  cover_url TEXT,
  is_free BOOLEAN NOT NULL DEFAULT false,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  popularity_score INTEGER NOT NULL DEFAULT 0,
  watermark_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_free_price CHECK ((is_free = true AND price_cents = 0) OR (is_free = false))
);
CREATE INDEX IF NOT EXISTS idx_books_status ON public.books(status);
CREATE INDEX IF NOT EXISTS idx_books_category ON public.books(category_id);
CREATE INDEX IF NOT EXISTS idx_books_featured ON public.books(is_featured) WHERE status = 'published';

-- 5. Book Categories (many-to-many secondary categorization)
CREATE TABLE IF NOT EXISTS public.book_categories (
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

-- 6. Book Files (private storage object metadata)
CREATE TABLE IF NOT EXISTS public.book_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'book-pdfs',
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  sha256_checksum TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_book_files_book ON public.book_files(book_id);

-- 7. Wishlists & Wishlist Items
CREATE TABLE IF NOT EXISTS public.wishlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id UUID NOT NULL REFERENCES public.wishlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id)
);

-- 8. Carts & Cart Items
CREATE TABLE IF NOT EXISTS public.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id)
);

-- 9. Orders & Order Items
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'awaiting_payment', 'processing', 'paid', 'failed', 'cancelled', 'refunded')
  ),
  payment_method_code TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  book_title_snapshot TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, book_id)
);

-- 10. Payment Provider Configurations (non-secret public config only; secrets remain in env)
CREATE TABLE IF NOT EXISTS public.payment_provider_configs (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('online_gateway', 'manual')),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  instructions_en TEXT NOT NULL DEFAULT '',
  instructions_so TEXT NOT NULL DEFAULT '',
  instructions_ar TEXT NOT NULL DEFAULT '',
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Payments & Payment Events (idempotent webhook tracking)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL REFERENCES public.payment_provider_configs(code),
  transaction_reference TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  customer_submitted_reference TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (
    status IN ('initiated', 'pending_verification', 'processing', 'verified', 'failed', 'cancelled', 'refunded')
  ),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  provider_code TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_code, external_event_id)
);

-- 12. Purchases & Entitlements
CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id, order_id)
);

CREATE TABLE IF NOT EXISTS public.entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase', 'free_claim', 'admin_grant')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_book ON public.entitlements(user_id, book_id);

-- 13. Reader State: Progress, Bookmarks, Reading History
CREATE TABLE IF NOT EXISTS public.reading_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL DEFAULT 1 CHECK (current_page >= 1),
  total_pages INTEGER NOT NULL DEFAULT 1 CHECK (total_pages >= 1),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id, page_number)
);

CREATE TABLE IF NOT EXISTS public.reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reading_history_user ON public.reading_history(user_id, opened_at DESC);

-- 14. Notifications & Reviews
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase_confirmed', 'payment_update', 'new_book', 'account')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, user_id)
);

-- 15. Admin Activity Logs, Site Settings & Homepage Sections
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.homepage_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_so TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
