/**
 * Portal A – Houzez theme field mapper
 *
 * Converts our internal listing + property data into the shape expected by
 * the Houzez WordPress theme REST API (/wp-json/wp/v2/properties).
 *
 * Houzez uses:
 *   - Custom post type: `property` (REST endpoint: /properties)
 *   - Meta keys prefixed with `fave_*`
 *   - Taxonomies: property_type, property_status, property_label, property_city, property_area
 *   - Image gallery via WP media attachment IDs (not URLs)
 */

// ---------------------------------------------------------------------------
// Input types  (mirror the shape that ListingService.getFullListing returns)
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
  soldAt?: Date | string | null;
  location?: {
    id: bigint | number;
    name: string;
    slug: string;
    parent?: {
      name: string;
      slug: string;
      parent?: { name: string; slug: string } | null;
    } | null;
  } | null;
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

// ---------------------------------------------------------------------------
// Output types  (Houzez property REST API body)
// ---------------------------------------------------------------------------

export interface HouzezProperty {
  /** Post title (plain text). */
  title: string;
  /** Post body (HTML or plain text). */
  content: string;
  /** Post excerpt / short description. */
  excerpt?: string;
  /** Publication status. */
  status: 'publish' | 'draft' | 'pending';
  /** Houzez taxonomy: property_type (array of term IDs). */
  property_type?: number[];
  /** Houzez taxonomy: property_status (array of term IDs). */
  property_status?: number[];
  /** Houzez taxonomy: property_label (array of term IDs). */
  property_label?: number[];
  /** Houzez taxonomy: property_state (array of term IDs — province level). */
  property_state?: number[];
  /** Houzez taxonomy: property_city (array of term IDs). */
  property_city?: number[];
  /** Houzez taxonomy: property_area (array of term IDs). */
  property_area?: number[];
  /** WP featured image (media attachment ID). */
  featured_media?: number;
  /** Houzez meta fields. */
  meta: Record<string, string | number | string[]>;
}

/** Minimal shape of a successful WordPress post creation/update response. */
export interface WordPressCreatedPost {
  id: number;
  link: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Taxonomy maps
// ---------------------------------------------------------------------------

/**
 * Maps `{listingableType}_{category}` to Houzez property_type term IDs.
 * A value of 0 means the term does not exist yet and must be created on first sync.
 */
export const HOUZEZ_PROPERTY_TYPE: Record<string, number> = {
  'App\\Models\\ApartmentUnit_SELL': 71,
  'App\\Models\\ApartmentUnit_RENT': 1639,
  'App\\Models\\House_SELL': 59,
  'App\\Models\\House_RENT': 389,
  'App\\Models\\Land_SELL': 180,
  'App\\Models\\Land_RENT': 503,
  'App\\Models\\Shop_SELL': 58,
  'App\\Models\\Shop_RENT': 446,
  'App\\Models\\Warehouse_SELL': 301,
  'App\\Models\\Warehouse_RENT': 550,
  'App\\Models\\Office_SELL': 47,
  'App\\Models\\Office_RENT': 387,
  'App\\Models\\Hotel_SELL': 321,
  'App\\Models\\Business_SELL': 610,
  'App\\Models\\Business_RENT': 611,
};

/**
 * Maps for property_type terms that need to be auto-created.
 * Key matches entries in HOUZEZ_PROPERTY_TYPE with value 0.
 */
export const HOUZEZ_PROPERTY_TYPE_CREATE: Record<string, { name: string; slug: string }> = {
  'App\\Models\\ApartmentUnit_RENT': { name: 'Apartment For Rent', slug: 'apartment-for-rent' },
};

/** Maps our transaction category (SELL / RENT) to Houzez property_status term IDs. */
export const HOUZEZ_PROPERTY_STATUS: Record<string, number> = {
  SELL: 28,
  RENT: 29,
};

/** Houzez property_label term IDs. */
export const HOUZEZ_PROPERTY_LABEL = {
  available: 142,
  sold: 143,
  rented: 593,
  on_hold: 502,
  video: 219,
} as const;

/** Maps location slugs to Houzez property_state (province) term IDs. */
export const HOUZEZ_PROPERTY_STATE: Record<string, number> = {
  'dki-jakarta': 78,
  'banten': 100,
  'jawa-barat': 235,
  'bali': 379,
  'daerah-istimewa-yogyakarta': 309,
  'jawa-timur': 350,
};

/** Maps city slugs -> their parent state term ID. */
export const CITY_TO_STATE: Record<string, number> = {
  'jakarta': 78, 'jakarta-selatan': 78, 'jakarta-pusat': 78, 'jakarta-barat': 78,
  'jakarta-timur': 78, 'jakarta-utara': 78,
  'tangerang': 100, 'tangerang-selatan': 100, 'banten': 100,
  'bekasi': 235, 'bogor': 235, 'depok': 235, 'bandung': 235, 'karawang': 235,
  'badung': 379,
  'yogyakarta': 309,
  'surabaya': 350,
};

/** Maps location slugs to Houzez property_city term IDs. */
export const HOUZEZ_PROPERTY_CITY: Record<string, number> = {
  'jakarta': 1628,
  'jakarta-selatan': 79,
  'jakarta-pusat': 125,
  'jakarta-barat': 97,
  'jakarta-timur': 133,
  'jakarta-utara': 258,
  'tangerang': 101,
  'tangerang-selatan': 119,
  'bekasi': 244,
  'bogor': 236,
  'depok': 393,
  'bandung': 420,
  'surabaya': 351,
  'badung': 377,
  'yogyakarta': 310,
  'banten': 428,
  'karawang': 426,
};

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

export function mapListingToHouzez(
  listing: SyncListing,
  listingable: SyncListingable | null,
  translations: SyncTranslation[],
  _media: SyncMedia[],
): HouzezProperty {
  const primaryTrans =
    translations.find((t) => t.lang === 'id') ??
    translations.find((t) => t.lang === 'en') ??
    translations[0] ??
    null;

  const title =
    primaryTrans?.title?.trim() ||
    listing.address ||
    `Property #${listing.propertyId ?? listing.id}`;

  const content = primaryTrans?.content ?? '';
  const excerpt = primaryTrans?.shortDescription ?? '';

  const status: HouzezProperty['status'] =
    listing.status === 'PUBLISHED' ? 'publish' : 'draft';

  const meta = buildHouzezMeta(listing, listingable);

  const typeKey = `${listing.listingableType}_${listing.category}`;
  const propertyTypeId = HOUZEZ_PROPERTY_TYPE[typeKey];
  const property_type = propertyTypeId ? [propertyTypeId] : [];

  const statusId = HOUZEZ_PROPERTY_STATUS[listing.category || ''];
  const property_status = statusId ? [statusId] : [];

  const labelId = listing.soldAt
    ? (listing.category === 'RENT' ? HOUZEZ_PROPERTY_LABEL.rented : HOUZEZ_PROPERTY_LABEL.sold)
    : HOUZEZ_PROPERTY_LABEL.available;
  const property_label = [labelId];

  const property_state: number[] = [];
  const property_city: number[] = [];
  if (listing.location) {
    const slugsToCheck = [
      listing.location.slug,
      listing.location.parent?.slug,
      listing.location.parent?.parent?.slug,
    ];
    for (const slug of slugsToCheck) {
      if (slug && HOUZEZ_PROPERTY_STATE[slug]) {
        property_state.push(HOUZEZ_PROPERTY_STATE[slug]);
        break;
      }
    }
    for (const slug of slugsToCheck) {
      if (slug && HOUZEZ_PROPERTY_CITY[slug]) {
        property_city.push(HOUZEZ_PROPERTY_CITY[slug]);
        if (property_state.length === 0 && CITY_TO_STATE[slug]) {
          property_state.push(CITY_TO_STATE[slug]);
        }
        break;
      }
    }
  }

  return {
    title,
    content,
    excerpt,
    status,
    property_type,
    property_status,
    property_label,
    property_state,
    property_city,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const BEDROOM_TO_NUMBER: Record<string, string> = {
  'STUDIO': '0',
  'ONE_BEDROOM': '1',
  'TWO_BEDROOMS': '2',
  'THREE_BEDROOMS': '3',
  'FOUR_BEDROOMS': '4',
  'FIVE_BEDROOMS': '5',
  'SIX_BEDROOMS': '6',
  'SEVEN_BEDROOMS': '7',
  'EIGHT_BEDROOMS': '8',
};

function bedroomCount(value: unknown): string {
  if (value == null) return '0';
  const str = String(value);
  if (/^\d+$/.test(str)) return str;
  return BEDROOM_TO_NUMBER[str] ?? '0';
}

function buildHouzezMeta(
  listing: SyncListing,
  listingable: SyncListingable | null,
): Record<string, string | number | string[]> {
  const lb = listingable ?? {};

  const toStr = (val: unknown): string => {
    if (val == null) return '0';
    const n = Number(val);
    return Number.isNaN(n) ? '0' : String(Math.floor(n));
  };

  const meta: Record<string, string | number | string[]> = {
    fave_property_id: listing.propertyId || '',
    fave_property_price: listing.price || '0',
    fave_property_sec_price: listing.pricePerSqm || '',
    fave_property_price_postfix: 'sqm',
    fave_property_price_prefix: '',
    fave_property_size: String(lb['buildingArea'] ?? ''),
    fave_property_land: String(lb['landArea'] ?? ''),
    fave_property_bedrooms: bedroomCount(lb['bedrooms']),
    fave_property_bathrooms: toStr(lb['bathrooms']),
    fave_property_rooms: '0',
    fave_property_garage: toStr(lb['carports']),
    fave_property_garage_size: '',
    fave_property_year: String(lb['yearBuilt'] ?? ''),
    fave_property_address: listing.address || listing.addressGmaps || '',
    fave_property_map: '1',
    fave_property_map_address: listing.address || listing.addressGmaps || '',
    fave_property_map_street_view: 'hide',
    fave_property_location: listing.latitude && listing.longitude
      ? `${listing.latitude},${listing.longitude},15`
      : '',
    houzez_geolocation_lat: listing.latitude || '',
    houzez_geolocation_long: listing.longitude || '',
    fave_featured: listing.isFeatured ? '1' : '0',
    fave_video_url: listing.youtubeEmbed || '',
    fave_agent_display_option: 'agent_info',
    fave_agents: '',
    fave_property_agency: '-1',
    fave_single_top_area: 'global',
    fave_single_content_area: 'global',
    fave_prop_homeslider: 'no',
    _houzez_expiration_date_status: 'saved',
  };

  return meta;
}
