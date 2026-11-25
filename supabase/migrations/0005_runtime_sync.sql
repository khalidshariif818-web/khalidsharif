-- Khalid Sharif Digital Library - Runtime Synchronization & Atomic Server RPCs
-- Migration 0005: Align PostgreSQL schema with Hono backend repository & add atomic RPC helpers

-- 1. Allow server-managed authentication profiles alongside optional Supabase Auth users
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. Add gateway_metadata JSONB column on payments for Hosted Checkout session verification
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS gateway_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Remove any deprecated gateway entries and ensure clean customer-facing labels
DELETE FROM public.payment_provider_configs WHERE code IN ('stripe_checkout', 'hosted_webhook_gateway');

UPDATE public.payment_provider_configs
SET display_name = 'Premier Bank (Mastercard / Visa)',
    instructions_en = 'Pay securely using Mastercard or Visa via Premier Bank.',
    instructions_so = 'Ku bixi si ammaan ah kaadhka Mastercard ama Visa adigoo maraya Premier Bank.',
    instructions_ar = 'ادفع بأمان باستخدام بطاقة ماستركارد أو فيزا عبر بنك بريميير.',
    public_config = COALESCE(public_config, '{}'::jsonb) || '{"cardNetworks":["Mastercard","Visa"]}'::jsonb,
    updated_at = NOW()
WHERE code = 'premier_bank_gateway';

UPDATE public.payment_provider_configs
SET display_name = 'Direct Bank Transfer',
    instructions_en = 'Transfer the order total to the library bank account and submit your transfer reference for confirmation.',
    instructions_so = 'U soo dir wadarta koontada maktabadda kadibna geli tixraaca lacag-dirista si loo xaqiijiyo.',
    instructions_ar = 'حوّل المبلغ إلى حساب المكتبة وأدخل رقم المرجع ليتم تأكيد الطلب.',
    updated_at = NOW()
WHERE code = 'manual_transfer';

-- 4. Update verify_payment_and_grant_entitlement so cart items are cleared atomically
CREATE OR REPLACE FUNCTION public.verify_payment_and_grant_entitlement(
  p_payment_id UUID,
  p_provider_payment_id TEXT DEFAULT NULL,
  p_verified_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item RECORD;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status = 'verified' THEN
    RETURN jsonb_build_object('status', 'already_verified', 'order_id', v_payment.order_id);
  END IF;

  IF v_payment.status NOT IN ('initiated', 'pending_verification', 'processing') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status NOT IN ('pending', 'awaiting_payment', 'processing') THEN
    RAISE EXCEPTION 'INVALID_ORDER_TRANSITION';
  END IF;

  UPDATE public.payments
  SET status = 'verified',
      provider_payment_id = COALESCE(p_provider_payment_id, provider_payment_id),
      verified_at = NOW(),
      verified_by = COALESCE(p_verified_by, verified_by),
      updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE public.orders
  SET status = 'paid',
      updated_at = NOW()
  WHERE id = v_order.id;

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id LOOP
    INSERT INTO public.purchases (user_id, order_id, payment_id, book_id, amount_paid_cents, currency, status)
    VALUES (v_order.user_id, v_order.id, v_payment.id, v_item.book_id, v_item.unit_price_cents, v_order.currency, 'completed')
    ON CONFLICT (user_id, book_id, order_id) DO NOTHING;

    INSERT INTO public.entitlements (user_id, book_id, source_type, order_id, status)
    VALUES (v_order.user_id, v_item.book_id, 'purchase', v_order.id, 'active')
    ON CONFLICT (user_id, book_id) DO UPDATE SET status = 'active', order_id = v_order.id;

    DELETE FROM public.cart_items WHERE user_id = v_order.user_id AND book_id = v_item.book_id;

    UPDATE public.books SET popularity_score = popularity_score + 1 WHERE id = v_item.book_id;
  END LOOP;

  INSERT INTO public.notifications (user_id, type, title, message, link_url)
  VALUES (
    v_order.user_id,
    'purchase_confirmed',
    'Purchase Verified & Books Unlocked',
    'Your payment for order ' || v_order.order_reference || ' is verified. Your books are ready in My Library.',
    '/account/library'
  );

  RETURN jsonb_build_object('status', 'verified', 'order_id', v_order.id);
END;
$$;

-- 5. Atomic one-time first-admin setup RPC (protected by transaction advisory lock)
CREATE OR REPLACE FUNCTION public.setup_first_admin_atomic(
  p_email TEXT,
  p_password_hash TEXT,
  p_full_name TEXT,
  p_preferred_language TEXT DEFAULT 'so',
  p_existing_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(9482716);

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'ADMIN_ALREADY_EXISTS';
  END IF;

  IF p_existing_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, granted_by)
    VALUES (p_existing_user_id, 'super_admin', p_existing_user_id)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN p_existing_user_id;
  END IF;

  INSERT INTO public.profiles (email, password_hash, full_name, preferred_language, email_verified)
  VALUES (LOWER(TRIM(p_email)), p_password_hash, p_full_name, p_preferred_language, true)
  RETURNING id INTO v_user_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (v_user_id, 'super_admin', v_user_id)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.wishlists (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.carts (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;

  RETURN v_user_id;
END;
$$;

-- 6. Atomic manual transfer reference submission RPC
CREATE OR REPLACE FUNCTION public.submit_manual_payment_reference(
  p_user_id UUID,
  p_order_id UUID,
  p_customer_reference TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.user_id <> p_user_id THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status IN ('paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATE';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = v_order.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  UPDATE public.payments
  SET customer_submitted_reference = p_customer_reference,
      status = 'pending_verification',
      updated_at = NOW()
  WHERE id = v_payment.id;

  UPDATE public.orders
  SET status = 'processing',
      updated_at = NOW()
  WHERE id = v_order.id;

  INSERT INTO public.notifications (user_id, type, title, message, link_url)
  VALUES (
    p_user_id,
    'payment_update',
    'Payment Reference Received',
    'Reference ' || p_customer_reference || ' submitted for order ' || v_order.order_reference || '. Your access will unlock as soon as payment is confirmed.',
    '/account/purchases'
  );

  RETURN v_order.id;
END;
$$;

-- 7. Atomic payment failure / cancellation / refund RPC
CREATE OR REPLACE FUNCTION public.mark_payment_failed_or_cancelled(
  p_payment_id UUID,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL,
  p_actor_admin_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_target_status NOT IN ('failed', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF (p_target_status IN ('failed', 'cancelled') AND v_payment.status NOT IN ('initiated', 'pending_verification', 'processing'))
     OR (p_target_status = 'refunded' AND v_payment.status <> 'verified') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF (p_target_status IN ('failed', 'cancelled') AND v_order.status NOT IN ('pending', 'awaiting_payment', 'processing'))
     OR (p_target_status = 'refunded' AND v_order.status <> 'paid') THEN
    RAISE EXCEPTION 'INVALID_ORDER_TRANSITION';
  END IF;

  UPDATE public.payments
  SET status = p_target_status,
      failure_reason = p_reason,
      verified_by = COALESCE(p_actor_admin_id, verified_by),
      updated_at = NOW()
  WHERE id = v_payment.id;

  UPDATE public.orders
  SET status = p_target_status,
      updated_at = NOW()
  WHERE id = v_order.id;

  IF p_target_status = 'refunded' THEN
    UPDATE public.purchases SET status = 'refunded' WHERE order_id = v_order.id;
    UPDATE public.entitlements SET status = 'revoked' WHERE order_id = v_order.id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, link_url)
  VALUES (
    v_order.user_id,
    'payment_update',
    'Order ' || UPPER(p_target_status),
    'Order ' || v_order.order_reference || ' status changed to ' || p_target_status || CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN '. ' || p_reason ELSE '' END,
    '/account/purchases'
  );

  RETURN v_order.id;
END;
$$;
