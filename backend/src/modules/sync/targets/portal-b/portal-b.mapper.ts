/**
 * Portal B – Listing Integration API field mapper
 *
 * Converts our internal listing + property data into the shape expected by
 * POST /v1/listing/upload/body/json?client_key=KEY.
 *
 * Supported property types: House, ApartmentUnit, Land, Shop, Office, Warehouse.
 * NOT supported: Hotel, Business (no matching Portal B property type).
 * NOT supported: NewProjectUnit (no confirmed mapping — exclude before calling).
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface SyncListing {
  id: bigint | number;
  listingableType: string;
  listingableId: bigint | number;
  propertyId: string | null;
  category: string | null;
  status: string;
  type: string | null;
  isFeatured: boolean | null;
  address: string | null;
  addressGmaps: string | null;
  addressNotes: string | null;
  longitude: string | null;
  latitude: string | null;
  price: string | null; // BigInt serialised as string
  pricePerSqm: string | null;
  youtubeEmbed: string | null;
  publishedAt: Date | string | null;
}

export interface SyncTranslation {
  id: bigint | number;
  lang: string | null;
  title: string | null;
  slug: string | null;
  shortDescription: string | null;
  content: string | null;
}

export interface SyncMedia {
  id: bigint | number;
  url: string;
  ordinal: number | null;
  mediableGroup: string | null;
}

export type SyncListingable = Record<string, unknown>;

/** Agent / user profile fields required for the Portal B `agent` block. */
export interface SyncAgent {
  name: string;
  email: string;
  mobilePhone: string;
  officePhone?: string | null;
}

/**
 * Location with up to three levels of hierarchy (deepest -> shallowest).
 *   Level 1 (this node): district / kelurahan / kecamatan
 *   Level 2 (parent):    city / kota / kabupaten
 *   Level 3 (grandparent): province / provinsi
 *
 * Gracefully handled when fewer levels are available.
 */
export interface SyncLocation {
  id: bigint | number;
  name: string;
  slug: string;
  parent?: {
    name: string;
    slug: string;
    parent?: { name: string; slug: string } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Output types  (Portal B REST API body)
// ---------------------------------------------------------------------------

export type PortalBPropertyType = 'ho' | 'ap' | 'la' | 'sh' | 'of' | 'wa' | 'fa' | 'cs';
export type PortalBListingType = 'Sale' | 'Rent';

export interface PortalBAgentPayload {
  name: string;
  email: string;
  mobile_phone: string;
  office_phone?: string;
}

export interface PortalBListingPayload {
  /** Our internal property ID used as the Portal B upsert key. */
  listing_id: string;
  listing_type: PortalBListingType;
  property_type: PortalBPropertyType;
  title: string;
  /** Full HTML/plain-text body of the listing. */
  description: string;
  short_description: string;
  /** Asking price in IDR (integer). */
  price: number;
  price_per_sqm?: number;
  /** Land area in m2. */
  land_area?: number;
  /** Building / unit area in m2. */
  building_area?: number;
  bedrooms?: number;
  bathrooms?: number;
  /** Number of garage / carport spaces. */
  carport?: number;
  /** Floor number (or total floors for landed property). */
  floor?: number;
  /** Canonical certificate label. */
  certificate?: string;
  year_built?: string;
  /** Electrical power in Watts. */
  electricity?: number;
  /** Condition: typically 'Baru' or 'Bekas'. */
  condition?: string;
  address: string;
  province: string;
  city: string;
  district: string;
  latitude?: number;
  longitude?: number;
  /** Ordered array of image URLs (first = primary / hero). */
  images: string[];
  youtube?: string;
}

export interface PortalBPayload {
  agent: PortalBAgentPayload;
  listing: PortalBListingPayload;
}

/** Minimal shape of a Portal B upload API response. */
export interface PortalBUploadResponse {
  status: string;
  listing_id?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const PROPERTY_TYPE_MAP: Record<string, PortalBPropertyType> = {
  'App\\Models\\House': 'ho',
  'App\\Models\\ApartmentUnit': 'ap',
  'App\\Models\\Land': 'la',
  'App\\Models\\Shop': 'sh',
  'App\\Models\\Office': 'of',
  'App\\Models\\Warehouse': 'wa',
  'App\\Models\\Factory': 'fa',
  'App\\Models\\Mall': 'cs',
};

/**
 * listingable types with NO Portal B equivalent.
 * Check this set before enqueueing a listing for Portal B sync.
 */
export const PORTAL_B_UNSUPPORTED_TYPES = new Set<string>([
  'App\\Models\\Hotel',
  'App\\Models\\Business',
  'App\\Models\\NewProjectUnit',
]);

/** Maps our internal transaction category to Portal B listing_type. */
const LISTING_TYPE_MAP: Record<string, PortalBListingType> = {
  SELL: 'Sale',
  RENT: 'Rent',
};

/**
 * Maps common Indonesian certificate type strings to canonical labels.
 */
const CERTIFICATE_MAP: Record<string, string> = {
  SHM: 'SHM - Sertifikat Hak Milik',
  SHMSRS: 'Strata Title',
  HGB: 'HGB - Hak Guna Bangunan',
  SHGB: 'HGB - Hak Guna Bangunan',
  'Strata Title': 'Strata Title',
  Girik: 'Girik',
  PPJB: 'PPJB',
  Lainnya: 'Lainnya (Proses)',
  Other: 'Lainnya (Proses)',
};

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

export function mapListingToPortalB(
  listing: SyncListing,
  listingable: SyncListingable | null,
  translations: SyncTranslation[],
  media: SyncMedia[],
  agent: SyncAgent,
  location: SyncLocation | null,
): PortalBPayload {
  if (PORTAL_B_UNSUPPORTED_TYPES.has(listing.listingableType)) {
    throw new Error(
      `listingable type "${listing.listingableType}" is not supported by Portal B`,
    );
  }

  const propertyType = PROPERTY_TYPE_MAP[listing.listingableType];
  if (!propertyType) {
    throw new Error(
      `Unknown listingable type "${listing.listingableType}" — cannot map to Portal B`,
    );
  }

  const listingType = (listing.category ? LISTING_TYPE_MAP[listing.category] : undefined) ?? 'Sale';

  const primaryTrans =
    translations.find((t) => t.lang === 'id') ??
    translations.find((t) => t.lang === 'en') ??
    translations[0] ??
    null;

  const title =
    primaryTrans?.title?.trim() ||
    listing.address ||
    `Property #${listing.propertyId ?? listing.id}`;
  const description = primaryTrans?.content ?? '';
  const shortDescription = primaryTrans?.shortDescription ?? '';

  const price = listing.price ? Number(listing.price) : 0;
  const pricePerSqm = listing.pricePerSqm
    ? Number(listing.pricePerSqm)
    : undefined;

  const images = media
    .filter((m) => !m.mediableGroup || m.mediableGroup === 'gallery')
    .sort((a, b) => (a.ordinal ?? 999) - (b.ordinal ?? 999))
    .map((m) => m.url);

  const { province, city, district } = resolveLocation(location);

  const latitude = listing.latitude ? parseFloat(listing.latitude) : undefined;
  const longitude = listing.longitude
    ? parseFloat(listing.longitude)
    : undefined;

  const propFields = listingable
    ? buildPropertyFields(listing.listingableType, listingable)
    : {};

  const agentPayload: PortalBAgentPayload = {
    name: agent.name,
    email: agent.email,
    mobile_phone: agent.mobilePhone,
    ...(agent.officePhone ? { office_phone: agent.officePhone } : {}),
  };

  const listingPayload: PortalBListingPayload = {
    listing_id: String(listing.propertyId ?? listing.id),
    listing_type: listingType,
    property_type: propertyType,
    title,
    description: typeof description === 'string' ? description : '',
    short_description:
      typeof shortDescription === 'string' ? shortDescription : '',
    price,
    ...(pricePerSqm !== undefined ? { price_per_sqm: pricePerSqm } : {}),
    address: listing.address ?? '',
    province,
    city,
    district,
    images,
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(listing.youtubeEmbed ? { youtube: listing.youtubeEmbed } : {}),
    ...propFields,
  };

  return { agent: agentPayload, listing: listingPayload };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveLocation(loc: SyncLocation | null): {
  province: string;
  city: string;
  district: string;
} {
  if (!loc) return { province: '', city: '', district: '' };

  const grandparent = loc.parent?.parent;
  const parent = loc.parent;

  if (grandparent) {
    return {
      province: grandparent.name,
      city: parent!.name,
      district: loc.name,
    };
  }

  if (parent) {
    return { province: parent.name, city: loc.name, district: '' };
  }

  return { province: loc.name, city: '', district: '' };
}

function toNum(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return isNaN(n) ? undefined : n;
}

function toStr(value: unknown): string | undefined {
  if (value == null) return undefined;
  return String(value as string | number);
}

function toCert(value: unknown): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  return CERTIFICATE_MAP[value] ?? value;
}

// ---------------------------------------------------------------------------
// Property-type-specific field extraction
// ---------------------------------------------------------------------------

type PropertyFields = Partial<
  Pick<
    PortalBListingPayload,
    | 'land_area'
    | 'building_area'
    | 'bedrooms'
    | 'bathrooms'
    | 'carport'
    | 'floor'
    | 'certificate'
    | 'year_built'
    | 'electricity'
    | 'condition'
  >
>;

function buildPropertyFields(
  listingableType: string,
  lb: SyncListingable,
): PropertyFields {
  const f: PropertyFields = {};

  switch (listingableType) {
    case 'App\\Models\\House':
      f.bedrooms = toNum(lb['bedrooms']);
      f.bathrooms = toNum(lb['bathrooms']);
      f.carport = toNum(lb['carports']);
      f.floor = toNum(lb['floor']);
      f.land_area = toNum(lb['landArea']);
      f.building_area = toNum(lb['buildingArea']);
      f.certificate = toCert(lb['certificateType']);
      f.year_built = toStr(lb['yearBuilt']);
      f.electricity = toNum(lb['electricity']);
      f.condition = toStr(lb['condition']);
      break;

    case 'App\\Models\\ApartmentUnit':
      f.bedrooms = toNum(lb['bedrooms']);
      f.bathrooms = toNum(lb['bathrooms']);
      f.floor = toNum(lb['floor']);
      f.building_area = toNum(lb['buildingArea']);
      f.year_built = toStr(lb['yearBuilt']);
      f.electricity = toNum(lb['electricity']);
      f.condition = toStr(lb['condition']);
      break;

    case 'App\\Models\\Land':
      f.land_area = toNum(lb['landArea']);
      f.certificate = toCert(lb['certificateType']);
      break;

    case 'App\\Models\\Shop':
      f.land_area = toNum(lb['landArea']);
      f.building_area = toNum(lb['buildingArea']);
      f.floor = toNum(lb['floor']);
      f.certificate = toCert(lb['certificateType']);
      f.year_built = toStr(lb['yearBuilt']);
      f.electricity = toNum(lb['electricity']);
      f.condition = toStr(lb['condition']);
      break;

    case 'App\\Models\\Warehouse':
      f.land_area = toNum(lb['landArea']);
      f.building_area = toNum(lb['buildingArea']);
      f.certificate = toCert(lb['certificateType']);
      f.year_built = toStr(lb['yearBuilt']);
      f.electricity = toNum(lb['electricity']);
      break;

    case 'App\\Models\\Office':
      f.floor = toNum(lb['floor']);
      f.building_area = toNum(lb['buildingArea']);
      f.condition = toStr(lb['condition']);
      break;
  }

  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined),
  ) as PropertyFields;
}
