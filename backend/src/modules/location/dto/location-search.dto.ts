import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Query params for GET /locations/:slug/search.
 * The `type` field selects which property collection to query.
 */
export class LocationSearchDto {
  /**
   * Property type to search.
   * Accepted: apartment (default) | house | land | shop | warehouse |
   *   office | hotel | business | other_hotel | other_business |
   *   new_apartment | new_house | new_office | new_shop | new_warehouse
   */
  @IsOptional()
  @IsString()
  type?: string;

  /** SELL | RENT */
  @IsOptional()
  @IsString()
  category?: string;

  /** Free-text search (title for apartment/office/new_*). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  load?: number;

  /** Sort field: title | created_at | price */
  @IsOptional()
  @IsString()
  field?: string;

  /** asc | desc */
  @IsOptional()
  @IsString()
  direction?: string;

  /** Min price (string to preserve BigInt precision). */
  @IsOptional()
  @IsString()
  min_price?: string;

  @IsOptional()
  @IsString()
  max_price?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_land_area?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_land_area?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_building_area?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_building_area?: number;

  /**
   * Bedrooms count.
   * House: Int comparison. Apartment/NewProject: converted to String.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsString()
  condition?: string;

  /** Floor zone — ApartmentUnit.floorZone */
  @IsOptional()
  @IsString()
  floor_zone?: string;

  @IsOptional()
  @IsString()
  certificate_type?: string;

  /** ApartmentUnit.isRented */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_rented?: boolean;

  /** House.hasMaidRoom / ApartmentUnit.hasMaidRoom */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  has_maid_room?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  has_study_room?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  has_pool?: boolean;

  /** Accepted for API compatibility — no schema field; silently ignored. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_mortgage?: boolean;

  /**
   * ID to exclude from results.
   * For model-based types (apartment/office/new_*) this is a model ID.
   * For listing-based types (hotel/business/cluster) this is a listing ID.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exclude?: number;

  /** Alias for `exclude` — frontend sometimes sends `excludes` (with s). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludes?: number;

  /** NewProject.isCompleted filter (new_* types only). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_completed?: boolean;

  /** Listing.isFeatured filter (listing/cluster types). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_featured?: boolean;

  // ── Property-specific filters ─────────────────────────────────────────────

  /** House.houseType */
  @IsOptional()
  @IsString()
  house_type?: string;

  /** House.carports */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  carports?: number;

  /** Land.landType */
  @IsOptional()
  @IsString()
  land_type?: string;

  /** Warehouse.warehouseType */
  @IsOptional()
  @IsString()
  warehouse_type?: string;

  /** Shop.floor */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  floor?: number;

  /** Listing.minRentInMonth — minimum rental period in months. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_rent_in_month?: number;

  /** ApartmentUnit.isPetAllowed */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_pet_allowed?: boolean;

  /** Hotel.rating */
  @IsOptional()
  @IsString()
  rating?: string;

  /** Hotel.hotelType */
  @IsOptional()
  @IsString()
  hotel_type?: string;

  /** Hotel.isChain */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_chain?: boolean;

  /** Hotel.room — number of rooms */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  room?: number;

  /** Business.businessType */
  @IsOptional()
  @IsString()
  business_type?: string;

  /** Hotel.established / Business.established — founding year */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  established?: number;
}
