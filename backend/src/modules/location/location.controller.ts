import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { CacheHeader } from '../../common/decorators/cache-header.decorator';
import { SearchLocationDto } from './dto/search-location.dto';
import { LocationSearchDto } from './dto/location-search.dto';
import { LocationSearchService } from './location-search.service';
import { LocationService } from './location.service';

@Controller('locations')
export class LocationController {
  constructor(
    private readonly locationService: LocationService,
    private readonly locationSearchService: LocationSearchService,
  ) {}

  // ── Static routes FIRST (before :slug to avoid Fastify capturing them) ──

  /**
   * GET /locations/list
   * Returns all non-subarea slugs for ISR/static generation.
   */
  @Get('list')
  list() {
    return this.locationService.list();
  }

  /**
   * GET /locations/popular
   * Returns popular locations with a `children_count` field.
   */
  @Get('popular')
  @CacheHeader('public, s-maxage=3600')
  popular() {
    return this.locationService.popular();
  }

  /**
   * GET /locations/autocomplete?search=kem&type=apartment
   * Returns { locations, properties } for the search term.
   */
  @Get('autocomplete')
  autocomplete(@Query() dto: SearchLocationDto) {
    return this.locationService.autocomplete(dto.search ?? '', dto.type);
  }

  // ── Index ─────────────────────────────────────────────────────────────────

  /**
   * GET /locations?name=&parent_id=&page=&load=
   * Paginated list with translations included.
   */
  @Get()
  findAll(@Query() dto: SearchLocationDto, @Req() req: any) {
    const path: string = (req.url as string).split('?')[0];
    return this.locationService.findAll(dto, path);
  }

  // ── Parametric routes ────────────────────────────────────────────────────

  /**
   * GET /locations/:slug
   * Single location with parent (→ grandparent), children, translations, media.
   */
  @Get(':slug')
  @CacheHeader('public, s-maxage=600')
  findOne(@Param('slug') slug: string) {
    return this.locationService.findBySlug(slug);
  }

  /**
   * GET /locations/:slug/nearby
   * Sibling locations (same parent, excluding self), max 6.
   */
  @Get(':slug/nearby')
  nearby(@Param('slug') slug: string) {
    return this.locationService.nearby(slug);
  }

  /**
   * GET /locations/:slug/apartments?search=&page=&load=
   * Paginated apartments in this location and all its descendants.
   */
  @Get(':slug/apartments')
  @CacheHeader('public, max-age=60, stale-while-revalidate=300')
  apartments(
    @Param('slug') slug: string,
    @Query() dto: SearchLocationDto,
    @Req() req: any,
  ) {
    const path: string = (req.url as string).split('?')[0];
    return this.locationService.apartments(slug, dto, path);
  }

  /**
   * GET /locations/:slug/search?type=apartment&category=SELL&...
   * Multi-type property search within a location (and all descendants).
   * Switches response shape based on `type` query param.
   */
  @Get(':slug/search')
  @CacheHeader('public, max-age=60, stale-while-revalidate=300')
  search(
    @Param('slug') slug: string,
    @Query() dto: LocationSearchDto,
    @Req() req: any,
  ) {
    const path: string = (req.url as string).split('?')[0];
    return this.locationSearchService.search(slug, dto, path);
  }
}
