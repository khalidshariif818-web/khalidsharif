import type { ContactChannel, ContactChannelType } from '../shared/types';

export function resolveContactHref(channel: Pick<ContactChannel, 'type' | 'value' | 'url'>): string | null {
  const custom = channel.url?.trim();
  if (custom) {
    if (
      custom.startsWith('http://') ||
      custom.startsWith('https://') ||
      custom.startsWith('tel:') ||
      custom.startsWith('mailto:')
    ) {
      return custom;
    }
  }

  const val = channel.value.trim();
  if (!val) return null;

  switch (channel.type) {
    case 'phone': {
      const cleaned = val.replace(/[^\d+]/g, '');
      return cleaned ? `tel:${cleaned.startsWith('+') ? cleaned : `+${cleaned}`}` : null;
    }
    case 'whatsapp': {
      const digits = val.replace(/\D/g, '');
      return digits ? `https://wa.me/${digits}` : null;
    }
    case 'email':
      return val.includes('@') ? `mailto:${val}` : null;
    case 'telegram':
      if (val.startsWith('http')) return val;
      return `https://t.me/${val.replace(/^@/, '')}`;
    case 'facebook':
      if (val.startsWith('http')) return val;
      return `https://facebook.com/${val.replace(/^@/, '')}`;
    case 'instagram':
      if (val.startsWith('http')) return val;
      return `https://instagram.com/${val.replace(/^@/, '')}`;
    case 'twitter':
      if (val.startsWith('http')) return val;
      return `https://x.com/${val.replace(/^@/, '')}`;
    case 'youtube':
      if (val.startsWith('http')) return val;
      return `https://youtube.com/${val.startsWith('@') ? val : `@${val}`}`;
    case 'website':
      return val.startsWith('http://') || val.startsWith('https://') ? val : `https://${val}`;
    default:
      if (val.startsWith('http://') || val.startsWith('https://')) return val;
      return null;
  }
}

export function contactTypeTranslationKey(type: ContactChannelType): string {
  switch (type) {
    case 'phone':
      return 'contactTypePhone';
    case 'whatsapp':
      return 'contactTypeWhatsapp';
    case 'email':
      return 'contactTypeEmail';
    case 'address':
      return 'contactTypeAddress';
    case 'telegram':
      return 'contactTypeTelegram';
    case 'facebook':
      return 'contactTypeFacebook';
    case 'instagram':
      return 'contactTypeInstagram';
    case 'twitter':
      return 'contactTypeTwitter';
    case 'youtube':
      return 'contactTypeYoutube';
    case 'website':
      return 'contactTypeWebsite';
    case 'hours':
      return 'contactTypeHours';
    default:
      return 'contactTypeOther';
  }
}
