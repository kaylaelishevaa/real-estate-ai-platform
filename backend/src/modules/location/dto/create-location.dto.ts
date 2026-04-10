import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateLocationDto {
  @IsString() name: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsNumber() parent_id?: number;
  @IsOptional() @IsString() picture?: string;
  @IsOptional() @IsBoolean() is_subarea?: boolean;
  @IsOptional() @IsBoolean() is_popular?: boolean;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() nearby_location?: any;
}
