import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const PROPERTY_TYPES = [
  'Apartemen',
  'Rumah',
  'Tanah',
  'Ruko',
  'Gudang',
  'Kantor',
  'Hotel',
  'Ruang Usaha',
  'Gedung',
];

/**
 * Editable fields for PATCH /api/listings/:id — the human-correction step.
 * Every field is optional; only the ones provided are changed. The merged result
 * is re-validated with the same field-validation the parser uses, so an edit
 * can't leave a half-listing.
 */
export class UpdateListingDto {
  @ApiPropertyOptional({ example: 'Pakubuwono View' })
  @IsOptional() @IsString() @MaxLength(200)
  nama_properti?: string;

  @ApiPropertyOptional({ example: 'Redwood', nullable: true })
  @IsOptional() @IsString() @MaxLength(100)
  tower_name?: string;

  @ApiPropertyOptional({ example: '12B' })
  @IsOptional() @IsString() @MaxLength(50)
  unit?: string;

  @ApiPropertyOptional({ enum: PROPERTY_TYPES })
  @IsOptional() @IsIn(PROPERTY_TYPES)
  tipe_properti?: string;

  @ApiPropertyOptional({ enum: ['Jual', 'Sewa', 'Jual & Sewa'] })
  @IsOptional() @IsIn(['Jual', 'Sewa', 'Jual & Sewa'])
  tipe_listing?: string;

  @ApiPropertyOptional({ enum: ['Direct', 'Cobroke'] })
  @IsOptional() @IsIn(['Direct', 'Cobroke'])
  channel?: string;

  @ApiPropertyOptional({ example: 6_300_000_000 })
  @IsOptional() @IsInt() @Min(0)
  harga?: number;

  @ApiPropertyOptional({ example: 6_300_000_000 })
  @IsOptional() @IsInt() @Min(0)
  harga_jual?: number;

  @ApiPropertyOptional({ example: 41_000_000 })
  @IsOptional() @IsInt() @Min(0)
  harga_sewa?: number;

  @ApiPropertyOptional({ example: '2' })
  @IsOptional() @IsString() @MaxLength(20)
  kamar_tidur?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @IsInt() @Min(0)
  kamar_mandi?: number;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional() @IsInt() @Min(0)
  luas_bangunan?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional() @IsInt() @Min(0)
  luas_tanah?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional() @IsInt() @Min(0)
  lantai?: number;

  @ApiPropertyOptional({ enum: ['Furnished', 'Semi Furnished', 'Unfurnished'] })
  @IsOptional() @IsIn(['Furnished', 'Semi Furnished', 'Unfurnished'])
  kondisi?: string;

  @ApiPropertyOptional({ example: 'Budi' })
  @IsOptional() @IsString() @MaxLength(120)
  owner_name?: string;

  @ApiPropertyOptional({ example: '08123456789' })
  @IsOptional() @IsString() @MaxLength(30)
  owner_phone?: string;

  @ApiPropertyOptional({ example: 'SHM' })
  @IsOptional() @IsString() @MaxLength(60)
  sertifikat?: string;

  @ApiPropertyOptional({ example: 'City view, balcony' })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
