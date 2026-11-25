-- Khalid Sharif Digital Library - Security Hardening, Atomic Order RPC, Sales Aggregation & Promotions
-- Migration 0007

-- 1. Tighten site_settings RLS so encrypted payment gateway credentials & discount codes are never publicly readable
DROP POLICY IF EXISTS "site_settings_public_read" ON public.site_settings;
CREATE POLICY "site_settings_public_read" ON public.site_settings
  FOR SELECT USING (key = 'contact_channels' OR public.is_admin());

-- 2. Add session_version to profiles for server-side session revocation
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

-- 3. Add billing_email and billing_phone snapshot columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS billing_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_phone TEXT NOT NULL DEFAULT '';

-- 4. Add per-book sale_price_cents column
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS sale_price_cents INTEGER;

ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_sale_price_check;

ALTER TABLE public.books
  ADD CONSTRAINT books_sale_price_check
  CHECK (sale_price_cents IS NULL OR (sale_price_cents >= 0 AND sale_price_cents < price_cents));

-- 5. Promotions table (Library, Category, or Book level; non-stacking enforced in app + server)
CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('library', 'category', 'book')),
  target_id UUID,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed_cents')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions(is_active, scope);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promotions_public_read" ON public.promotions;
CREATE POLICY "promotions_public_read" ON public.promotions
  FOR SELECT USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "promotions_admin_all" ON public.promotions;
CREATE POLICY "promotions_admin_all" ON public.promotions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 6. Single-use consumed_tokens table (service_role only; RLS enabled with zero public policies)
CREATE TABLE IF NOT EXISTS public.consumed_tokens (
  jti_hash TEXT PRIMARY KEY,
  token_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumed_tokens_expires ON public.consumed_tokens(expires_at);

ALTER TABLE public.consumed_tokens ENABLE ROW LEVEL SECURITY;

-- 7. Atomic order + order_items + payment creation RPC (strictly server-side via service_role)
CREATE OR REPLACE FUNCTION public.create_authoritative_order_atomic(
  p_user_id UUID,
  p_order_reference TEXT,
  p_transaction_reference TEXT,
  p_subtotal_cents INTEGER,
  p_discount_cents INTEGER,
  p_total_cents INTEGER,
  p_currency TEXT,
  p_payment_method_code TEXT,
  p_billing_email TEXT DEFAULT '',
  p_billing_phone TEXT DEFAULT '',
  p_notes TEXT DEFAULT '',
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_payment_id UUID;
  v_item JSONB;
  v_book_id UUID;
  v_book_title TEXT;
  v_unit_price INTEGER;
BEGIN
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;

  -- Check active entitlement inside transaction to prevent duplicate purchase races
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_book_id := (v_item->>'book_id')::UUID;
    v_book_title := COALESCE(v_item->>'book_title_snapshot', 'Book');
    IF EXISTS (
      SELECT 1 FROM public.entitlements
      WHERE user_id = p_user_id AND book_id = v_book_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'You already have active access to "%"', v_book_title;
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    order_reference, user_id, subtotal_cents, discount_cents, total_cents,
    currency, status, payment_method_code, billing_email, billing_phone, notes
  )
  VALUES (
    p_order_reference, p_user_id, p_subtotal_cents, p_discount_cents, p_total_cents,
    p_currency, 'awaiting_payment', p_payment_method_code, COALESCE(p_billing_email, ''), COALESCE(p_billing_phone, ''), COALESCE(p_notes, '')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_book_id := (v_item->>'book_id')::UUID;
    v_book_title := COALESCE(v_item->>'book_title_snapshot', '');
    v_unit_price := COALESCE((v_item->>'unit_price_cents')::INTEGER, 0);

    INSERT INTO public.order_items (order_id, book_id, book_title_snapshot, unit_price_cents)
    VALUES (v_order_id, v_book_id, v_book_title, v_unit_price);
  END LOOP;

  INSERT INTO public.payments (
    order_id, user_id, provider_code, transaction_reference, amount_cents, currency, status
  )
  VALUES (
    v_order_id, p_user_id, p_payment_method_code, p_transaction_reference, p_total_cents, p_currency, 'initiated'
  )
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('order_id', v_order_id, 'payment_id', v_payment_id);
END;
$$;

-- 8. SQL-backed sales report aggregation RPC
CREATE OR REPLACE FUNCTION public.get_sales_report_summary(
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_popular JSONB;
  v_daily JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_popular
  FROM (
    SELECT
      p.book_id::TEXT AS "bookId",
      COALESCE(b.title, 'Unknown') AS "title",
      COALESCE(b.author, 'Unknown') AS "author",
      COUNT(*)::INTEGER AS "salesCount",
      COALESCE(SUM(p.amount_paid_cents), 0)::INTEGER AS "revenueCents"
    FROM public.purchases p
    LEFT JOIN public.books b ON b.id = p.book_id
    WHERE p.status = 'completed'
      AND (p_start_date IS NULL OR p.purchased_at >= p_start_date)
      AND (p_end_date IS NULL OR p.purchased_at <= p_end_date)
    GROUP BY p.book_id, b.title, b.author
    ORDER BY "salesCount" DESC, "revenueCents" DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      to_char(date_trunc('day', o.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "day",
      COUNT(*)::INTEGER AS "orderCount",
      COALESCE(SUM(o.total_cents), 0)::INTEGER AS "revenueCents"
    FROM public.orders o
    WHERE o.status = 'paid'
      AND (p_start_date IS NULL OR o.created_at >= p_start_date)
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 30
  ) d;

  RETURN jsonb_build_object('popularBooks', v_popular, 'dailyRevenue', v_daily);
END;
$$;
