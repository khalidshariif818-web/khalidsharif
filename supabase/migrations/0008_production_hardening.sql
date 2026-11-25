-- Khalid Sharif Digital Library - Production Hardening, Free Samples, Distributed Rate Limits & Strict RLS
-- Migration 0008

-- 1. Add configurable free sample preview pages on books (0..50; 0 = disabled / full open access)
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS sample_page_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_sample_page_count_check;

ALTER TABLE public.books
  ADD CONSTRAINT books_sample_page_count_check
  CHECK (sample_page_count >= 0 AND sample_page_count <= 50);

-- 2. Sync Supabase Auth email verification & profile creation triggers cleanly
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, email_verified)
  VALUES (
    NEW.id,
    LOWER(TRIM(NEW.email)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false)
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

CREATE OR REPLACE FUNCTION public.sync_auth_email_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET email_verified = true,
        updated_at = NOW()
    WHERE id = NEW.id OR LOWER(email) = LOWER(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_verified ON auth.users;
CREATE TRIGGER on_auth_user_email_verified
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_email_verified();

-- 3. Distributed DB-backed sliding/fixed window rate limits (service_role only; zero public RLS policies)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON public.rate_limits(reset_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Atomic rate limit check + increment RPC for multi-instance / serverless Workers & Node
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, retry_after_sec INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now BIGINT := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT;
  v_reset BIGINT := v_now + GREATEST(1, p_window_seconds);
  v_count INTEGER;
  v_cur_reset BIGINT;
BEGIN
  INSERT INTO public.rate_limits (key, count, reset_at)
  VALUES (p_key, 1, v_reset)
  ON CONFLICT (key) DO UPDATE
  SET
    count = CASE
      WHEN public.rate_limits.reset_at <= v_now THEN 1
      ELSE public.rate_limits.count + 1
    END,
    reset_at = CASE
      WHEN public.rate_limits.reset_at <= v_now THEN v_reset
      ELSE public.rate_limits.reset_at
    END
  RETURNING public.rate_limits.count, public.rate_limits.reset_at
  INTO v_count, v_cur_reset;

  IF v_count > p_max_requests THEN
    RETURN QUERY SELECT false, 0, GREATEST(1, (v_cur_reset - v_now)::INTEGER);
  ELSE
    RETURN QUERY SELECT true, GREATEST(0, p_max_requests - v_count), 0;
  END IF;
END;
$$;

-- 4. Prevent direct client manipulation of privileged columns on profiles or calling server-only RPCs
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (
    public.is_admin()
    OR (
      auth.uid() = id
      AND account_status = (SELECT p.account_status FROM public.profiles p WHERE p.id = auth.uid())
      AND email_verified = (SELECT p.email_verified FROM public.profiles p WHERE p.id = auth.uid())
      AND session_version = (SELECT p.session_version FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- Explicit zero-public-access confirmation on internal security tables (service_role bypasses RLS safely)
DROP POLICY IF EXISTS "consumed_tokens_no_public_access" ON public.consumed_tokens;
CREATE POLICY "consumed_tokens_no_public_access" ON public.consumed_tokens
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "rate_limits_no_public_access" ON public.rate_limits;
CREATE POLICY "rate_limits_no_public_access" ON public.rate_limits
  FOR ALL USING (false) WITH CHECK (false);

-- Ensure orders/payments/purchases/entitlements/admin logs cannot be inserted directly by anon/authenticated clients
DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;
CREATE POLICY "user_roles_admin_manage" ON public.user_roles
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Lock down server-only SECURITY DEFINER RPCs so anon/authenticated JWTs cannot execute them directly
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.create_authoritative_order_atomic(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_authoritative_order_atomic(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.setup_first_admin_atomic(TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_first_admin_atomic(TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.verify_payment_and_grant_entitlement(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_payment_and_grant_entitlement(UUID, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.mark_payment_failed_or_cancelled(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payment_failed_or_cancelled(UUID, TEXT, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.submit_manual_payment_reference(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_manual_payment_reference(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_sales_report_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
