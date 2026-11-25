-- Allow multiple pending orders per customer when they cover different books,
-- while preventing duplicate pending orders for the same book.
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

  -- Serialize checkout creation per customer to prevent duplicate pending requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_book_id := (v_item->>'book_id')::UUID;
    v_book_title := COALESCE(v_item->>'book_title_snapshot', 'Book');

    IF EXISTS (
      SELECT 1 FROM public.entitlements
      WHERE user_id = p_user_id AND book_id = v_book_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'You already have active access to "%"', v_book_title;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.user_id = p_user_id
        AND oi.book_id = v_book_id
        AND o.status IN ('pending', 'awaiting_payment', 'processing')
    ) THEN
      RAISE EXCEPTION 'You already have a pending request for "%". You can place a pending request for a different book.', v_book_title;
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    order_reference, user_id, subtotal_cents, discount_cents, total_cents,
    currency, status, payment_method_code, billing_email, billing_phone, notes
  )
  VALUES (
    p_order_reference, p_user_id, p_subtotal_cents, p_discount_cents, p_total_cents,
    p_currency, 'awaiting_payment', p_payment_method_code,
    COALESCE(p_billing_email, ''), COALESCE(p_billing_phone, ''), COALESCE(p_notes, '')
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
