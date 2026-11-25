-- Khalid Sharif Digital Library - Storage Buckets & Policies
-- Migration 0003: Separate public book covers and strictly private PDFs

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('book-covers', 'book-covers', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('book-pdfs', 'book-pdfs', false, 104857600, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Public read for book covers only
CREATE POLICY "public_read_book_covers"
ON storage.objects FOR SELECT
USING (bucket_id = 'book-covers');

-- Admin upload/update/delete for book covers
CREATE POLICY "admin_manage_book_covers"
ON storage.objects FOR ALL
USING (bucket_id = 'book-covers' AND public.is_admin())
WITH CHECK (bucket_id = 'book-covers' AND public.is_admin());

-- Private PDF bucket: NO public read; only admins can upload/manage, server service_role issues short-lived signed URLs after entitlement verification
CREATE POLICY "admin_manage_book_pdfs"
ON storage.objects FOR ALL
USING (bucket_id = 'book-pdfs' AND public.is_admin())
WITH CHECK (bucket_id = 'book-pdfs' AND public.is_admin());
