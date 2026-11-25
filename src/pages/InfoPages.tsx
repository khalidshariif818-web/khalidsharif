import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../lib/api';
import { contactTypeTranslationKey, resolveContactHref } from '../lib/contacts';
import { SeoHead } from '../components/SeoHead';
import type { ContactChannel, ContactChannelType, LanguageCode } from '../shared/types';

function ChannelIcon({ type }: { type: ContactChannelType }) {
  switch (type) {
    case 'phone':
      return <Phone className="w-5 h-5" />;
    case 'whatsapp':
      return <MessageCircle className="w-5 h-5" />;
    case 'email':
      return <Mail className="w-5 h-5" />;
    case 'address':
      return <MapPin className="w-5 h-5" />;
    case 'telegram':
      return <Send className="w-5 h-5" />;
    case 'hours':
      return <Clock className="w-5 h-5" />;
    case 'website':
      return <Globe className="w-5 h-5" />;
    default:
      return <Share2 className="w-5 h-5" />;
  }
}

export const ContactPage: React.FC = () => {
  const { t } = useApp();
  const [channels, setChannels] = useState<ContactChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch<{ channels: ContactChannel[] }>('/api/contact-channels')
      .then((res) => {
        if (active && Array.isArray(res.channels)) {
          setChannels(res.channels);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <>
      <SeoHead
        title={`${t('navContact')} – ${t('brandName')}`}
        description={t('contactSubtitle')}
      />
      <div className="max-w-5xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-10">
        <div className="bg-white dark:bg-slate-900 border-y sm:border border-[#D5CEB8] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-xs px-4 py-5 sm:p-8 lg:p-10 space-y-6">
          <div className="space-y-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-5">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t('backToCatalog')}</span>
            </Link>
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2C2C2C] dark:text-stone-100">
              {t('contactTitle')}
            </h1>
            <p className="text-sm text-[#666155] dark:text-slate-400 max-w-2xl leading-relaxed">
              {t('contactSubtitle')}
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-lg bg-[#F7F6F0] dark:bg-slate-800/60 animate-pulse border border-[#E5E0CE] dark:border-slate-800"
                />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="p-6 rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 text-sm text-[#666155] dark:text-slate-400">
              {t('contactEmpty')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {channels.map((ch) => {
                const href = resolveContactHref(ch);
                const isExternal = Boolean(href && href.startsWith('http'));
                return (
                  <div
                    key={ch.id}
                    className={`rounded-lg p-5 border transition-colors flex flex-col justify-between gap-4 ${
                      ch.isPrimary
                        ? 'bg-[#F7F6F0] dark:bg-slate-950/70 border-[#0376B8]/40 dark:border-sky-500/40'
                        : 'bg-[#FAF9F5] dark:bg-slate-950/40 border-[#E5E0CE] dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-lg bg-[#0376B8]/10 dark:bg-sky-500/15 text-[#0376B8] dark:text-sky-400 flex items-center justify-center shrink-0">
                        <ChannelIcon type={ch.type} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[#666155] dark:text-slate-400">
                            {t(contactTypeTranslationKey(ch.type))}
                          </span>
                          {ch.isPrimary && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#0376B8] text-white">
                              {t('contactPrimaryBadge')}
                            </span>
                          )}
                        </div>
                        <h2 className="text-base font-semibold text-[#2C2C2C] dark:text-stone-100 break-words">
                          {ch.label}
                        </h2>
                        <p
                          dir="ltr"
                          className="font-mono-tabular text-sm sm:text-base font-medium text-[#02598B] dark:text-sky-300 break-all"
                        >
                          {ch.value}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E5E0CE] dark:border-slate-800">
                      {href && (
                        <a
                          href={href}
                          target={isExternal ? '_blank' : undefined}
                          rel={isExternal ? 'noopener noreferrer' : undefined}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white text-xs font-semibold transition-colors"
                        >
                          <span>{t('contactOpenBtn')}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCopy(ch.id, ch.value)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#CCC4B0] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-[#333333] dark:text-slate-200 hover:bg-[#F3EFE2] dark:hover:bg-slate-800 transition-colors"
                      >
                        {copiedId === ch.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{t('contactCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('contactCopyBtn')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-lg bg-[#F7F6F0] dark:bg-slate-950/60 border border-[#E5E0CE] dark:border-slate-800 p-4 sm:p-5 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#0376B8] dark:text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#2C2C2C] dark:text-stone-100">
                {t('contactSupportHoursNote')}
              </p>
              <p className="text-xs sm:text-sm text-[#666155] dark:text-slate-400 leading-relaxed">
                {t('contactSupportHoursDesc')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

interface PolicySection {
  heading: string;
  body: string;
}

function LegalDocumentPage({
  title,
  subtitle,
  sections,
}: {
  title: string;
  subtitle: string;
  sections: PolicySection[];
}) {
  const { t } = useApp();
  return (
    <>
      <SeoHead title={`${title} – ${t('brandName')}`} description={subtitle} />
      <div className="max-w-4xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-10">
        <article className="bg-white dark:bg-slate-900 border-y sm:border border-[#D5CEB8] dark:border-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-xs px-4 py-5 sm:p-8 lg:p-10 space-y-6">
          <header className="space-y-2 border-b border-[#E5E0CE] dark:border-slate-800 pb-5">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0376B8] dark:text-sky-400 hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t('backToCatalog')}</span>
            </Link>
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2C2C2C] dark:text-stone-100">
              {title}
            </h1>
            <p className="text-sm text-[#666155] dark:text-slate-400 leading-relaxed">{subtitle}</p>
          </header>

          <div className="space-y-6">
            {sections.map((sec) => (
              <section key={sec.heading} className="space-y-2">
                <h2 className="font-serif text-lg sm:text-xl font-semibold text-[#02598B] dark:text-sky-400">
                  {sec.heading}
                </h2>
                <p className="text-sm leading-7 text-[#444444] dark:text-slate-300">{sec.body}</p>
              </section>
            ))}
          </div>

          <footer className="pt-5 border-t border-[#E5E0CE] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <Link to="/contact" className="text-[#0376B8] dark:text-sky-400 font-medium hover:underline">
              {t('navContact')}
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Link to="/privacy" className="text-[#666155] dark:text-slate-400 hover:underline">
                {t('navPrivacy')}
              </Link>
              <Link to="/terms" className="text-[#666155] dark:text-slate-400 hover:underline">
                {t('navTerms')}
              </Link>
              <Link to="/refund-policy" className="text-[#666155] dark:text-slate-400 hover:underline">
                {t('navRefund')}
              </Link>
            </div>
          </footer>
        </article>
      </div>
    </>
  );
}

const PRIVACY_CONTENT: Record<LanguageCode, { subtitle: string; sections: PolicySection[] }> = {
  en: {
    subtitle: 'How Khalid Sharif Digital Library collects, protects, and uses reader account and order information.',
    sections: [
      {
        heading: '1. Account & Reader Information',
        body: 'When you register for Khalid Sharif Digital Library, we store your name, email address, language preference, reading progress, and bookmarks solely to deliver your personal bookshelf and restore your place across devices.',
      },
      {
        heading: '2. Payment & Card Security',
        body: 'Card payments (Mastercard and Visa) are processed securely through Premier Bank. Khalid Sharif Digital Library never stores your card number or security code (CVV).',
      },
      {
        heading: '3. Data Protection & Contact',
        body: 'We do not sell or rent reader data to third parties. To request an update or removal of your account details, please reach our support team via the Contact Us page.',
      },
    ],
  },
  so: {
    subtitle: 'Sida Maktabadda Dijitaalka ee Khalid Sharif u ilaaliso xogta akoonka akhristaha iyo dalabaadka.',
    sections: [
      {
        heading: '1. Xogta Akoonka & Akhriska',
        body: 'Markaad iska diiwaangeliso Maktabadda Khalid Sharif, waxaan kaydinnaa magacaaga, iimaylkaaga, doorashada luqadda, horumarka akhriska, iyo calaamadaha boggaga si aad buugaagtaada uga hesho qalab kasta.',
      },
      {
        heading: '2. Amniga Lacag-bixinta Kaadhka',
        body: 'Lacag-bixinta kaadhadhka (Mastercard iyo Visa) waxaa si ammaan ah u maamula Premier Bank. Maktabaddu marnaba ma kaydiso lambarka buuxa ee kaadhkaaga ama koodhka sirta (CVV).',
      },
      {
        heading: '3. Ilaalinta Xogta & Xiriirka',
        body: 'Xogtaada lama iibiyo lamana wadaago cid saddexaad. Haddii aad rabto inaad wax ka beddesho ama tirtirto xogta akoonkaaga, fadlan nagala soo xiriir bogga Nala Soo Xiriir.',
      },
    ],
  },
  ar: {
    subtitle: 'كيف تجمع مكتبة خالد شريف الرقمية بيانات حساب القارئ والطلبات وتحميها.',
    sections: [
      {
        heading: '1. معلومات الحساب والقراءة',
        body: 'عند تسجيلك في مكتبة خالد شريف الرقمية، نحفظ اسمك وبريدك الإلكتروني وتفضيلات اللغة وتقدم القراءة والإشارات المرجعية لتوفير مكتبتك الشخصية ومزامنة القراءة.',
      },
      {
        heading: '2. أمان المدفوعات والبطاقات',
        body: 'تتم معالجة مدفوعات البطاقات (ماستركارد وفيزا) عبر نظام الدفع الآمن لبنك بريميير. لا تقوم المكتبة أبداً بتخزين أرقام البطاقات الكاملة أو رمز الأمان (CVV).',
      },
      {
        heading: '3. حماية البيانات والتواصل',
        body: 'نحن لا نبيع أو نؤجر بيانات القراء لأي طرف ثالث. لطلب تحديث أو حذف بيانات حسابك، يرجى التواصل معنا عبر صفحة اتصل بنا.',
      },
    ],
  },
};

const TERMS_CONTENT: Record<LanguageCode, { subtitle: string; sections: PolicySection[] }> = {
  en: {
    subtitle: 'Terms governing digital book access, licensing, and purchases at Khalid Sharif Digital Library.',
    sections: [
      {
        heading: '1. Personal Digital License',
        body: 'Free and purchased digital editions are licensed for your personal, non-commercial reading inside the Khalid Sharif Digital Library platform. Redistribution, scraping, or unauthorized resale of editions is prohibited.',
      },
      {
        heading: '2. Orders & Digital Fulfillment',
        body: 'Paid editions unlock immediately in My Library upon payment confirmation from Premier Bank or verification of bank transfers.',
      },
      {
        heading: '3. Account Responsibilities',
        body: 'You are responsible for keeping your sign-in credentials confidential and providing accurate receipt contact information during checkout.',
      },
    ],
  },
  so: {
    subtitle: 'Shuruudaha hagaya isticmaalka buugaagta dijitaalka ah iyo iibsashada Maktabadda Khalid Sharif.',
    sections: [
      {
        heading: '1. Shatiga Akhriska Shakhsiga ah',
        body: 'Buugaagta bilaashka ah iyo kuwa la iibsado waxaa loogu talagalay akhriskaaga shakhsiga ah ee gudaha Maktabadda Khalid Sharif. Lama oggola in dib loo daabaco ama si sharci-darro ah loo faafiyo.',
      },
      {
        heading: '2. Dalabaadka & Furitaanka Degdegga ah',
        body: 'Buugaagta la iibsado waxay si toos ah ugu furmaan qaybta Maktabaddayda isla marka lacag-bixinta la xaqiijiyo.',
      },
      {
        heading: '3. Mas’uuliyadda Akoonka',
        body: 'Macmiilku wuxuu mas’uul ka yahay ilaalinta furaha sirta ah ee akoonkiisa iyo gelinta xog sax ah marka uu wax iibsanayo.',
      },
    ],
  },
  ar: {
    subtitle: 'الشروط المنظمة للوصول إلى الكتب الرقمية والمشتريات في مكتبة خالد شريف الرقمية.',
    sections: [
      {
        heading: '1. ترخيص القراءة الشخصي',
        body: 'تُمنح الإصدارات المجانية والمشتراة لغرض القراءة الشخصية غير التجارية داخل منصة مكتبة خالد شريف الرقمية، ويُحظر إعادة توزيعها أو نسخها دون إذن.',
      },
      {
        heading: '2. الطلبات والتسليم الرقمي',
        body: 'تُفتح الإصدارات المدفوعة في قسم مكتبتي فور تأكيد الدفع عبر بنك بريميير أو التحقق من التحويل.',
      },
      {
        heading: '3. مسؤولية الحساب',
        body: 'يتحمل المستخدم مسؤولية الحفاظ على سرية بيانات دخوله وتزويدنا ببيانات تواصل صحيحة لإيصال الدفع.',
      },
    ],
  },
};

const REFUND_CONTENT: Record<LanguageCode, { subtitle: string; sections: PolicySection[] }> = {
  en: {
    subtitle: 'Digital delivery and refund guidelines for book purchases.',
    sections: [
      {
        heading: '1. Instant Digital Access',
        body: 'All works sold on Khalid Sharif Digital Library are digital editions delivered directly to your account Library upon payment verification, with no physical shipping fees.',
      },
      {
        heading: '2. Duplicate Charges & Access Issues',
        body: 'If you were charged twice for the same order, or if a verified order fails to unlock your book, contact support within 7 days with your order reference for immediate resolution or a full refund.',
      },
      {
        heading: '3. Completed Digital Purchases',
        body: 'Once a digital edition has been unlocked and accessed in the reader, purchases are generally non-refundable except where required for billing errors or unreadable files.',
      },
    ],
  },
  so: {
    subtitle: 'Habraaca helitaanka buugaagta dijitaalka ah iyo celinta lacagta.',
    sections: [
      {
        heading: '1. Helitaan Dijitaal ah oo Toos ah',
        body: 'Dhammaan buugaagta lagu iibiyo Maktabadda Khalid Sharif waa nuqullo dijitaal ah oo si toos ah ugu furma akoonkaaga isla marka lacagta la xaqiijiyo, mana jiraan kharashyo dhoofin.',
      },
      {
        heading: '2. Lacag Laba-jeer Go’day ama Cilad Akhris',
        body: 'Haddii lacagta laba jeer kaa go’do ama buugga la iibsaday uu furmi waayo, nagala soo xiriir bogga Nala Soo Xiriir muddo 7 maalmood gudahood adigoo wata tixraaca dalabka si degdeg ah loogu xalliyo ama lacagta laguugu celiyo.',
      },
      {
        heading: '3. Iibsashada La Dhammaystiray',
        body: 'Marka buugga dijitaalka ah la furo oo lagu akhriyo maktabadda, celinta lacagtu waxay khusaysaa oo keliya khaladaadka lacag-bixinta ama cilad faylka ah.',
      },
    ],
  },
  ar: {
    subtitle: 'سياسة التسليم الرقمي والاسترجاع للمشتريات في المكتبة.',
    sections: [
      {
        heading: '1. التسليم الرقمي الفوري',
        body: 'جميع الإصدارات المباعة هي كتب رقمية تُفتح مباشرة في حسابك بعد تأكيد الدفع دون أي رسوم شحن.',
      },
      {
        heading: '2. الخصم المكرر أو تعذر الوصول',
        body: 'في حال حدوث خصم مكرر أو تعذر فتح الكتاب بعد الدفع، يرجى التواصل مع الدعم خلال 7 أيام مع رقم الطلب لحل المشكلة أو رد المبلغ فوراً.',
      },
      {
        heading: '3. المشتريات الرقمية المكتملة',
        body: 'بمجرد فتح الكتاب الرقمي والوصول إليه في القارئ، تقتصر حالات الاسترجاع على أخطاء الفوترة أو تعذر عرض الملف.',
      },
    ],
  },
};

const ABOUT_CONTENT: Record<LanguageCode, { subtitle: string; sections: PolicySection[] }> = {
  en: {
    subtitle: 'Independent digital library, archival press, and multilingual reading platform.',
    sections: [
      {
        heading: '1. Our Mission',
        body: 'Khalid Sharif Digital Library preserves historical, literary, and scholarly works in Somali, English, and Arabic, making curated editions accessible worldwide through our digital reader.',
      },
      {
        heading: '2. Digital Editions & Open Access',
        body: 'We publish both open-access titles and curated paid editions. Every book includes full edition details and automatically saves your reading progress and bookmarks across devices.',
      },
      {
        heading: '3. Reader Support & Publishing',
        body: 'Digital editions unlock directly inside your personal library upon checkout confirmation. For publishing inquiries or reader assistance, please visit our Contact Us page.',
      },
    ],
  },
  so: {
    subtitle: 'Maktabad dijitaal ah oo madaxbannaan iyo madbacad lagu kaydiyo cilmiga iyo suugaanta.',
    sections: [
      {
        heading: '1. Ujeeddada Maktabadda',
        body: 'Maktabadda Dijitaalka ee Khalid Sharif waxay kaydisaa oo baahisaa buugaagta taariikhda, suugaanta, iyo cilmi-baarista ee ku qoran Af-Soomaali, Ingiriisi, iyo Carabi, iyadoo laga akhrisan karo meel kasta.',
      },
      {
        heading: '2. Buugaagta Furan iyo Kuwa La Iibsado',
        body: 'Waxaan bixinnaa daabacaadaha furan ee qof walba u furan iyo daabacaado gaar ah oo la iibsado. Buug kasta wuxuu ku furmaa akhriyaha dijitaalka ah ee ammaanka leh oo xafida bogga aad marayso.',
      },
      {
        heading: '3. Adeegga & Macluumaadka Ganacsiga',
        body: 'Buugaagta dijitaalka ahi isla markiiba waxay ku furmaan akoonkaaga marka lacag-bixinta la xaqiijiyo. Wixii wada-shaqayn ah ama caawimaad ah fadlan booqo bogga Nala Soo Xiriir.',
      },
    ],
  },
  ar: {
    subtitle: 'مكتبة رقمية مستقلة ودار نشر تُعنى بحفظ المعرفة والكتب المحققة.',
    sections: [
      {
        heading: '1. رسالتنا',
        body: 'تعمل مكتبة خالد شريف الرقمية على حفظ ونشر الأعمال التاريخية والأدبية والعلمية باللغات الصومالية والإنجليزية والعربية عبر قارئ رقمي آمن وسهل الاستخدام.',
      },
      {
        heading: '2. الإصدارات المفتوحة والمدفوعة',
        body: 'توفر المنصة إصدارات مفتوحة وإصدارات مدفوعة مختارة مع تفاصيل كاملة لكل إصدار وحفظ تلقائي لتقدم القراءة والإشارات المرجعية.',
      },
      {
        heading: '3. معلومات المتجر والدعم',
        body: 'تُتاح الكتب الرقمية مباشرة في مكتبتك الشخصية فور تأكيد الدفع. لأي استفسارات حول النشر أو الطلبات يرجى زيارة صفحة اتصل بنا.',
      },
    ],
  },
};

export const AboutPage: React.FC = () => {
  const { language, t } = useApp();
  const content = ABOUT_CONTENT[language] || ABOUT_CONTENT.en;
  return <LegalDocumentPage title={t('aboutTitle')} subtitle={content.subtitle} sections={content.sections} />;
};

export const PrivacyPage: React.FC = () => {
  const { language, t } = useApp();
  const content = PRIVACY_CONTENT[language] || PRIVACY_CONTENT.en;
  return <LegalDocumentPage title={t('navPrivacy')} subtitle={content.subtitle} sections={content.sections} />;
};

export const TermsPage: React.FC = () => {
  const { language, t } = useApp();
  const content = TERMS_CONTENT[language] || TERMS_CONTENT.en;
  return <LegalDocumentPage title={t('navTerms')} subtitle={content.subtitle} sections={content.sections} />;
};

export const RefundPolicyPage: React.FC = () => {
  const { language, t } = useApp();
  const content = REFUND_CONTENT[language] || REFUND_CONTENT.en;
  return <LegalDocumentPage title={t('navRefund')} subtitle={content.subtitle} sections={content.sections} />;
};
