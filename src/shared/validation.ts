import { z } from 'zod';

export const languageSchema = z.enum(['so', 'en', 'ar']);
export const themeSchema = z.enum(['light', 'dark']);

export const registerSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').max(200),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  preferredLanguage: languageSchema.optional().default('en'),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(200),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(512),
  newPassword: z.string().min(8).max(128),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  preferredLanguage: languageSchema,
  preferredTheme: themeSchema,
  emailNotifications: z.boolean(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
});

export const bookMutationSchema = z
  .object({
    title: z.string().trim().min(2).max(220),
    subtitle: z.string().trim().max(260).optional().default(''),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(160)
      .regex(/^[a-z0-9-]+$/, 'Slug must contain lowercase letters, numbers, and hyphens'),
    author: z.string().trim().min(2).max(160),
    description: z.string().trim().min(10).max(5000),
    categoryId: z.string().min(1),
    language: languageSchema,
    publicationYear: z.number().int().min(1000).max(2100).nullable().optional(),
    publisher: z.string().trim().max(160).optional().default('Khalid Sharif Press'),
    isbn: z.string().trim().max(40).nullable().optional(),
    pageCount: z.number().int().min(1).max(10000).nullable().optional(),
    samplePageCount: z.number().int().min(0).max(50).optional().default(0),
    isFree: z.boolean(),
    priceCents: z.number().int().min(0).max(1000000),
    salePriceCents: z.number().int().min(0).max(1000000).nullable().optional().default(null),
    status: z.enum(['draft', 'published', 'archived']),
    isFeatured: z.boolean().optional().default(false),
    isRecommended: z.boolean().optional().default(false),
    watermarkEnabled: z.boolean().optional().default(true),
    coverUrl: z.string().trim().max(500).nullable().optional(),
  })
  .refine((data) => (data.isFree ? data.priceCents === 0 : data.priceCents > 0), {
    message: 'Free books must have price 0, and paid books must have a positive price',
    path: ['priceCents'],
  })
  .refine(
    (data) =>
      data.salePriceCents === null ||
      data.salePriceCents === undefined ||
      (!data.isFree && data.salePriceCents >= 0 && data.salePriceCents < data.priceCents),
    {
      message: 'Sale price must be less than the regular price and only applies to paid books',
      path: ['salePriceCents'],
    }
  );

export const categoryMutationSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  nameEn: z.string().trim().min(2).max(100),
  nameSo: z.string().trim().min(2).max(100),
  nameAr: z.string().trim().min(2).max(100),
  descriptionEn: z.string().trim().max(600).optional().default(''),
  descriptionSo: z.string().trim().max(600).optional().default(''),
  descriptionAr: z.string().trim().max(600).optional().default(''),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  seoTitle: z.string().trim().max(160).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
  isPublished: z.boolean().optional().default(true),
});

export const checkoutCreateSchema = z.object({
  bookIds: z.array(z.string().min(1)).min(1, 'At least one book is required'),
  paymentMethodCode: z.string().min(1),
  discountCode: z.string().trim().max(40).optional(),
  billingEmail: z.string().trim().email('Please enter a valid billing email').max(200).optional(),
  billingPhone: z.string().trim().min(5, 'Please enter a valid billing phone').max(40).optional(),
  notes: z.string().trim().max(500).optional().default(''),
});

export const manualReferenceSubmitSchema = z.object({
  customerReference: z.string().trim().min(3, 'Enter a valid payment reference').max(120),
});

export const readingProgressSchema = z.object({
  currentPage: z.number().int().min(1).max(20000),
  totalPages: z.number().int().min(1).max(20000),
});

export const bookmarkCreateSchema = z.object({
  pageNumber: z.number().int().min(1).max(20000),
  label: z.string().trim().max(120).optional().default(''),
});

export const reviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(2000),
});

export const contactChannelTypeSchema = z.enum([
  'phone',
  'whatsapp',
  'email',
  'address',
  'telegram',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'website',
  'hours',
  'other',
]);

export const contactChannelSchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: contactChannelTypeSchema,
  label: z.string().trim().min(1, 'Contact label is required').max(80),
  value: z.string().trim().min(1, 'Contact value is required').max(260),
  url: z.string().trim().max(400).optional().default(''),
  isPrimary: z.boolean().optional().default(false),
  isEnabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
});

export const contactChannelsUpdateSchema = z.object({
  channels: z.array(contactChannelSchema).max(50),
});

export const discountCodeEntrySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Discount code must be at least 2 characters')
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may only contain letters, numbers, hyphens, and underscores'),
  percent: z.number().int().min(1).max(95),
});

export const discountCodesUpdateSchema = z.object({
  codes: z.array(discountCodeEntrySchema).max(100),
});

export const adminSetupSchema = z.object({
  email: z.string().trim().email('Please enter a valid Gmail or email address').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  fullName: z.string().trim().min(2).max(120).optional().default('Library Admin'),
  bootstrapToken: z.string().trim().max(512).optional(),
});

export const gatewayModeSchema = z.enum(['mpgs_hosted', 'rest_redirect']);

export const paymentGatewayCredentialsUpdateSchema = z.object({
  gatewayMode: gatewayModeSchema.default('mpgs_hosted'),
  gatewayUrl: z.string().trim().max(400).default(''),
  merchantId: z.string().trim().max(160).default(''),
  apiVersion: z.string().trim().max(24).optional().default('73'),
  apiKey: z.string().trim().max(512).optional(),
  webhookSecret: z.string().trim().max(512).optional(),
  clearSecrets: z.boolean().optional().default(false),
});

export const manualPaymentProviderCreateSchema = z.object({
  displayName: z.string().trim().min(2, 'Payment method name must be at least 2 characters').max(80),
  accountNumber: z.string().trim().min(3, 'Enter an account number or USSD code').max(120),
  instructionsEn: z.string().trim().max(1200).optional().default(''),
  instructionsSo: z.string().trim().max(1200).optional().default(''),
  instructionsAr: z.string().trim().max(1200).optional().default(''),
});

export const paymentProviderUpdateSchema = z.object({
  isEnabled: z.boolean(),
  instructionsEn: z.string().trim().max(1200),
  instructionsSo: z.string().trim().max(1200),
  instructionsAr: z.string().trim().max(1200),
  ussdTemplate: z.string().trim().max(120).regex(/^[0-9*#+.{}a-zA-Z]*$/, 'USSD code can only contain dial characters and placeholders').refine((value) => !value || (/\{\{amount\}\}/i.test(value) && /^[0-9*#+.]+$/.test(value.replace(/\{\{amount\}\}/gi, ''))), 'USSD code must contain {{amount}} and only dial characters').optional(),
  accountNumber: z.string().trim().min(3).max(120).optional(),
});

export const reviewModerationSchema = z.object({
  isPublished: z.boolean(),
});

export const accountStatusSchema = z.enum(['active', 'paused', 'suspended']);

export const customerStatusUpdateSchema = z.object({
  accountStatus: accountStatusSchema,
});

export const customerRoleUpdateSchema = z.object({
  isAdmin: z.boolean(),
});

export const adminCreateUserSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  preferredLanguage: languageSchema.optional().default('so'),
  accountStatus: accountStatusSchema.optional().default('active'),
  isAdmin: z.boolean().optional().default(false),
  grantAll: z.boolean().optional().default(false),
  bookIds: z.array(z.string().min(1)).optional().default([]),
});

export const adminUpdateCustomerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  preferredLanguage: languageSchema,
  accountStatus: accountStatusSchema,
  newPassword: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 8, 'New password must be at least 8 characters'),
});

export const adminGrantBooksSchema = z
  .object({
    grantAll: z.boolean().optional().default(false),
    bookIds: z.array(z.string().min(1)).optional().default([]),
    reason: z.string().trim().max(300).optional().default(''),
  })
  .refine((data) => data.grantAll || data.bookIds.length > 0, {
    message: 'Select at least one book or choose Unlock All Books',
  });

export const adminBookQuickUpdateSchema = z
  .object({
    isFree: z.boolean().optional(),
    priceCents: z.number().int().min(0).max(1000000).optional(),
    salePriceCents: z.number().int().min(0).max(1000000).nullable().optional(),
    samplePageCount: z.number().int().min(0).max(50).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    watermarkEnabled: z.boolean().optional(),
    coverUrl: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.isFree === false && (data.priceCents === undefined || data.priceCents <= 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'Paid books must have a positive price',
      path: ['priceCents'],
    }
  )
  .refine(
    (data) => {
      if (
        data.salePriceCents !== null &&
        data.salePriceCents !== undefined &&
        data.priceCents !== undefined &&
        data.salePriceCents >= data.priceCents
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Sale price must be less than the regular price',
      path: ['salePriceCents'],
    }
  );

export const supabaseSessionExchangeSchema = z.object({
  accessToken: z.string().trim().min(20, 'Valid access token is required').max(8192),
});

export const promotionMutationSchema = z
  .object({
    name: z.string().trim().min(2, 'Promotion name is required').max(120),
    scope: z.enum(['library', 'category', 'book']),
    targetId: z.string().trim().min(1).nullable().optional().default(null),
    discountType: z.enum(['percent', 'fixed_cents']),
    discountValue: z.number().int().min(1).max(1000000),
    startsAt: z.string().trim().nullable().optional().default(null),
    endsAt: z.string().trim().nullable().optional().default(null),
    isActive: z.boolean().optional().default(true),
  })
  .refine((data) => (data.scope === 'library' ? true : Boolean(data.targetId)), {
    message: 'Select a target category or book for this promotion',
    path: ['targetId'],
  })
  .refine((data) => (data.discountType === 'percent' ? data.discountValue <= 95 : true), {
    message: 'Percentage discount cannot exceed 95%',
    path: ['discountValue'],
  });

export function parsePaginationQuery(params: { page?: string; pageSize?: string; defaultPageSize?: number; maxPageSize?: number }): {
  page: number;
  pageSize: number;
} {
  const maxPageSize = params.maxPageSize ?? 50;
  const defaultPageSize = params.defaultPageSize ?? 20;
  const rawPage = Number(params.page);
  const rawPageSize = Number(params.pageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(maxPageSize, Math.floor(rawPageSize)) : defaultPageSize;
  return { page, pageSize };
}
