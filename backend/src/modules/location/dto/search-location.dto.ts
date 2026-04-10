import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SearchLocationDto {
  /** Filter by name (case-insensitive LIKE). */
  @IsOptional()
  @IsString()
  name?: string;

  /** Filter to children of this parent location id. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parent_id?: number;

  /** Current page (1-based). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Items per page – Laravel-style alias. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  load?: number;

  /** Items per page – standard alias. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  per_page?: number;

  // ── autocomplete ──────────────────────────────────────────────────────────

  /** Free-text search term (autocomplete). */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Property category to include in autocomplete results.
   * Accepted values: apartment | office | new-project | house | land |
   *   shop | warehouse | hotel | business
   */
  @IsOptional()
  @IsString()
  type?: string;
}
