import crypto from 'node:crypto';

export interface SeedCategorySpec {
  id: string;
  slug: string;
  nameEn: string;
  nameSo: string;
  nameAr: string;
  descriptionEn: string;
  descriptionSo: string;
  descriptionAr: string;
  imageUrl: string;
  sortOrder: number;
}

export interface SeedBookSpec {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  description: string;
  categoryId: string;
  language: 'so' | 'en' | 'ar';
  publicationYear: number;
  publisher: string;
  isbn: string;
  pageCount: number;
  samplePageCount?: number;
  coverUrl: string;
  isFree: boolean;
  priceCents: number;
  isFeatured: boolean;
  isRecommended: boolean;
  popularityScore: number;
  chapters: Array<{ heading: string; paragraphs: string[] }>;
}

/**
 * Generates a deterministic RFC-4122-compliant v4-shaped UUID from a seed key
 * so Postgres UUID primary keys remain stable and idempotent across startups.
 */
export function deterministicSeedUuid(seedKey: string): string {
  const bytes = crypto.createHash('sha256').update(`ksdl:${seedKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const PREMIER_INST_EN = 'Pay securely using Mastercard or Visa via Premier Bank.';
export const PREMIER_INST_SO = 'Ku bixi si ammaan ah kaadhka Mastercard ama Visa adigoo maraya Premier Bank.';
export const PREMIER_INST_AR = 'ادفع بأمان باستخدام بطاقة ماستركارد أو فيزا عبر بنك بريميير.';

export const MANUAL_INST_EN =
  'Transfer the order total to the library bank account and submit your transfer reference for confirmation.';
export const MANUAL_INST_SO =
  'U soo dir wadarta koontada maktabadda kadibna geli tixraaca lacag-dirista si loo xaqiijiyo.';
export const MANUAL_INST_AR = 'حوّل المبلغ إلى حساب المكتبة وأدخل رقم المرجع ليتم تأكيد الطلب.';

export const DEFAULT_CONTACT_CHANNELS = [
  {
    id: 'contact-phone-primary',
    type: 'phone' as const,
    label: 'Phone Support',
    value: '+252611086006',
    url: 'tel:+252611086006',
    isPrimary: true,
    isEnabled: true,
    sortOrder: 1,
  },
  {
    id: 'contact-whatsapp-primary',
    type: 'whatsapp' as const,
    label: 'WhatsApp',
    value: '+252611086006',
    url: 'https://wa.me/252611086006',
    isPrimary: false,
    isEnabled: true,
    sortOrder: 2,
  },
];

export const DEFAULT_DISCOUNT_CODES: Record<string, number> = {
  SCHOLAR10: 10,
  LIBRARY15: 15,
};

export const SEED_CATEGORIES: SeedCategorySpec[] = [
  {
    id: 'cat-history',
    slug: 'history-heritage',
    nameEn: 'History & Heritage',
    nameSo: 'Taariikhda & Dhaxalka',
    nameAr: 'التاريخ والتراث',
    descriptionEn: 'Primary chronicles, maritime trade archives, and regional historiography of the Horn of Africa.',
    descriptionSo: 'Diiwaannada taariikhiga ah, ganacsiga badda, iyo dhaxalka ilbaxnimada Geeska Afrika.',
    descriptionAr: 'السجلات التاريخية وأرشيف التجارة البحرية وتاريخ القرن الأفريقي.',
    imageUrl: '/src/assets/images/cover_horn_history_1795163040974.jpg',
    sortOrder: 1,
  },
  {
    id: 'cat-literature',
    slug: 'literature-poetry',
    nameEn: 'Literature & Poetry',
    nameSo: 'Suugaanta & Maansada',
    nameAr: 'الأدب والشعر',
    descriptionEn: 'Annotated oral epics, classical Somali verse, and contemporary bilingual essays.',
    descriptionSo: 'Maansooyinka suugaanta, sheekooyinka dhaqanka, iyo qoraallada hal-abuurka casriga ah.',
    descriptionAr: 'الملاحم الشفوية المشروحة والشعر الصومالي الكلاسيكي والمقالات الأدبية المعاصرة.',
    imageUrl: '/src/assets/images/cover_somali_literature_1795163041667.jpg',
    sortOrder: 2,
  },
  {
    id: 'cat-philosophy',
    slug: 'philosophy-thought',
    nameEn: 'Philosophy & Classical Thought',
    nameSo: 'Falsafadda & Fikirka',
    nameAr: 'الفلسفة والفكر',
    descriptionEn: 'Treatises on ethics, jurisprudence, logic, and manuscript preservation.',
    descriptionSo: 'Qoraallo ku saabsan anshaxa, garsoorka, mantiqa, iyo ilaalinta qoraallada qadiimiga ah.',
    descriptionAr: 'رسائل في الأخلاق والفقه والمنطق وحفظ المخطوطات التراثية.',
    imageUrl: '/src/assets/images/cover_islamic_philosophy_1795163040465.jpg',
    sortOrder: 3,
  },
  {
    id: 'cat-economics',
    slug: 'economics-society',
    nameEn: 'Economics & Modern Society',
    nameSo: 'Dhaqaalaha & Bulshada',
    nameAr: 'الاقتصاد والمجتمع',
    descriptionEn: 'Research monographs on regional trade, urban institutions, and sustainable infrastructure.',
    descriptionSo: 'Cilmi-baaris ku saabsan ganacsiga gobolka, hayadaha magaalooyinka, iyo horumarka waara.',
    descriptionAr: 'دراسات بحثية حول التجارة الإقليمية والمؤسسات الحضرية والتنمية المستدامة.',
    imageUrl: '/src/assets/images/cover_modern_economics_1795163042264.jpg',
    sortOrder: 4,
  },
];

export const SEED_BOOKS: SeedBookSpec[] = [
  {
    id: 'book-monsoon-ports',
    slug: 'monsoon-ports-of-the-benadir-coast',
    title: 'Monsoon Ports of the Benadir Coast',
    subtitle: 'Maritime Networks, Guilds & Urban Architecture (1200–1750)',
    author: 'Khalid Sharif',
    description:
      'An archival study tracing the seasonal monsoon trade connecting Mogadishu, Merca, and Barawa with Indian Ocean ports, drawing on Arabic port ledgers, coral-stone inscriptions, and family waqf deeds.',
    categoryId: 'cat-history',
    language: 'en',
    publicationYear: 2025,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-01-4',
    pageCount: 6,
    coverUrl: '/src/assets/images/cover_horn_history_1795163040974.jpg',
    isFree: false,
    priceCents: 1850,
    isFeatured: true,
    isRecommended: true,
    popularityScore: 142,
    chapters: [
      {
        heading: 'Seasonal Winds and Harbor Charts',
        paragraphs: [
          'For centuries the rhythm of commerce along the Benadir littoral followed two predictable meteorological currents: the northeast kaskazi arriving in late November and the southwest kusi rising in April.',
          'Navigators compiled coastal pilot guides recording reef soundings, freshwater wells, and anchorage dues from Zeila to Ras Kamboni.',
        ],
      },
      {
        heading: 'Coral-Stone Guildhouses and Waqf Ledgers',
        paragraphs: [
          'Excavated ledger fragments reveal merchant councils regulating textile weights, ambergris grading, and maritime insurance agreements across seasonal voyages.',
          'Charitable endowments sustained mosques, cisterns, and guest quarters for visiting jurists and shipmasters.',
        ],
      },
      {
        heading: 'Archival Sources and Cartography',
        paragraphs: [
          'Comparative reading of coastal chronicles with port customs registers illuminates how local ateliers produced woven benadiri cloth prized from Aden to Calicut.',
        ],
      },
      {
        heading: 'Preserving Coastal Memory',
        paragraphs: [
          'Digital preservation of family manuscripts allows contemporary historians to cross-reference genealogies with maritime trade inventories across three continents.',
        ],
      },
    ],
  },
  {
    id: 'book-dhaxalka-maansada',
    slug: 'dhaxalka-maansada-iyo-miisaanka-gabayga',
    title: 'Dhaxalka Maansada iyo Miisaanka Gabayga',
    subtitle: 'Falanqaynta Qaafiyadda, Xigmadda iyo Suugaanta Soomaaliyeed',
    author: 'Khalid Sharif',
    description:
      'Buug cilmiyeed si qoto dheer u sharraxaya miisaanka maansada Soomaaliyeed, godadka gabayga, geeraarka, iyo kaalinta suugaantu ku leedahay keydinta taariikhda bulshada.',
    categoryId: 'cat-literature',
    language: 'so',
    publicationYear: 2024,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-02-1',
    pageCount: 6,
    coverUrl: '/src/assets/images/cover_somali_literature_1795163041667.jpg',
    isFree: true,
    priceCents: 0,
    isFeatured: true,
    isRecommended: true,
    popularityScore: 198,
    chapters: [
      {
        heading: 'Hordhac: Xigmadda Hadalka iyo Miisaanka',
        paragraphs: [
          'Maansada Soomaaliyeed waa kayd taariikheed iyo muraayad laga dheehdo garaadka, anshaxa, iyo waaya-aragnimada bulshada soo jireenka ah.',
          'Hab-dhiska xaraf-raaca iyo miisaanka shaqallada waxay u saamaxeen gabayaa badan in tuducyadu xafidmaan jiilba jiilka xiga.',
        ],
      },
      {
        heading: 'Godadka Waaweyn ee Maansada',
        paragraphs: [
          'Gabayga, jiiftada, geeraarka, iyo buraanburka mid kastaa wuxuu leeyahay cod, ujeeddo bulsho, iyo miisaan gooni ah oo lagu garto.',
          'Qormadani waxay soo bandhigaysaa tusaalooyin sugan oo muujinaya sida dhawaaqa erayadu ula jaanqaadaan macnaha guud.',
        ],
      },
      {
        heading: 'Diiwaangelinta iyo Qoraalka Casriga ah',
        paragraphs: [
          'U beddelidda suugaanta afka ah qoraal dijitaal ah waxay ilaalinaysaa erey-bixinta qadiimiga ah waxayna u sahlaysaa ardayda baaritaanka casriga ah.',
        ],
      },
      {
        heading: 'Gabagabo',
        paragraphs: [
          'Dhaxalka suugaaneed wuxuu sii noolaadaa marka la akhriyo, la daraaseeyo, laguna kaydiyo maktabado furan oo la isku halayn karo.',
        ],
      },
    ],
  },
  {
    id: 'book-manuscripts-ethic',
    slug: 'al-manhaj-fi-hifz-al-makhtutat',
    title: 'Al-Manhaj fi Hifz al-Makhtutat wa Ilm al-Kalam',
    subtitle: 'Foundations of Manuscript Scholarship & Classical Ethics',
    author: 'Dr. Amina Warsame',
    description:
      'A bilingual scholarly edition examining classical manuscript transmission, marginalia conventions, and ethical epistemology in East African and Red Sea academies.',
    categoryId: 'cat-philosophy',
    language: 'ar',
    publicationYear: 2025,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-03-8',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_islamic_philosophy_1795163040465.jpg',
    isFree: false,
    priceCents: 2400,
    isFeatured: true,
    isRecommended: false,
    popularityScore: 118,
    chapters: [
      {
        heading: 'Colophons and Chain of Transmission',
        paragraphs: [
          'Manuscript colophons preserve crucial historical metadata: the scribe name, place of copying, paper watermark, and teaching authorization.',
          'Careful collation of marginal notes distinguishes primary authorial revisions from later pedagogical commentaries.',
        ],
      },
      {
        heading: 'Logical Argumentation and Ethical Conduct',
        paragraphs: [
          'Classical treatises paired formal dialectical reasoning with strict standards of intellectual honesty and attribution.',
        ],
      },
      {
        heading: 'Archival Conservation in Digital Editions',
        paragraphs: [
          'High-resolution conservation imaging coupled with searchable scholarly apparatus extends manuscript longevity without physical wear.',
        ],
      },
    ],
  },
  {
    id: 'book-urban-commons',
    slug: 'civic-institutions-and-urban-commons',
    title: 'Civic Institutions and Urban Commons',
    subtitle: 'Trade Corridors, Water Trusts & Municipal Resilience',
    author: 'Hassan Mire Dualeh',
    description:
      'An empirical monograph analyzing informal credit unions, port logistics cooperatives, and municipal governance models across rapidly growing coastal cities.',
    categoryId: 'cat-economics',
    language: 'en',
    publicationYear: 2026,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-04-5',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_modern_economics_1795163042264.jpg',
    isFree: false,
    priceCents: 1490,
    isFeatured: false,
    isRecommended: true,
    popularityScore: 95,
    chapters: [
      {
        heading: 'Trust Networks in Cross-Border Trade',
        paragraphs: [
          'Merchant associations reduce settlement friction by pairing reputational accountability with transparent dispute arbitration.',
        ],
      },
      {
        heading: 'Municipal Infrastructure Financing',
        paragraphs: [
          'Public-community partnerships offer viable pathways for solar microgrids, cold-chain storage, and port hinterland connectivity.',
        ],
      },
      {
        heading: 'Policy Benchmarks and Recommendations',
        paragraphs: [
          'Open procurement registries and predictable customs rules significantly lower capital costs for small regional manufacturers.',
        ],
      },
    ],
  },
  {
    id: 'book-open-grammar',
    slug: 'naxwaha-asaasiga-ee-af-soomaaliga',
    title: 'Naxwaha Aasaasiga ah ee Af-Soomaaliga',
    subtitle: 'Hagaha Qoraalka Saxda ah iyo Erey-bixinta Cilmiyeed',
    author: 'Prof. Cabdullaahi Xasan',
    description:
      'Buug furan oo loogu talagalay ardayda, macallimiinta, iyo qorayaasha si loo xoojiyo higgaadda saxda ah, qaab-dhismeedka weedha, iyo qoraalka rasmiga ah.',
    categoryId: 'cat-literature',
    language: 'so',
    publicationYear: 2024,
    publisher: 'Khalid Sharif Open Press',
    isbn: '978-1-958201-05-2',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_somali_literature_1795163041667.jpg',
    isFree: true,
    priceCents: 0,
    isFeatured: false,
    isRecommended: true,
    popularityScore: 164,
    chapters: [
      {
        heading: 'Xarfaha Shaqalka iyo Shibbanaha',
        paragraphs: [
          'Af-Soomaaligu wuxuu leeyahay shan shaqal oo gaagaaban iyo shan dhaadheer kuwaas oo beddela macnaha erayga marka la dheereeyo ama la gaabiyo.',
        ],
      },
      {
        heading: 'Dhismaha Weedha iyo Falalka',
        paragraphs: [
          'Fahamka diirad-saarka (focus particles: baa, ayaa, waxaa) waa furaha qoraalka fasiixa ah ee Af-Soomaaliga.',
        ],
      },
      {
        heading: 'Laylisyo iyo Tusaalooyin',
        paragraphs: [
          'Qaybtan waxay bixisaa laylisyo wax-ku-ool ah oo lagu hubiyo higgaadda iyo kala-soocidda erayada isku dhaw.',
        ],
      },
    ],
  },
  {
    id: 'book-digital-archives',
    slug: 'principles-of-open-digital-archives',
    title: 'Principles of Open Digital Archives',
    subtitle: 'Metadata Standards, Preservation & Public Access',
    author: 'Khalid Sharif',
    description:
      'A practical manual for librarians, scholars, and cultural foundations designing resilient digital reading rooms and multilingual catalog metadata.',
    categoryId: 'cat-philosophy',
    language: 'en',
    publicationYear: 2025,
    publisher: 'Khalid Sharif Open Press',
    isbn: '978-1-958201-06-9',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_islamic_philosophy_1795163040465.jpg',
    isFree: true,
    priceCents: 0,
    isFeatured: false,
    isRecommended: false,
    popularityScore: 132,
    chapters: [
      {
        heading: 'Designing Durable Catalog Schemas',
        paragraphs: [
          'Multilingual libraries require explicit language tagging, canonical author identifiers, and non-destructive schema evolution.',
        ],
      },
      {
        heading: 'Balancing Open Scholarship and Author Sustainability',
        paragraphs: [
          'Separating open-access cultural editions from licensed contemporary monographs sustains independent publishing.',
        ],
      },
      {
        heading: 'Checksum Integrity and Long-Term Storage',
        paragraphs: [
          'Every archived PDF should carry a cryptographic SHA-256 digest and immutable storage key to prevent silent corruption.',
        ],
      },
    ],
  },
  {
    id: 'book-caravan-routes',
    slug: 'caravan-routes-and-inland-markets',
    title: 'Caravan Routes and Inland Markets',
    subtitle: 'Trade Chronicles of Harar, Luuq, and Bardera',
    author: 'Fadumo Abdi Noor',
    description:
      'Detailed economic history tracing overland trade networks linking riverine agricultural towns with Red Sea and Indian Ocean anchorages.',
    categoryId: 'cat-history',
    language: 'en',
    publicationYear: 2025,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-07-6',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_horn_history_1795163040974.jpg',
    isFree: false,
    priceCents: 1600,
    isFeatured: false,
    isRecommended: true,
    popularityScore: 87,
    chapters: [
      {
        heading: 'Riverine Crossroads and Seasonal Fairs',
        paragraphs: [
          'Luuq and Bardera served as vital exchange hubs where pastoral livestock and gums met imported spices and ironware.',
        ],
      },
      {
        heading: 'Weights, Measures, and Customary Law',
        paragraphs: [
          'Caravan elders enforced safe-passage covenants across clan territories to keep seasonal trade uninterrupted.',
        ],
      },
      {
        heading: 'Archival Maps and Route Tables',
        paragraphs: [
          'Annotated stage-by-stage itineraries reconstruct travel times between inland wells and coastal customs houses.',
        ],
      },
    ],
  },
  {
    id: 'book-dhaqaalaha-dijitaalka',
    slug: 'dhaqaalaha-dijitaalka-iyo-ganacsiga-cusub',
    title: 'Dhaqaalaha Dijitaalka iyo Ganacsiga Cusub',
    subtitle: 'Fursadaha Teknolojiyadda, Lacag-bixinta & Hal-abuurka',
    author: 'Eng. Mahad Cabdiraxmaan',
    description:
      'Buug lagu falanqeeyay sida nidaamyada lacag-bixinta elektaroonigga ah, ganacsiga internet-ka, iyo xirfadaha dijitaalka ahi u beddelayaan suuqa shaqada.',
    categoryId: 'cat-economics',
    language: 'so',
    publicationYear: 2026,
    publisher: 'Khalid Sharif Press',
    isbn: '978-1-958201-08-3',
    pageCount: 5,
    coverUrl: '/src/assets/images/cover_modern_economics_1795163042264.jpg',
    isFree: false,
    priceCents: 1200,
    isFeatured: false,
    isRecommended: false,
    popularityScore: 109,
    chapters: [
      {
        heading: 'Ka Gudubka Lacagta Caddaan ah',
        paragraphs: [
          'Koboca taleefannada gacanta wuxuu abuuray dhaqaale degdeg ah oo u baahan nidaamyo ammaan ah oo la hubiyay.',
        ],
      },
      {
        heading: 'Kalsoonida Macmiilka iyo Amniga Xogta',
        paragraphs: [
          'Shirkadaha dijitaalka ahi waxay ku guulaystaan marka ay ilaaliyaan sirta macaamiisha iyo hufnaanta lacag-bixinta.',
        ],
      },
      {
        heading: 'Istiraatiijiyadda Mustaqbalka',
        paragraphs: [
          'Maalgashiga waxbarashada software-ka iyo hal-abuurka maxalliga ah ayaa fure u ah madax-bannaanida dhaqaale.',
        ],
      },
    ],
  },
];
