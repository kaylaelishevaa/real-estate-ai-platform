import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { ParseListingDto } from './dto/parse-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListingDetailDto, ListingSummaryDto, ParseResultDto } from './dto/listing-response.dto';

/**
 * Thin REST surface over the in-memory listing pipeline. The UI talks to these
 * endpoints; all the logic lives in ListingsService / src/core.
 */
@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post('parse')
  @ApiOperation({
    summary: 'Parse a free-form WhatsApp broadcast into a validated listing',
    description:
      'Runs the message through whitelist → parse (with model escalation) → validate → write. ' +
      'Returns the structured fields, the model tier that handled it, a confidence score, and ' +
      'either the missing required fields or the rejection reason.',
  })
  @ApiResponse({ status: 201, type: ParseResultDto })
  parse(@Body() dto: ParseListingDto): Promise<ParseResultDto> {
    return this.listings.parse(dto.text) as Promise<ParseResultDto>;
  }

  @Get()
  @ApiOperation({ summary: 'List all listings (seeded + anything parsed this session)' })
  @ApiResponse({ status: 200, type: [ListingSummaryDto] })
  findAll(): ListingSummaryDto[] {
    return this.listings.findAll() as ListingSummaryDto[];
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one listing by its content key' })
  @ApiResponse({ status: 200, type: ListingDetailDto })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  findOne(@Param('id') id: string): ListingDetailDto {
    return this.listings.findOne(id) as ListingDetailDto;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a listing (human correction)',
    description:
      'Merges the provided fields, re-validates with the parser field-validation, bumps the ' +
      'revision, and returns the updated listing. An edit that fills the missing fields ' +
      'completes the draft (status → active); one that leaves it incomplete keeps it a draft ' +
      '(the work is never lost). The listing key is stable across edits.',
  })
  @ApiResponse({ status: 200, type: ListingDetailDto })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  update(@Param('id') id: string, @Body() dto: UpdateListingDto): ListingDetailDto {
    return this.listings.update(id, dto) as ListingDetailDto;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a listing (remove a phantom / duplicate)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  remove(@Param('id') id: string): void {
    this.listings.remove(id);
  }
}
