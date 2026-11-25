-- Khalid Sharif Digital Library - Atomic Triggers, RPCs & Initial Metadata
-- Migration 0004: Auth profile creation trigger, atomic payment verification RPC, initial categories & settings

-- Automatically create profile + default 'customer' role on new auth.users signup (never 'admin')
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.wishlists (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.carts (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Atomic payment verification and entitlement provisioning RPC (called strictly via service_role on server)
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
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status = 'verified' THEN
    RETURN jsonb_build_object('status', 'already_verified', 'order_id', v_payment.order_id);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  UPDATE public.payments
  SET status = 'verified',
      provider_payment_id = COALESCE(p_provider_payment_id, provider_payment_id),
      verified_at = NOW(),
      verified_by = p_verified_by,
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

-- Seed default payment provider metadata (unconnected until configured)
INSERT INTO public.payment_provider_configs (code, display_name, provider_type, is_enabled, is_connected, instructions_en, instructions_so, instructions_ar, public_config)
VALUES
  ('premier_bank_gateway', 'Premier Bank (Mastercard / Visa)', 'online_gateway', true, false,
   'Pay securely using Mastercard or Visa via Premier Bank.',
   'Ku bixi si ammaan ah kaadhka Mastercard ama Visa adigoo maraya Premier Bank.',
   'ادفع بأمان باستخدام بطاقة ماستركارد أو فيزا عبر بنك بريميير.',
   '{"cardNetworks":["Mastercard","Visa"]}'::jsonb),
  ('manual_transfer', 'Direct Bank Transfer', 'manual', false, true,
   'Transfer the order total to the library bank account and submit your transfer reference for confirmation.',
   'U soo dir wadarta koontada maktabadda kadibna geli tixraaca lacag-dirista si loo xaqiijiyo.',
   'حوّل المبلغ إلى حساب المكتبة وأدخل رقم المرجع ليتم تأكيد الطلب.',
   '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Seed initial homepage sections
INSERT INTO public.homepage_sections (section_key, title_en, title_so, title_ar, sort_order, is_enabled)
VALUES
  ('featured', 'Featured Editions', 'Daabacaadaha Xulka ah', 'إصدارات مختارة', 1, true),
  ('latest', 'Latest Additions', 'Buugaagta Cusub', 'أحدث الإضافات', 2, true),
  ('free', 'Open Access Library', 'Maktabadda Bilaashka ah', 'المكتبة المفتوحة المجانية', 3, true),
  ('paid', 'Premium Monographs', 'Buugaagta La Iibsado', 'الإصدارات المدفوعة', 4, true)
ON CONFLICT (section_key) DO NOTHING;
