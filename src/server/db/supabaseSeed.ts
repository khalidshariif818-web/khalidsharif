import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateEditorialBookPdf } from '../pdf/generator.ts';
import {
  DEFAULT_CONTACT_CHANNELS,
  DEFAULT_DISCOUNT_CODES,
  MANUAL_INST_AR,
  MANUAL_INST_EN,
  MANUAL_INST_SO,
  PREMIER_INST_AR,
  PREMIER_INST_EN,
  PREMIER_INST_SO,
  SEED_BOOKS,
  SEED_CATEGORIES,
  deterministicSeedUuid,
} from './seedCatalog.ts';

export async function ensureSupabaseSeedData(supabase: SupabaseClient): Promise<void> {
  // 1. Clean deprecated gateway records & ensure payment provider metadata exists
  await supabase
    .from('payment_provider_configs')
    .delete()
    .in('code', ['stripe_checkout', 'hosted_webhook_gateway']);

  await supabase.from('payment_provider_configs').upsert(
    [
      {
        code: 'premier_bank_gateway',
        display_name: 'Mastercard / Visa',
        provider_type: 'online_gateway',
        is_enabled: true,
        is_connected: false,
        instructions_en: 'Pay securely using your Mastercard or Visa debit/credit card.',
        instructions_so: 'Ku bixi si toos ah oo ammaan ah kaadhkaaga Mastercard ama Visa.',
        instructions_ar: 'ادفع بأمان وسرعة باستخدام بطاقتك ماستركارد أو فيزا.',
        public_config: { cardNetworks: ['Mastercard', 'Visa'] },
      },
    ],
    { onConflict: 'code', ignoreDuplicates: true }
  );

  await supabase.from('payment_provider_configs').upsert(
    [{
      code: 'manual_transfer',
      display_name: 'Direct Bank Transfer',
      provider_type: 'manual',
      is_enabled: false,
      is_connected: true,
      instructions_en: MANUAL_INST_EN,
      instructions_so: MANUAL_INST_SO,
      instructions_ar: MANUAL_INST_AR,
      public_config: {},
    }],
    { onConflict: 'code', ignoreDuplicates: true }
  );

  // 2. Ensure homepage sections
  await supabase.from('homepage_sections').upsert(
    [
      {
        section_key: 'featured',
        title_en: 'Featured Editions',
        title_so: 'Daabacaadaha Xulka ah',
        title_ar: 'إصدارات مختارة',
        sort_order: 1,
        is_enabled: true,
      },
      {
        section_key: 'latest',
        title_en: 'Latest Additions',
        title_so: 'Buugaagta Cusub',
        title_ar: 'أحدث الإضافات',
        sort_order: 2,
        is_enabled: true,
      },
      {
        section_key: 'free',
        title_en: 'Open Access Editions',
        title_so: 'Daabacaadaha Furan',
        title_ar: 'الإصدارات المفتوحة',
        sort_order: 3,
        is_enabled: true,
      },
      {
        section_key: 'paid',
        title_en: 'Premium Monographs',
        title_so: 'Buugaagta La Iibsado',
        title_ar: 'الإصدارات المدفوعة',
        sort_order: 4,
        is_enabled: true,
      },
    ],
    { onConflict: 'section_key', ignoreDuplicates: true }
  );

  // 3. Ensure default site_settings
  await supabase.from('site_settings').upsert(
    [
      { key: 'library_name', value: 'Khalid Sharif Digital Library' },
      { key: 'discount_codes', value: DEFAULT_DISCOUNT_CODES },
      { key: 'contact_channels', value: DEFAULT_CONTACT_CHANNELS },
    ],
    { onConflict: 'key', ignoreDuplicates: true }
  );

  // 4. Categories (idempotent check)
  const { count: catCount } = await supabase.from('categories').select('*', { count: 'exact', head: true });
  const categoryUuidMap = new Map<string, string>();
  for (const cat of SEED_CATEGORIES) {
    categoryUuidMap.set(cat.id, deterministicSeedUuid(cat.id));
  }

  if ((catCount ?? 0) === 0) {
    await supabase.from('categories').upsert(
      SEED_CATEGORIES.map((c) => ({
        id: categoryUuidMap.get(c.id)!,
        slug: c.slug,
        name_en: c.nameEn,
        name_so: c.nameSo,
        name_ar: c.nameAr,
        description_en: c.descriptionEn,
        description_so: c.descriptionSo,
        description_ar: c.descriptionAr,
        image_url: c.imageUrl,
        sort_order: c.sortOrder,
        is_published: true,
      })),
      { onConflict: 'slug', ignoreDuplicates: true }
    );
  }

  // 5. Books + private PDFs uploaded to Supabase Storage bucket 'book-pdfs'
  const { count: bookCount } = await supabase.from('books').select('*', { count: 'exact', head: true });
  if ((bookCount ?? 0) < SEED_BOOKS.length) {
    for (const b of SEED_BOOKS) {
      const { data: existing } = await supabase.from('books').select('id').eq('slug', b.slug).maybeSingle();
      if (existing) continue;
      const bookUuid = deterministicSeedUuid(b.id);
      const catUuid = categoryUuidMap.get(b.categoryId) || deterministicSeedUuid(b.categoryId);
      const pdfBytes = await generateEditorialBookPdf({
        title: b.title,
        subtitle: b.subtitle,
        author: b.author,
        publisher: b.publisher,
        year: b.publicationYear,
        isbn: b.isbn,
        chapters: b.chapters,
      });

      const filename = `${b.slug}.pdf`;
      const checksum = crypto.createHash('sha256').update(pdfBytes).digest('hex');

      await supabase.from('books').upsert(
        {
          id: bookUuid,
          slug: b.slug,
          title: b.title,
          subtitle: b.subtitle,
          author: b.author,
          description: b.description,
          category_id: catUuid,
          language: b.language,
          publication_year: b.publicationYear,
          publisher: b.publisher,
          isbn: b.isbn,
          page_count: b.chapters.length + 2,
          sample_page_count: b.isFree ? 0 : (b.samplePageCount ?? 2),
          file_format: 'PDF',
          cover_url: b.coverUrl,
          is_free: b.isFree,
          price_cents: b.priceCents,
          currency: 'USD',
          status: 'published',
          is_featured: b.isFeatured,
          is_recommended: b.isRecommended,
          popularity_score: b.popularityScore,
          watermark_enabled: true,
        },
        { onConflict: 'slug', ignoreDuplicates: true }
      );

      // Upload PDF to private 'book-pdfs' bucket (non-fatal if bucket wasn't created yet)
      await supabase.storage
        .from('book-pdfs')
        .upload(filename, pdfBytes, { contentType: 'application/pdf', upsert: true })
        .catch(() => null);

      await supabase.from('book_files').insert({
        book_id: bookUuid,
        storage_bucket: 'book-pdfs',
        storage_path: filename,
        original_filename: filename,
        mime_type: 'application/pdf',
        file_size_bytes: pdfBytes.byteLength,
        sha256_checksum: checksum,
        is_active: true,
      });
    }
  }
}
