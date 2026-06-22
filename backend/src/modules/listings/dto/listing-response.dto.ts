import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger response schemas. These document the API shape; the live response is
 * additionally wrapped as `{ success, data }` and snake-cased by global
 * interceptors.
 */

export class ListingFieldsDto {
  @ApiProperty({ nullable: true, example: 'Apartemen' }) tipe_properti!: string | null;
  @ApiProperty({ nullable: true, example: 'Pakubuwono View' }) nama_properti!: string | null;
  @ApiProperty({ nullable: true, example: 'Pakubuwono View' }) nama_properti_normalized!: string | null;
  @ApiProperty({ nullable: true, example: 'Redwood' }) tower_name!: string | null;
  @ApiProperty({ nullable: true, example: '12B' }) unit!: string | null;
  @ApiProperty({ nullable: true, example: 'Jual' }) tipe_listing!: string | null;
  @ApiProperty({ example: 'Direct' }) channel!: string;
  @ApiProperty({ nullable: true, example: 6_300_000_000 }) harga!: number | null;
  @ApiProperty({ nullable: true }) harga_jual!: number | null;
  @ApiProperty({ nullable: true }) harga_sewa!: number | null;
  @ApiProperty({ enum: ['IDR', 'USD'], example: 'IDR' }) currency!: string;
  @ApiProperty({ nullable: true, enum: ['month', 'year'] }) rent_period!: string | null;
  @ApiProperty({ example: false }) negotiable!: boolean;
  @ApiProperty({ nullable: true, example: '2' }) kamar_tidur!: string | null;
  @ApiProperty({ nullable: true, example: 1 }) kamar_mandi!: number | null;
  @ApiProperty({ nullable: true, example: 80 }) luas_bangunan!: number | null;
  @ApiProperty({ nullable: true }) luas_tanah!: number | null;
  @ApiProperty({ nullable: true }) lantai!: number | null;
  @ApiProperty({ nullable: true, example: 'Furnished' }) kondisi!: string | null;
  @ApiProperty({ nullable: true }) owner_name!: string | null;
  @ApiProperty({ nullable: true }) owner_phone!: string | null;
  @ApiProperty({ nullable: true }) sertifikat!: string | null;
  @ApiProperty({ nullable: true, description: 'Free-text remarks' }) notes!: string | null;
}

export class ConfidenceDto {
  @ApiProperty({ example: 1, description: '0..1, computed from the normalized result' })
  score!: number;
  @ApiProperty({ type: [String], example: [] }) reasons!: string[];
}

export class ParseResultDto {
  @ApiProperty({ enum: ['rejected', 'ignored', 'written'], example: 'written' })
  status!: string;

  @ApiProperty({
    nullable: true,
    enum: ['draft', 'active'],
    example: 'active',
    description: 'Record status when written: draft (missing fields) or active (complete)',
  })
  record_status!: string | null;

  @ApiProperty({ type: ListingFieldsDto, nullable: true })
  listing!: ListingFieldsDto | null;

  @ApiProperty({ nullable: true, enum: ['cheap', 'mid', 'strong'], example: 'mid', description: 'Model tier that produced the accepted parse' })
  tier!: string | null;

  @ApiProperty({ type: ConfidenceDto, nullable: true })
  confidence!: ConfidenceDto | null;

  @ApiProperty({ type: [String], description: 'Required fields still missing (a draft lists these)', example: [] })
  missing!: string[];

  @ApiProperty({ required: false, nullable: true, description: 'Why the message was rejected (when status=rejected)' })
  reason?: string | null;
}

export class ListingSummaryDto {
  @ApiProperty({ description: 'Content-derived listing key', example: 'pakubuwonoview:redwood:12b' })
  id!: string;
  @ApiProperty({ enum: ['draft', 'active'], example: 'active' }) status!: string;
  @ApiProperty({ type: [String], example: [], description: 'Missing required fields (drafts)' }) missing!: string[];
  @ApiProperty({ nullable: true }) nama_properti!: string | null;
  @ApiProperty({ nullable: true }) tipe_properti!: string | null;
  @ApiProperty({ nullable: true }) tipe_listing!: string | null;
  @ApiProperty({ example: 'Direct' }) channel!: string;
  @ApiProperty({ nullable: true }) unit!: string | null;
  @ApiProperty({ nullable: true }) harga!: number | null;
  @ApiProperty({ enum: ['IDR', 'USD'], example: 'IDR' }) currency!: string;
  @ApiProperty({ nullable: true, enum: ['month', 'year'] }) rent_period!: string | null;
  @ApiProperty({ nullable: true }) kondisi!: string | null;
  @ApiProperty({ example: 1, description: 'Publish revision; >1 means republished' }) revision!: number;
}

export class ListingDetailDto extends ListingSummaryDto {
  @ApiProperty({ type: ListingFieldsDto })
  listing!: ListingFieldsDto;
}
