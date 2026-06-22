import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Request body for POST /api/listings/parse. */
export class ParseListingDto {
  @ApiProperty({
    description: 'A free-form WhatsApp listing broadcast (Indonesian/English).',
    example:
      'Dijual apartemen Pakubuwono View tower Redwood unit 12B, 2BR 1KM LB 80, 6.3M nego furnished, owner Bu Sari 081299990001 direct',
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}
