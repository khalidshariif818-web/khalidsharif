-- Khalid Sharif Digital Library - Row Level Security Policies
-- Migration 0002: Server-verifiable role helper and strict RLS per table

-- Secure admin check: NEVER relies on auth.role() = 'authenticated'
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = check_user_id
      AND ur.role IN ('admin', 'super_admin')
  );
$$;

-- Enable RLS on every table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homepage_sections ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update only their own non-privileged fields; admins can view
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- User Roles: read own role or admin; only super_admin/service_role writes
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- Categories: public reads published; admins manage all
CREATE POLICY "categories_public_read" ON public.categories
  FOR SELECT USING (is_published = true OR public.is_admin());

CREATE POLICY "categories_admin_all" ON public.categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Books: public reads published metadata only; admins manage all
CREATE POLICY "books_public_read" ON public.books
  FOR SELECT USING (status = 'published' OR public.is_admin());

CREATE POLICY "books_admin_all" ON public.books
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Book Categories
CREATE POLICY "book_categories_public_read" ON public.book_categories
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.status = 'published' OR public.is_admin()))
  );
CREATE POLICY "book_categories_admin_all" ON public.book_categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Book Files: NEVER readable directly by anonymous or normal customers; admin or service_role only
CREATE POLICY "book_files_admin_only" ON public.book_files
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Wishlists & Wishlist Items: strict owner isolation
CREATE POLICY "wishlists_owner_all" ON public.wishlists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wishlist_items_owner_all" ON public.wishlist_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Carts & Cart Items: strict owner isolation
CREATE POLICY "carts_owner_all" ON public.carts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cart_items_owner_all" ON public.cart_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Orders & Order Items: customers read own orders; ONLY server/service_role creates or mutates orders
CREATE POLICY "orders_select_own_or_admin" ON public.orders
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "order_items_select_own_or_admin" ON public.order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.is_admin()))
  );

-- Payment Provider Configs: public reads enabled provider non-secret info; admins manage
CREATE POLICY "payment_configs_read" ON public.payment_provider_configs
  FOR SELECT USING (is_enabled = true OR public.is_admin());

CREATE POLICY "payment_configs_admin" ON public.payment_provider_configs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Payments & Payment Events: customer reads own payments; server writes only; payment_events admin only
CREATE POLICY "payments_select_own_or_admin" ON public.payments
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "payment_events_admin_select" ON public.payment_events
  FOR SELECT USING (public.is_admin());

-- Purchases & Entitlements: customers read own; ONLY trusted server writes
CREATE POLICY "purchases_select_own_or_admin" ON public.purchases
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "entitlements_select_own_or_admin" ON public.entitlements
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- Reading Progress, Bookmarks, Reading History: owner only
CREATE POLICY "reading_progress_owner_all" ON public.reading_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bookmarks_owner_all" ON public.bookmarks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reading_history_owner_all" ON public.reading_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notifications: owner reads & marks read; server inserts
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reviews: public reads published; authenticated user writes own
CREATE POLICY "reviews_public_read" ON public.reviews
  FOR SELECT USING (is_published = true OR auth.uid() = user_id OR public.is_admin());

CREATE POLICY "reviews_owner_write" ON public.reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reviews_owner_update" ON public.reviews
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Admin Activity Logs: admin read-only (server writes)
CREATE POLICY "admin_logs_admin_read" ON public.admin_activity_logs
  FOR SELECT USING (public.is_admin());

-- Site Settings & Homepage Sections: public read; admin write
CREATE POLICY "site_settings_public_read" ON public.site_settings
  FOR SELECT USING (true);
CREATE POLICY "site_settings_admin_write" ON public.site_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "homepage_sections_public_read" ON public.homepage_sections
  FOR SELECT USING (is_enabled = true OR public.is_admin());
CREATE POLICY "homepage_sections_admin_write" ON public.homepage_sections
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
